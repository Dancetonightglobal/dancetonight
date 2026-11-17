// What the next ingest run does to rows stored at a time their page does not give (D-081), end to
// end over a real database: run 30's Stepping Out read, served from the extraction cache, is
// checked against the page, and the rows main stored from it are corrected by the run itself,
// tonight's included. A partial read still retires nothing (D-070).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { findPhrase, foldPage } from "@/src/domain/text-facts";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Tuesday 2026-09-29, noon in New York: tonight is 2026-09-29, the night run 30 stored.
const NOW = new Date("2026-09-29T16:00:00Z");
const TONIGHT = "2026-09-29";

const STEPPING_OUT = "https://steppingoutstudios.com/social-events1";
const STUDIO = "https://studio.example/";
const venue = { name: "Stepping Out Studios", address: "37 W 26th St, New York, NY" };
const AT = { lat: 40.7447, lng: -73.9903 };

/** The saved Stepping Out page, one paragraph per line, as its site serves it. */
const steppingOutHtml = `<html><body>${readFileSync(
  join(__dirname, "../../evals/extraction/pages/steppingoutstudios-social-events1.txt"),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() && !line.startsWith("[") && !line.startsWith("<!"))
  .map((line) => `<p>${line.replace(/\[https?:[^\]]*\]/g, "")}</p>`)
  .join("")}</body></html>`;

// Run 30's read, as the live site showed it on 2026-09-29.
const RUN30: Array<Record<string, unknown>> = [
  {
    title: "Friday Night Fever",
    listing_type: "social",
    recurrence_text: "Every 1st, 3rd Friday of the month",
    dancing_time: "20:30",
    end_time: "23:30",
  },
  {
    title: "All Night Milonga",
    listing_type: "social",
    recurrence_text: "Every 2nd & last Saturday",
    dancing_time: "22:00",
    end_time: "04:00",
  },
  {
    title: "Robins Argentine Tango Practica",
    listing_type: "practica",
    recurrence_text: "Every Thursday",
    dancing_time: "21:30",
    end_time: "23:30",
  },
  {
    title: "Noche De Descarga",
    listing_type: "social",
    recurrence_text: "Every 3rd Saturday of the month",
    dancing_time: "22:00",
    end_time: "03:00",
  },
  {
    title: "Bachata Rosa",
    listing_type: "social",
    recurrence_text: "Every Friday night",
    lesson_time: "10:00",
    dancing_time: "22:00",
    end_time: "03:00",
  },
  {
    title: "Zen Zouk",
    listing_type: "social",
    recurrence_text: "Every Wednesdays, Studio D",
    dancing_time: "21:30",
    end_time: "01:00",
  },
  {
    title: "Paciencia Milonga",
    listing_type: "social",
    recurrence_text: "Every Tuesday 9:30pm to 1:30am",
    dancing_time: "21:30",
    end_time: "01:30",
  },
  {
    title: "La Vieja Guardia Salsa",
    listing_type: "social",
    recurrence_text: "Every 2nd & 4th Sunday of the month",
    dancing_time: "18:00",
    end_time: "22:00",
  },
  {
    title: "Tango Y Te",
    listing_type: "class",
    local_date: "2026-09-29",
    lesson_time: "15:00",
    end_time: "18:00",
  },
  {
    title: "Ballroom and Smooth Practice",
    listing_type: "class",
    recurrence_text: "Every Tuesday",
    lesson_time: "21:30",
    dancing_time: "22:30",
  },
  {
    title: "Toda La Noche, Salsa Social",
    listing_type: "social",
    recurrence_text: "Every 1st Saturday of the Month",
    doors_time: "22:00",
    dancing_time: "23:00",
    end_time: "03:00",
  },
  {
    title: "Jimmy Anton Salsa Social",
    listing_type: "social",
    recurrence_text: "Every 1st, 3rd, and 5th Sunday (if there is one) of the month",
    doors_time: "18:00",
    dancing_time: "22:00",
    end_time: "22:00",
  },
];
const run30 = (title: string) => RUN30.find((l) => l.title === title)!;

let db: Db;
let metro: Metro;
let calls = 0;

const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
});

