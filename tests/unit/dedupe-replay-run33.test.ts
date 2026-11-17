// Run 33's 83 live listings, replayed through the store and dedupe (D-090). The rows are the event
// pages as the site printed them after run 33 (docs/briefs/data/run33-rows.json): title, night,
// family and kind, times, venue and point, organiser and source. They go through the real
// normaliser and writer, then one dedupe pass, and the test names every merge night by night.
//
// Eventbrite's organiser is replayed twice: as production stores it today (its Eventbrite page,
// which links nothing), and as the mapping version bump re-writes it (its website, cdny.org, as
// run 33's own API response gives it).

import { readFileSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { FAMILIES, STYLES } from "@/config/styles";
import { METRO_SOURCES } from "@/config/sources";
import type { HarvestedListing, Metro, Source, TrustTier } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { metros } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro, formatDedupeReport } from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

interface Row {
  slug: string;
  night: string;
  title: string;
  fam: string;
  when: string;
  where: string[];
  who: string[];
  srcHosts: string[];
  geo: [number, number] | null;
}

const ROWS = JSON.parse(
  readFileSync(path.join(process.cwd(), "docs/briefs/data/run33-rows.json"), "utf8"),
) as Row[];
const NOW = new Date("2026-09-29T22:43:00Z");
const NIGHTS = [...new Set(ROWS.map((r) => r.night))].sort();
const EVENTBRITE_PAGE = "https://www.eventbrite.com/o/cdny-115478120751";
const TICKETING = new Set(["eventbrite.com", "ticketmaster.com", "ticketweb.com", "axs.com"]);

const TYPES: Array<[string, string]> = [
  ["Social dance", "social"],
  ["Class", "class"],
  ["Jam", "jam"],
  ["Práctica", "practica"],
  ["Club or DJ night", "club_night"],
  ["Festival session", "festival_session"],
];

/** The family the page printed first, and the kind of night after it. */
function kindOf(fam: string): { styles: string[]; type: string } {
  const family = FAMILIES.map((f) => ({ f, at: fam.indexOf(f.label) }))
    .filter((x) => x.at >= 0)
    .sort((x, y) => x.at - y.at)[0]?.f;
  const rest = family ? fam.slice(fam.indexOf(family.label) + family.label.length) : fam;
  const type = TYPES.find(([label]) => rest.startsWith(label))?.[1] ?? "other";
  const style = family ? STYLES.find((s) => s.family === family.key)?.key : undefined;
  return { styles: style ? [style] : [], type };
}

function timesOf(when: string): Record<string, string> {
  const out: Record<string, string> = {};
  const kinds: Record<string, string> = {
    Doors: "doors_time",
    Lesson: "lesson_time",
    "Dancing starts": "dancing_time",
    Ends: "end_time",
  };
  for (const m of when.matchAll(
    /(\d{1,2})(?::(\d{2}))?(am|pm)(Doors|Lesson|Dancing starts|Ends)/g,
  )) {
    let h = Number(m[1]) % 12;
    if (m[3] === "pm") h += 12;
    out[kinds[m[4]!]!] = `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`;
  }
  return out;
}

let db: Db;
let metro: Metro;

async function sourceFor(host: string): Promise<Source> {
  const seed = (METRO_SOURCES.nyc ?? []).find(
    (s) => new URL(s.url).hostname.replace(/^www\./, "") === host,
  );
  const trustTier: TrustTier =
    seed?.trustTier ?? (TICKETING.has(host) ? "ticketing" : "first_party");
  return upsertSource(db, metro.id, {
    url: seed?.url ?? (host === "eventbrite.com" ? EVENTBRITE_PAGE : `https://${host}/`),
    kind: TICKETING.has(host) ? "ticketing_api" : "html",
    trustTier,
    discoveredBy: "seed_list",
  });
}

