// D-121: a venue's whole calendar is marked on its source row (`sources.mixed_calendar`), so a
// calendar discovery found is screened like SOB's, which was keyed by starting address only.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, sources } from "@/src/db/schema";
import { createPoliteHttp } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro, loadSources, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-04T16:00:00Z");
const PAGE = "https://venue.example/events/";
const FEED = "https://venue.example/events/?ical=1";

const ICS = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//venue//EN",
  "BEGIN:VEVENT",
  "UID:concert@venue.example",
  "DTSTART;TZID=America/New_York:20261006T190000",
  "DTEND;TZID=America/New_York:20261006T210000",
  "SUMMARY:Jazz Trio Live",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:salsa@venue.example",
  "DTSTART;TZID=America/New_York:20261007T210000",
  "DTEND;TZID=America/New_York:20261008T010000",
  "SUMMARY:Salsa Night",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

let db: Db;
let metro: Metro;

function http() {
  let t = NOW.getTime();
  return createPoliteHttp({
    userAgent: "DanceTonightBot/1.0",
    now: () => t,
    sleep: async (ms) => void (t += ms),
    transport: async (req) => {
      const body = req.url.endsWith("/robots.txt")
        ? "User-agent: *\nDisallow:\n"
        : req.url === FEED
          ? ICS
          : "";
      return { url: req.url, status: 200, headers: { "content-type": "text/calendar" }, body };
    },
  });
}

describeDb("a venue's whole calendar, stored on its source (D-121)", () => {
  beforeAll(async () => {
    db = await testDb("mixed_calendar");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
  });

  it("is set by a starting address, kept by a link found on a page, and changed only by a caller that says", async () => {
    const seed = {
      url: PAGE,
      kind: "html" as const,
      trustTier: "first_party" as const,
      discoveredBy: "seed_list" as const,
    };
    expect((await upsertSource(db, metro.id, { ...seed, mixedCalendar: true })).mixedCalendar).toBe(
      true,
    );
    // A page that links here says nothing about it.
    expect(
      (await upsertSource(db, metro.id, { ...seed, discoveredBy: "probe" })).mixedCalendar,
    ).toBe(true);
    expect((await loadSources(db, metro.id))[0]?.mixedCalendar).toBe(true);
    // The starting list dropping the flag clears it.
    expect(
      (await upsertSource(db, metro.id, { ...seed, mixedCalendar: false })).mixedCalendar,
    ).toBe(false);
    // A new row with nothing said is not a venue's whole calendar.
    expect(
      (await upsertSource(db, metro.id, { ...seed, url: "https://other.example/" })).mixedCalendar,
    ).toBe(false);
  });

  it("screens the concerts of a calendar discovery found, as it does SOB's", async () => {
    const write = async (mixed: boolean) => {
      await resetDb();
      await db.insert(metros).values({
        id: metro.id,
        slug: "nyc",
        name: "New York",
        countryCode: "US",
        center: { lat: 40.7128, lng: -74.006 },
        radiusKm: 40,
        tz: "America/New_York",
        languages: ["en"],
      });
      // A starting address flagged before and not flagged on today's list (Big Apple Ranch).
      await upsertSource(db, metro.id, {
        url: "https://bigappleranch.com/",
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
        mixedCalendar: true,
      });
      // Written as discovery writes it: no starting address names this venue.
      await upsertSource(db, metro.id, {
        url: PAGE,
        kind: "feed_ics",
        feedUrl: FEED,
        trustTier: "first_party",
        discoveredBy: "venue_websites",
        mixedCalendar: mixed,
      });
      await runIngest({ db, metro, http: http(), now: () => NOW, env: {}, only: [PAGE] });
      return (
        await db
          .select({ title: events.title })
          .from(events)
          .where(eq(events.status, "active"))
          .orderBy(events.title)
      ).map((r) => r.title);
    };
    expect(await write(true)).toEqual(["Salsa Night"]);
    // The run stored the starting list's own flags: SOB's is a venue's whole calendar.
    const flagged = await db
      .select({ url: sources.url, mixed: sources.mixedCalendar })
      .from(sources)
      .where(eq(sources.url, "https://sobs.com/calendar"));
    expect(flagged).toEqual([{ url: "https://sobs.com/calendar", mixed: true }]);
    const cleared = await db
      .select({ mixed: sources.mixedCalendar })
      .from(sources)
      .where(eq(sources.url, "https://bigappleranch.com/"));
    expect(cleared).toEqual([{ mixed: false }]);
    expect(await write(false)).toEqual(["Jazz Trio Live", "Salsa Night"]);
    const [row] = await db
      .select({ mixed: sources.mixedCalendar })
      .from(sources)
      .where(eq(sources.url, PAGE));
    expect(row?.mixed).toBe(false);
  });
});
