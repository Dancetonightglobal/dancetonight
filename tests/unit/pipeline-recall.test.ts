// The recall eval against Postgres (D-112): one night, one list row per outcome, each classified
// from what the database holds. Each test fails when the rule it names is removed.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { evalRuns, events, metros, rawDocuments, sources } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { parseRecallCsv } from "@/src/domain/recall";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing } from "@/src/pipeline/normalize";
import { evaluateRecall } from "@/src/pipeline/recall";
import {
  loadMetro,
  mergeInto,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-05T16:00:00Z");
const NIGHT = "2026-10-08";
const YSBD = { lat: 40.744505, lng: -73.9904434 };
const DANZNIK = { lat: 40.753519, lng: -73.99099 };

let db: Db;
let metro: Metro;
const src: Record<string, Source> = {};

const SOURCES = {
  frimfram: "https://frimframjam.com/calendar",
  twis: "https://thisweekinswingnyc.com/",
  remix: "https://swingremixnyc.com/",
  sobs: "https://sobs.com/calendar",
  cdny: "https://cdny.org/calendar-events",
} as const;
type Key = keyof typeof SOURCES;

function listing(key: Key, id: string, fields: Record<string, unknown>, at = YSBD) {
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: NIGHT,
      ...fields,
    }),
    externalId: `${key}:${id}`,
    tz: null,
    venueLocation: at,
    recurrence: null,
    provenance: { sourceUrl: SOURCES[key], fetchedAt: NOW, method: "feed" },
  };
  const outcome = normalizeListing(harvested, { metro, source: src[key]!, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(key: Key, list: ReturnType<typeof listing>[]) {
  return writeEvents(db, {
    metro,
    source: src[key]!,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

async function fetched(key: Key, at: string, text: string | null, status = 200) {
  await db.insert(rawDocuments).values({
    sourceId: src[key]!.id,
    url: SOURCES[key],
    fetchedAt: new Date(at),
    httpStatus: status,
    contentHash: `${key}-${at}`,
    cleanedText: text,
  });
}

async function idOf(title: string): Promise<string> {
  const [row] = await db.select({ id: events.id }).from(events).where(eq(events.title, title));
  return row!.id;
}

const CSV = `title,venue,start_time,style,source_url
Frim Fram Jam,You Should Be Dancing,8:30pm,lindy hop,https://frimframjam.com/calendar/20261008
Swing Remix,Ukrainian National Home,8pm,swing,https://swingremixnyc.com/events
Gotham Jazz,Danznik Studios,9pm,lindy,https://thisweekinswingnyc.com/
Midtown Swings,Danznik Studios,9pm,west coast swing,
Rhythm Revue,SOB's,7pm,salsa,https://sobs.com/calendar
Caribbean Saturdays,SOB's,11pm,dancehall,https://sobs.com/calendar
English Country Dance,Church of the Village,7pm,english country,https://cdny.org/
Kizomba Thursday,Somewhere,9pm,kizomba,https://kizomba.example/
`;

describeDb("the recall eval, against Postgres", () => {
  beforeAll(async () => {
    db = await testDb("recall");
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
    for (const [key, url] of Object.entries(SOURCES))
      src[key] = await upsertSource(db, metro.id, {
        url,
        kind: "html",
        trustTier: key === "twis" ? "directory" : "first_party",
        discoveredBy: "seed_list",
      });
  });

  it("finds, and puts every miss in PLAN 12's classes", async () => {
    // Found: the same title, start and place.
    await write("frimfram", [
      listing("frimfram", "ffj", {
        title: "Frim Fram Jam: Third Thursdays",
        dancing_time: "20:30",
        venue: { name: "You Should Be Dancing" },
      }),
    ]);
    // Found by the organiser's site, venue and start, under another title (D-090's pair).
    await write("remix", [
      listing("remix", "brooks", {
        title: "The Brooks Prumo Orchestra",
        dancing_time: "20:00",
        venue: { name: "Ukrainian National Home" },
        organizer: { name: "Swing Remix", url: "https://swingremixnyc.com/" },
      }),
    ]);
    // deduped_away: Gotham Jazz merged into Midtown Swings, a different night at the same place.
    await write("twis", [
      listing(
        "twis",
        "gotham",
        { title: "Gotham Jazz", dancing_time: "21:00", venue: { name: "Danznik Studios" } },
        DANZNIK,
      ),
      listing(
        "twis",
        "midtown",
        { title: "Midtown Swings", dancing_time: "21:00", venue: { name: "Danznik Studios" } },
        DANZNIK,
      ),
    ]);
    await mergeInto(db, await idOf("Midtown Swings"), await idOf("Gotham Jazz"));
    // extracted_wrong: SOB's page names Rhythm Revue; nothing was written.
    await fetched("sobs", "2026-10-07T14:00:00Z", "Oct 8 Rhythm Revue 7pm. Oct 10 Caribbean...");
    // extracted_wrong: CDNY's dance written on the wrong night.
    await write("cdny", [
      listing("cdny", "ecd", {
        title: "English Country Dance",
        local_date: "2026-10-09",
        doors_time: "19:00",
        venue: { name: "Church of the Village" },
      }),
    ]);

    const { rows, problems } = parseRecallCsv(CSV);
    const report = await evaluateRecall(db, "nyc", NIGHT, rows, problems, { record: true });
    const line = (title: string) => report.lines.find((l) => l.includes(`"${title}"`)) ?? "";

    expect(report.found).toBe(3);
    expect(report.missesByCause).toEqual({
      no_source_known: 1,
      source_not_harvested: 1,
      extracted_wrong: 2,
      deduped_away: 1,
    });
    expect(line("Gotham Jazz")).toBe(
      '  line 4 "Gotham Jazz": deduped_away: "Gotham Jazz" was merged into "Midtown Swings"',
    );
    expect(line("Rhythm Revue")).toContain("extracted_wrong: https://sobs.com/calendar (fetched");
    expect(line("Caribbean Saturdays")).toContain(
      "source_not_harvested: https://sobs.com/calendar (fetched",
    );
    expect(line("English Country Dance")).toContain(
      'extracted_wrong: listed as "English Country Dance" on 2026-10-09: the wrong night',
    );
    expect(line("Kizomba Thursday")).toContain("no_source_known");

    const [run] = await db.select().from(evalRuns);
    expect(run).toMatchObject({
      kind: "recall",
      date: NIGHT,
      metrics: { found: 3, missed: 5 },
    });
  });

  it("says why a known source was not read", async () => {
    await db.update(sources).set({ enabled: false }).where(eq(sources.id, src.sobs!.id));
    await db
      .update(sources)
      .set({ health: { consecutiveFailures: 3, lastError: "HTTP 503" } })
      .where(eq(sources.id, src.cdny!.id));
    // A fetch that failed is no read; one after the night is too late.
    await fetched("remix", "2026-10-07T14:00:00Z", null, 404);
    await fetched("frimfram", "2026-10-12T14:00:00Z", "Frim Fram Jam");
    const { rows } = parseRecallCsv(
      `title,source_url
Rhythm Revue,https://sobs.com/calendar
English Country Dance,https://cdny.org/
Swing Remix,https://swingremixnyc.com/
Frim Fram Jam,https://frimframjam.com/
`,
    );
    const report = await evaluateRecall(db, "nyc", NIGHT, rows, []);
    expect(report.missesByCause.source_not_harvested).toBe(4);
    const misses = report.lines.filter((l) => l.startsWith("  line"));
    expect(misses).toEqual([
      '  line 2 "Rhythm Revue": source_not_harvested: https://sobs.com/calendar (switched off)',
      '  line 3 "English Country Dance": source_not_harvested: https://cdny.org/calendar-events (failing: HTTP 503)',
      '  line 4 "Swing Remix": source_not_harvested: https://swingremixnyc.com/ (not fetched before the night)',
      '  line 5 "Frim Fram Jam": source_not_harvested: https://frimframjam.com/calendar (not fetched before the night)',
    ]);
    expect(await db.select().from(evalRuns)).toEqual([]);
  });

  it("finds a night on its own event page under any title", async () => {
    await write("frimfram", [
      {
        ...listing("frimfram", "ffj", {
          title: "Third Thursdays w/ Eyal Vilner",
          dancing_time: "20:30",
          ticket_url: "https://frimframjam.com/calendar/20261008",
        }),
      },
    ]);
    const { rows } = parseRecallCsv(
      "title,start_time,source_url\nFrim Fram Jam,8:30pm,https://frimframjam.com/calendar/20261008\n",
    );
    expect((await evaluateRecall(db, "nyc", NIGHT, rows, [])).found).toBe(1);
  });

  it("refuses a metro it does not know", async () => {
    await expect(evaluateRecall(db, "atlantis", NIGHT, [], [])).rejects.toThrow(
      'no metro "atlantis"',
    );
  });
});