/**
 * A model that answers each part of a page with the listings whose title that part writes, so a
 * page read in two parts lists each night once. A part that holds `failOn` is not read (a 503).
 */
function model(listings: Array<Record<string, unknown>>, failOn?: string): AiClient {
  return {
    async run(request: { user: string }) {
      calls += 1;
      if (failOn && request.user.includes(failOn)) {
        return { ok: false, reason: "provider_error", provider: "cloudflare", detail: "503" };
      }
      const part = foldPage(request.user);
      return {
        ok: true,
        provider: "cloudflare",
        model: "@cf/ibm-granite/granite-4.0-h-micro",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: listings
            .filter((l) => findPhrase(part, String(l.title)) !== null)
            .map((l) => ({ styles: [], organizer: {}, venue, ...l })),
        }),
      };
    },
  } as unknown as AiClient;
}

/** A model the run must not call: the read is in the extraction cache. */
const noModel = {
  async run() {
    throw new Error("the model was called; the read should have come from the cache");
  },
} as unknown as AiClient;

async function ingest(source: Source, html: string, client: AiClient) {
  let t = NOW.getTime();
  const origin = new URL(source.url).origin;
  const report = await runIngest({
    db,
    metro,
    env: {},
    only: [source.url],
    ai: { client, cache: postgresExtractionCache(db) },
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport([
        ok(`${origin}/robots.txt`, "User-agent: *\nDisallow:\n"),
        ok(source.url, html),
      ]),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
  return report.sources.find((s) => s.url === source.url)!;
}

/** Rows as main stored them from a read, unchecked: one per listing, on its night. */
async function storedBefore(source: Source, rows: Array<[Record<string, unknown>, string]>) {
  const normalized = rows.map(([fields, night]) => {
    const outcome = normalizeListing(
      {
        // Dated, as main stored each night: the rule's phrase is not the stored row's.
        listing: rawListingSchema.parse({
          styles: [],
          organizer: {},
          venue,
          ...fields,
          recurrence_text: null,
          local_date: night,
        }),
        externalId: null,
        tz: null,
        venueLocation: AT,
        recurrence: null,
        provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "llm" },
      },
      { metro, source, now: NOW },
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.event;
  });
  return (
    await writeEvents(db, {
      metro,
      source,
      events: normalized,
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: (input) => resolveVenue(db, metro, { ...input, location: AT }),
    })
  ).eventIds;
}

const clock = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(d)
    : "-";

/** The active rows, as "night title | doors lesson dancing end" in New York time, sorted. */
async function activeRows() {
  const rows = await db.select().from(events).where(eq(events.status, "active"));
  return rows
    .map(
      (r) =>
        `${r.nightDate} ${r.title} | ${[r.doorsAt, r.lessonAt, r.dancingAt, r.endsAt].map(clock).join(" ")}`,
    )
    .sort();
}

async function source(url: string) {
  return upsertSource(db, metro.id, {
    url,
    kind: "html",
    platform: "probed",
    trustTier: "first_party",
    discoveredBy: "seed_list",
  });
}

describeDb("rows stored at a time the page does not give (D-081)", () => {
  beforeAll(async () => {
    db = await testDb("times");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    calls = 0;
  });

  it("replaces main's wrongly timed rows, tonight included, from the cached read", async () => {
    const steppingOut = await source(STEPPING_OUT);
    const tangoYTe = run30("Tango Y Te");
    await storedBefore(steppingOut, [
      [run30("Ballroom and Smooth Practice"), TONIGHT],
      [run30("Ballroom and Smooth Practice"), "2026-10-06"],
      [run30("Toda La Noche, Salsa Social"), "2026-10-03"],
      [run30("Jimmy Anton Salsa Social"), "2026-10-04"],
      [run30("Bachata Rosa"), "2026-10-02"],
      [run30("Bachata Rosa"), "2026-10-09"],
      [tangoYTe, "2026-10-04"],
      [tangoYTe, "2026-10-11"],
      [run30("Friday Night Fever"), "2026-10-02"],
    ]);
    // Main's code left both of tonight's Ballroom rows active: this is the row to go.
    expect(await activeRows()).toContain(
      "2026-09-29 Ballroom and Smooth Practice | - 21:30 22:30 -",
    );

    const first = await ingest(steppingOut, steppingOutHtml, model(RUN30));
    expect(calls).toBeGreaterThan(0);
    const after = await activeRows();
    expect(after).toEqual([
      "2026-09-29 Ballroom and Smooth Practice | - - 21:30 22:30",
      "2026-09-29 Paciencia Milonga | - - 21:30 01:30",
      "2026-09-30 Zen Zouk | - - 21:30 01:00",
      "2026-10-01 Robins Argentine Tango Practica | - - 21:30 23:30",
      "2026-10-02 Bachata Rosa | - 22:00 - 03:00",
      "2026-10-02 Friday Night Fever | - - 20:30 -",
      "2026-10-03 Toda La Noche, Salsa Social | - - 22:00 03:00",
      "2026-10-04 Jimmy Anton Salsa Social | - - 18:00 22:00",
      "2026-10-04 Tango Y Te | - - 15:00 18:00",
      "2026-10-06 Ballroom and Smooth Practice | - - 21:30 22:30",
      "2026-10-06 Paciencia Milonga | - - 21:30 01:30",
      "2026-10-07 Zen Zouk | - - 21:30 01:00",
      "2026-10-08 Robins Argentine Tango Practica | - - 21:30 23:30",
      "2026-10-09 Bachata Rosa | - 22:00 - 03:00",
      "2026-10-10 All Night Milonga | - - 22:00 04:00",
      "2026-10-11 La Vieja Guardia Salsa | - - 18:00 22:00",
      "2026-10-11 Tango Y Te | - - 15:00 18:00",
    ]);
    expect(first.notes).toContain(
      "1 stored listing(s) tonight at a time the page no longer gives were retired: Ballroom and Smooth Practice on 2026-09-29",
    );
    expect(first.notes).toContain(
      "3 stored listing(s) this page no longer lists were retired: Toda La Noche, Salsa Social on 2026-10-03; Jimmy Anton Salsa Social on 2026-10-04; Ballroom and Smooth Practice on 2026-10-06",
    );

    // The same page again: the read comes from the cache, no model is called, nothing changes.
    const callsBefore = calls;
    const second = await ingest(steppingOut, steppingOutHtml, noModel);
    expect(calls).toBe(callsBefore);
    expect(second.adapter).toMatch(/cached/);
    expect(await activeRows()).toEqual(after);
  }, 240_000);

  it("lists tonight's night without the time the page does not write, and retires the timed row", async () => {
    const studio = await source(STUDIO);
    const salsa = {
      title: "Salsa Social",
      listing_type: "social",
      local_date: TONIGHT,
      dancing_time: "23:00",
    };
    await storedBefore(studio, [[salsa, TONIGHT]]);
    const line = await ingest(
      studio,
      "<html><body><p>Salsa Social</p><p>Tuesday, September 29, 10pm to 3am</p></body></html>",
      model([salsa]),
    );
    const rows = await db
      .select({ status: events.status, startsAt: events.startsAt, endsAt: events.endsAt })
      .from(events)
      .orderBy(events.startsAt);
    expect(rows).toEqual([
      { status: "removed", startsAt: new Date("2026-09-30T03:00:00Z"), endsAt: null },
      { status: "active", startsAt: null, endsAt: null },
    ]);
    // The untimed listing replaces the timed row as it is written (on any read, whole or
    // partial), pointing at it; the whole read's tonight rule has nothing left to retire.
    expect(line.notes).toContain(
      "Salsa Social: listed on 2026-09-29 with no time, as the page does not write the time the read gave; the listing stored with a time was replaced",
    );
  }, 240_000);

  /** Two parts, as pipeline-grounding-review's partial reads: part B fails on its own text. */
  const twoParts = (a: string, b: string) =>
    `<html><body><h2>Part A</h2><p>${"a ".repeat(1_800)}</p><p>${a}</p><h2>Part B</h2><p>${"b ".repeat(1_800)}</p><p>${b}</p></body></html>`;

  for (const [night, weekday] of [
    [TONIGHT, "Tuesday, September 29"],
    ["2026-10-02", "Friday, October 2"],
  ] as const) {
    it(`a partial read replaces the timed row whose time the page does not write (${night})`, async () => {
      const studio = await source(STUDIO);
      const salsa = {
        title: "Salsa Social",
        listing_type: "social",
        local_date: night,
        dancing_time: "23:00",
      };
      const [stored] = await storedBefore(studio, [[salsa, night]]);
      const [before] = await db
        .select({ venueId: events.venueId })
        .from(events)
        .where(eq(events.id, stored!));
      const storedVenue = before?.venueId;
      expect(storedVenue).toBeTruthy();
      // Part A writes the night at 10pm, not 11pm; part B ("More nights") is not read. This read
      // names a room no geocoder can place, so the untimed listing keeps the stored row's venue.
      const line = await ingest(
        studio,
        twoParts(`Salsa Social, ${weekday}, 10pm to 3am`, "More nights"),
        model([{ ...salsa, venue: { name: "The back room" } }], "More nights"),
      );
      expect(line.notes.some((n) => /1 of the page's 2 parts could not be read/.test(n))).toBe(
        true,
      );
      const rows = await db
        .select({
          id: events.id,
          status: events.status,
          startsAt: events.startsAt,
          mergedIntoId: events.mergedIntoId,
          venueId: events.venueId,
        })
        .from(events)
        .where(eq(events.nightDate, night));
      const active = rows.filter((r) => r.status === "active");
      expect(active).toHaveLength(1);
      expect(active[0]!.startsAt).toBeNull();
      // The timed row is retired into the untimed listing, which keeps its venue.
      const old = rows.find((r) => r.id === stored);
      expect(old).toMatchObject({ status: "removed", mergedIntoId: active[0]!.id });
      expect(active[0]!.venueId).toBe(storedVenue);
      expect(line.notes).toContain(
        `Salsa Social: listed on ${night} with no time, as the page does not write the time the read gave; the listing stored with a time was replaced`,
      );
    }, 240_000);
  }

  it("lists the timed row again when the page writes its time again", async () => {
    const studio = await source(STUDIO);
    const salsa = {
      title: "Salsa Social",
      listing_type: "social",
      local_date: "2026-10-02",
      dancing_time: "23:00",
    };
    const [stored] = await storedBefore(studio, [[salsa, "2026-10-02"]]);
    await ingest(
      studio,
      twoParts("Salsa Social, Friday, October 2, 10pm to 3am", "More nights"),
      model([salsa], "More nights"),
    );
    // The page now writes 11pm: the row at 11pm is listed again, and the untimed one merges into it.
    await ingest(
      studio,
      "<html><body><p>Salsa Social</p><p>Friday, October 2, 11pm to 3am</p></body></html>",
      model([salsa]),
    );
    const rows = await db
      .select({ id: events.id, status: events.status, mergedIntoId: events.mergedIntoId })
      .from(events)
      .where(eq(events.nightDate, "2026-10-02"));
    expect(rows.filter((r) => r.status === "active")).toEqual([
      { id: stored, status: "active", mergedIntoId: null },
    ]);
    expect(rows.filter((r) => r.id !== stored)).toEqual([
      expect.objectContaining({ status: "merged", mergedIntoId: stored }),
    ]);
  }, 240_000);

  it("a partial read retires no row tonight", async () => {
    const studio = await source(STUDIO);
    const ballroom = run30("Ballroom and Smooth Practice");
    const [stored] = await storedBefore(studio, [[ballroom, TONIGHT]]);
    // Part A holds Ballroom's block and is read; part B fails (a provider's 503).
    const html = `<html><body><h2>Part A</h2><p>${"a ".repeat(1_800)}</p><p>Ballroom and Smooth Practice</p><p>Date: Every Tuesday</p><p>Time: 9:30pm-10:30pm</p><h2>Part B</h2><p>${"b ".repeat(1_800)}</p><p>More nights</p></body></html>`;
    const line = await ingest(studio, html, model([ballroom], "More nights"));
    expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
    expect(line.notes.join(" ")).not.toMatch(/were retired/);
    // Tonight's row at the old time stays until a whole read (D-070).
    const [old] = await db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, stored!));
    expect(old?.status).toBe("active");
    expect(await activeRows()).toContain(
      "2026-09-29 Ballroom and Smooth Practice | - 21:30 22:30 -",
    );
  }, 240_000);
});
