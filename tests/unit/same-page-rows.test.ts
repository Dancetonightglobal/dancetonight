import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import { retireSamePageRows } from "@/src/pipeline/same-page-rows";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// D-836 (daily check 2026-11-10, Buenos Aires): dancetomic's Sepicó event page moved its night from 9pm to
// 10pm; the JSON-LD reader is never a whole read, so the 9pm row stayed beside the 10pm one.
const NOW = new Date("2026-11-10T13:00:00Z");
const METRO_ID = "22222222-2222-4222-8222-222222222222";
const NIGHT = "2026-11-10";
const LATER = "2026-11-17";
const LIST = "https://dancetomic.com/eventos/buenos-aires";
const PAGE = "https://dancetomic.com/eventos/buenos-aires/sepico-social-dance-4008";
const OTHER_PAGE = "https://dancetomic.com/eventos/buenos-aires/bachata-night-4100";

let db: Db;
let metro: Metro;

function normalized(
  source: Source,
  fields: { title: string; night: string; time: string; eventUrl: string | null },
): NormalizedEvent {
  const outcome = normalizeListing(
    {
      listing: rawListingSchema.parse({
        listing_type: "social",
        styles: ["salsa"],
        venue: {},
        organizer: {},
        title: fields.title,
        local_date: fields.night,
        dancing_time: fields.time,
      }),
      eventUrl: fields.eventUrl,
      externalId: null,
      tz: null,
      venueLocation: null,
      recurrence: null,
      provenance: { sourceUrl: fields.eventUrl ?? source.url, fetchedAt: NOW, method: "feed" },
    },
    { metro, source, now: NOW },
  );
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function directory(url: string): Promise<Source> {
  return upsertSource(db, metro.id, {
    url,
    kind: "jsonld",
    trustTier: "directory",
    discoveredBy: "seed_list",
  });
}

async function write(
  source: Source,
  title: string,
  time: string,
  eventUrl: string | null,
  night = NIGHT,
): Promise<string> {
  const written = await writeEvents(db, {
    metro,
    source,
    events: [normalized(source, { title, night, time, eventUrl })],
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
  const id = written.eventIds[0];
  if (!id) throw new Error("nothing written");
  return id;
}

async function statusOf(id: string) {
  const [row] = await db.select({ status: events.status }).from(events).where(eq(events.id, id));
  return row?.status;
}

describeDb("retireSamePageRows, against Postgres with PostGIS", () => {
  beforeAll(async () => {
    db = await testDb("same-page-rows");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "buenos-aires",
      name: "Buenos Aires",
      countryCode: "AR",
      center: { lat: -34.6037, lng: -58.3816 },
      radiusKm: 50,
      tz: "America/Argentina/Buenos_Aires",
      languages: ["es"],
      status: "active",
    });
    metro = (await loadMetro(db, "buenos-aires"))!;
  });

  it("retires this source's row of an event page on a night this read gives that page at another time", async () => {
    const src = await directory(LIST);
    const stale = await write(src, "Sepicó Social Dance", "21:00", PAGE);
    const listed = await write(src, "Sepicó Social Dance", "22:00", PAGE);
    expect(stale).not.toBe(listed);

    const { retired, notes } = await retireSamePageRows(db, {
      source: src,
      listedIds: [listed],
      nights: [NIGHT, LATER],
    });

    expect(retired).toBe(1);
    expect(await statusOf(stale)).toBe("removed");
    expect(await statusOf(listed)).toBe("active");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain(`Sepicó Social Dance on ${NIGHT}`);
  });

  it("also retires a row of that page under an old title", async () => {
    const src = await directory(LIST);
    const stale = await write(src, "Sepico Social", "21:00", PAGE);
    const listed = await write(src, "Sepicó Social Dance", "22:00", PAGE);
    const { retired } = await retireSamePageRows(db, {
      source: src,
      listedIds: [listed],
      nights: [NIGHT],
    });
    expect(retired).toBe(1);
    expect(await statusOf(stale)).toBe("removed");
  });

  it("keeps an unlisted row of another event page, a row with no event page, and the page's row on a night not given", async () => {
    const src = await directory(LIST);
    const listed = await write(src, "Sepicó Social Dance", "22:00", PAGE);
    const otherPage = await write(src, "Bachata Night", "21:00", OTHER_PAGE);
    const noPage = await write(src, "Salsa Tuesday", "20:00", null);
    const laterNight = await write(src, "Sepicó Social Dance", "21:00", PAGE, LATER);

    const { retired, notes } = await retireSamePageRows(db, {
      source: src,
      listedIds: [listed],
      nights: [NIGHT, LATER],
    });

    expect(retired).toBe(0);
    expect(notes).toEqual([]);
    expect(await statusOf(otherPage)).toBe("active");
    expect(await statusOf(noPage)).toBe("active");
    expect(await statusOf(laterNight)).toBe("active");
  });

  it("keeps two sessions of one page that this read both lists", async () => {
    const src = await directory(LIST);
    const a = await write(src, "Sepicó Class", "20:00", PAGE);
    const b = await write(src, "Sepicó Social Dance", "22:00", PAGE);
    const { retired } = await retireSamePageRows(db, {
      source: src,
      listedIds: [a, b],
      nights: [NIGHT],
    });
    expect(retired).toBe(0);
    expect(await statusOf(a)).toBe("active");
    expect(await statusOf(b)).toBe("active");
  });

  it("never touches another source's row of the same page", async () => {
    const src = await directory(LIST);
    const other = await directory("https://dancetomic.com/eventos/la-plata");
    const theirs = await write(other, "Sepicó Social Dance", "21:00", PAGE);
    const listed = await write(src, "Sepicó Social Dance", "22:00", PAGE);
    const { retired } = await retireSamePageRows(db, {
      source: src,
      listedIds: [listed],
      nights: [NIGHT],
    });
    expect(retired).toBe(0);
    expect(await statusOf(theirs)).toBe("active");
  });

  it("does nothing when the read listed nothing or no night is given", async () => {
    const src = await directory(LIST);
    const row = await write(src, "Sepicó Social Dance", "21:00", PAGE);
    expect(await retireSamePageRows(db, { source: src, listedIds: [], nights: [NIGHT] })).toEqual({
      retired: 0,
      notes: [],
    });
    expect(await retireSamePageRows(db, { source: src, listedIds: [row], nights: [] })).toEqual({
      retired: 0,
      notes: [],
    });
    expect(await statusOf(row)).toBe("active");
  });
});