async function replay(eventbriteWebsite: string) {
  const bySource = new Map<
    string,
    { source: Source; list: NonNullable<ReturnType<typeof normalize>>[] }
  >();
  function normalize(row: Row, source: Source) {
    const { styles, type } = kindOf(row.fam);
    const place = row.where[0] && row.where[0] !== "Location not listed" ? row.where[0] : null;
    const organizer =
      row.who[0] && row.who[0] !== "Not listed"
        ? {
            name: row.who[0],
            url:
              row.who[1] === "eventbrite.com"
                ? eventbriteWebsite
                : row.who[1]
                  ? `https://${row.who[1]}/`
                  : null,
          }
        : {};
    const harvested: HarvestedListing = {
      listing: rawListingSchema.parse({
        title: row.title,
        listing_type: type,
        styles,
        local_date: row.night,
        ...timesOf(row.when),
        venue: place ? { name: place, address: row.where[1] ?? null } : {},
        organizer,
      }),
      externalId: row.slug,
      tz: null,
      venueLocation: row.geo ? { lat: row.geo[0], lng: row.geo[1] } : null,
      recurrence: null,
      provenance: { sourceUrl: `${source.url}#${row.slug}`, fetchedAt: NOW, method: "feed" },
    };
    const outcome = normalizeListing(harvested, { metro, source, now: NOW });
    // A row today's screens leave out (D-083) is not on the site after the next run either.
    if (!outcome.ok) {
      rejected.push(`${row.title}: ${outcome.reason}`);
      return null;
    }
    return outcome.event;
  }
  const rejected: string[] = [];
  for (const row of ROWS) {
    const host = row.srcHosts[0]!;
    const entry = bySource.get(host) ?? { source: await sourceFor(host), list: [] };
    const event = normalize(row, entry.source);
    if (event) entry.list.push(event);
    bySource.set(host, entry);
  }
  for (const { source, list } of bySource.values()) {
    await writeEvents(db, {
      metro,
      source,
      events: list,
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: (input) => resolveVenue(db, metro, input),
    });
  }
  const count = async () =>
    Object.fromEntries(
      [
        ...(await db.execute<{ night: string; n: number }>(sql`
          select night_date::text as night, count(*)::int as n from events
          where status in ('active', 'cancelled') group by 1 order by 1
        `)),
      ].map((r) => [r.night, Number(r.n)]),
    );
  const before = await count();
  const report = await dedupeMetro(db, metro, NIGHTS);
  const after = await count();
  return { before, after, report, rejected };
}

describeDb("run 33's live rows, replayed through dedupe", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_replay");
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
  });

  it("merges the two nights This Week in Swing lists under the organiser's name, while Eventbrite still stores its own page", async () => {
    const { before, after, report, rejected } = await replay(EVENTBRITE_PAGE);
    console.log(rejected);
    expect(Object.values(before).reduce((a, b) => a + b, 0)).toBe(83 - rejected.length);
    expect(
      report.mergedPairs.map((m) => `${m.night} ${m.survivor} <- ${m.merged} (${m.by})`),
    ).toEqual([
      "2026-10-03 The Brooks Prumo Orchestra <- Swing Remix (named)",
      "2026-10-08 NYLX Warmup w/ DJs TJ Savino & Claire Lorman <- Frim Fram Jam (named)",
    ]);
    expect(Object.values(after).reduce((a, b) => a + b, 0)).toBe(83 - rejected.length - 2);
    console.log(["Replay, Eventbrite as stored today:", ...formatDedupeReport(report)].join("\n"));
  });

  it("also merges CDNY's Eventbrite nights once the mapping version re-writes its organiser's website", async () => {
    const { before, after, report } = await replay("https://cdny.org/");
    expect(
      report.mergedPairs.map((m) => `${m.night} ${m.survivor} <- ${m.merged} (${m.by})`),
    ).toEqual([
      "2026-09-29 English - Tuesdays <- English Country Dancing @ The Church of The Village (same_site)",
      "2026-10-03 The Brooks Prumo Orchestra <- Swing Remix (named)",
      "2026-10-06 English - Tuesdays <- English Country Dancing @ The Church of The Village (same_site)",
      "2026-10-08 NYLX Warmup w/ DJs TJ Savino & Claire Lorman <- Frim Fram Jam (named)",
      "2026-10-10 Special Double Contra Dance <- Fall Fling Double Dance (same_site)",
    ]);
    expect(report).toMatchObject({ merged: 5, linked: 5, conflicting: 0 });
    const changed = NIGHTS.filter((n) => before[n] !== after[n]).map(
      (n) => `${n}: ${before[n]} -> ${after[n]}`,
    );
    expect(changed).toEqual([
      "2026-09-29: 7 -> 6",
      "2026-10-03: 11 -> 10",
      "2026-10-06: 6 -> 5",
      "2026-10-08: 4 -> 3",
      "2026-10-10: 11 -> 10",
    ]);
    console.log(
      ["Replay, Eventbrite re-written:", ...formatDedupeReport(report), ...changed].join("\n"),
    );
  });
});
