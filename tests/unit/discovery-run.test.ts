import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { metros, sources, venues } from "@/src/db/schema";
import {
  formatDiscoveryReport,
  runVenueDiscovery,
  VENUE_WEBSITES,
} from "@/src/pipeline/discovery/run";
import { GATE_VERSION } from "@/src/pipeline/discovery/gate";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { loadMetro, pipelineId, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-10-04T16:00:00Z");
const METRO_ID = "11111111-1111-4111-8111-111111111111";
const BROOKLYN = { lat: 40.7081, lng: -73.9571 };

const ok = (url: string, body: string, finalUrl = url): Fixture => ({
  request: { method: "GET", url },
  response: { url: finalUrl, status: 200, headers: { "content-type": "text/html" }, body },
});
const robots = (origin: string) => ok(`${origin}/robots.txt`, "User-agent: *\nDisallow:\n");

const FIXTURES: Fixture[] = [
  // A club whose events page runs The Events Calendar.
  robots("https://feedclub.example"),
  ok("https://feedclub.example/", '<h1>Feed Club</h1><a href="/events">Events</a>'),
  ok("https://feedclub.example/events", '<div class="tribe-events-calendar"></div>'),
  // A dead domain.
  robots("https://gone.example"),
  {
    request: { method: "GET", url: "https://gone.example/" },
    response: { url: "https://gone.example/", status: 410, headers: {}, body: "" },
  },
  // A lounge whose page names its events but carries nothing structured.
  robots("https://lounge.example"),
  ok("https://lounge.example/", '<h1>Lounge Nine</h1><a href="/calendar">Calendar</a>'),
  ok("https://lounge.example/calendar", "<p>Fri Oct 9: Disco night</p>"),
  // A lounge on Squarespace: no reader takes its list without a model until lane 3's.
  robots("https://sqs.example"),
  ok(
    "https://sqs.example/",
    '<h1>Square Lounge</h1><script src="https://static1.squarespace.com/x.js"></script><div class="eventlist eventlist--upcoming"><article class="eventlist-event eventlist-event--upcoming"></article></div>',
  ),
  // A club whose home page redirects to another domain (here a starting address we hold).
  robots("http://oldsobs.example"),
  ok("http://oldsobs.example/", "<h1>Old SOBs</h1>", "https://sobs.example/"),
];

let db: Db;
let metro: Metro;

function httpAt(fixtures: Fixture[]) {
  let t = NOW.getTime();
  return createPoliteHttp({
    transport: fixtureTransport(fixtures),
    userAgent: "DanceTonightBot/1.0 (+https://dancetonight.vercel.app/bot)",
    now: () => t,
    sleep: async (ms) => void (t += ms),
  });
}

describeDb("venue-website discovery, end to end over fixtures", () => {
  beforeAll(async () => {
    db = await testDb("discovery_run");
  });
  afterAll(closeTestDb);

  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    const place = (id: string, name: string, kind: "night_club" | "bar", websiteUrl: string) => ({
      id,
      name,
      nameNormalized: name.toLowerCase(),
      location: BROOKLYN,
      tz: "America/New_York",
      kind,
      danceFloor: kind === "night_club" ? ("yes" as const) : ("unknown" as const),
      websiteUrl,
      metroId: METRO_ID,
    });
    await db
      .insert(venues)
      .values([
        place(
          "00000000-0000-4000-8000-000000000001",
          "Feed Club",
          "night_club",
          "https://feedclub.example/",
        ),
        place(
          "00000000-0000-4000-8000-000000000002",
          "Gone Club",
          "night_club",
          "https://gone.example/",
        ),
        place(
          "00000000-0000-4000-8000-000000000003",
          "Lounge Nine",
          "bar",
          "https://lounge.example/",
        ),
        place(
          "00000000-0000-4000-8000-000000000004",
          "Old SOBs",
          "night_club",
          "http://oldsobs.example/",
        ),
        place(
          "00000000-0000-4000-8000-000000000005",
          "Starting Club",
          "night_club",
          "https://seeded.example/",
        ),
        place(
          "00000000-0000-4000-8000-000000000006",
          "Square Lounge",
          "bar",
          "https://sqs.example/",
        ),
      ]);
    await upsertSource(db, METRO_ID, {
      url: "https://sobs.example/",
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("stores every probed host, holds what a reader could take, and names it all", async () => {
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt(FIXTURES),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });
    expect(report.probed.map((l) => [l.host, l.status, l.stored])).toEqual([
      ["feedclub.example", "structured", "source"],
      ["gone.example", "dead", "off"],
      ["oldsobs.example", "moved", "off"],
      ["lounge.example", "page_only", "off"],
      ["sqs.example", "structured", "source"],
    ]);
    expect(report.skipped.map((s) => [s.host, s.reason])).toEqual([
      ["seeded.example", "already a source"],
    ]);

    const rows = await db
      .select({
        url: sources.url,
        kind: sources.kind,
        platform: sources.platform,
        enabled: sources.enabled,
        mixed: sources.mixedCalendar,
        venueId: sources.venueId,
        discoveredBy: sources.discoveredBy,
        status: sources.health,
      })
      .from(sources)
      .orderBy(sources.url);
    expect(
      rows.map((r) => [
        r.url,
        r.kind,
        r.enabled,
        r.mixed,
        r.discoveredBy,
        r.status.discovery?.status ?? null,
      ]),
    ).toEqual(
      [
        ["http://oldsobs.example/", "html", false, true, "venue_websites", "moved"],
        // A calendar a reader takes is switched on, screened as a venue's whole calendar (D-121).
        ["https://feedclub.example/events", "wp_tribe", true, true, "venue_websites", "structured"],
        ["https://gone.example/", "html", false, true, "venue_websites", "dead"],
        ["https://lounge.example/calendar", "html", false, true, "venue_websites", "page_only"],
        ["https://sqs.example/", "squarespace", true, true, "venue_websites", "structured"],
        // The starting address the redirect reached is never written over.
        ["https://sobs.example/", "html", true, false, "seed_list", null],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    // Each row remembers its place's group, which decides what may switch on unread (D-120).
    expect(
      rows.find((r) => r.url === "https://feedclub.example/events")?.status.discovery?.group,
    ).toBe("dance or salsa club");
    expect(rows.find((r) => r.url === "https://sqs.example/")?.status.discovery?.group).toBe(
      "lounge",
    );
    expect(rows.find((r) => r.url === "https://feedclub.example/events")?.venueId).toBe(
      "00000000-0000-4000-8000-000000000001",
    );

    const text = formatDiscoveryReport(report);
    for (const host of [
      "feedclub.example",
      "gone.example",
      "lounge.example",
      "oldsobs.example",
      "seeded.example",
    ])
      expect(text).toContain(host);
    // A lounge's readable calendar switches on unread (D-559): nothing waits for the gate.
    expect(text).not.toContain("held: a lounge's calendar waits for the dance gate");
    expect(text).toContain("the site redirects to sobs.example");

    // The next run asks nothing: every host has its row.
    const again = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([]),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });
    expect(again.probed).toEqual([]);
    expect(again.skipped.map((s) => [s.host, s.reason, s.detail.split(":")[0]])).toEqual([
      ["feedclub.example", "already a source", "https"],
      ["seeded.example", "already a source", "https"],
      ["sqs.example", "already a source", "https"],
      ["gone.example", "probed before", "dead"],
      ["lounge.example", "probed before", "page_only"],
      ["oldsobs.example", "probed before", "moved"],
    ]);
  });

  it("writes one row for a calendar two candidates reach, and marks the other host off with no platform", async () => {
    await resetDb();
    await db.insert(metros).values({
      id: METRO_ID,
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    const base = {
      nameNormalized: "x",
      location: BROOKLYN,
      tz: "America/New_York",
      kind: "night_club" as const,
      danceFloor: "yes" as const,
      metroId: METRO_ID,
    };
    await db.insert(venues).values([
      {
        ...base,
        id: "00000000-0000-4000-8000-000000000011",
        name: "Twin Club",
        websiteUrl: "https://twin.example/",
      },
      {
        ...base,
        id: "00000000-0000-4000-8000-000000000012",
        name: "Twin Club Calendar",
        websiteUrl: "https://calendar.twin.example/",
      },
    ]);
    const calendar =
      '<h1>Twin Club</h1><link rel="alternate" type="text/calendar" href="https://calendar.twin.example/feed.ics">';
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([
        robots("https://twin.example"),
        ok(
          "https://twin.example/",
          '<h1>Twin Club</h1><a href="https://calendar.twin.example/events">Calendar</a>',
        ),
        robots("https://calendar.twin.example"),
        ok("https://calendar.twin.example/", calendar),
        ok("https://calendar.twin.example/events", calendar),
      ]),
      now: () => NOW,
      seedUrls: [],
    });
    expect(report.probed.map((l) => l.stored).sort()).toEqual(["source", "untouched"]);
    const rows = await db
      .select({
        url: sources.url,
        kind: sources.kind,
        platform: sources.platform,
        feedUrl: sources.feedUrl,
        enabled: sources.enabled,
      })
      .from(sources)
      .orderBy(sources.url);
    expect(rows).toEqual([
      {
        url: "https://calendar.twin.example/",
        kind: "feed_ics",
        platform: null,
        feedUrl: "https://calendar.twin.example/feed.ics",
        enabled: true,
      },
      {
        url: "https://twin.example/",
        kind: "html",
        platform: "probed",
        feedUrl: null,
        enabled: false,
      },
    ]);
  });

  it("leaves a host alone when an earlier site of the run already wrote its calendar there", async () => {
    await db.insert(venues).values({
      id: "00000000-0000-4000-8000-000000000021",
      name: "Pair Club",
      nameNormalized: "pair club",
      location: BROOKLYN,
      tz: "America/New_York",
      kind: "night_club",
      danceFloor: "yes",
      websiteUrl: "https://pair.example/",
      metroId: METRO_ID,
    });
    await db.insert(venues).values({
      id: "00000000-0000-4000-8000-000000000022",
      name: "Pair Club Tickets",
      nameNormalized: "pair club tickets",
      location: BROOKLYN,
      tz: "America/New_York",
      // A lounge comes after the club, so the club's probe has written before this one starts.
      kind: "bar",
      danceFloor: "unknown",
      websiteUrl: "https://calendar.pair.example/",
      metroId: METRO_ID,
    });
    const feed = '<h1>Pair Club</h1><link rel="alternate" type="text/calendar" href="/feed.ics">';
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([
        ...FIXTURES,
        robots("https://pair.example"),
        ok(
          "https://pair.example/",
          '<h1>Pair Club</h1><a href="https://calendar.pair.example/events">Calendar</a>',
        ),
        robots("https://calendar.pair.example"),
        ok("https://calendar.pair.example/events", feed),
      ]),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
      concurrency: 1,
    });
    expect(
      report.probed.filter((l) => l.host.includes("pair")).map((l) => [l.host, l.stored]),
    ).toEqual([
      ["pair.example", "source"],
      ["calendar.pair.example", "untouched"],
    ]);
    const rows = await db.select({ url: sources.url }).from(sources).orderBy(sources.url);
    expect(rows.map((r) => r.url).filter((u) => u.includes("pair"))).toEqual([
      "https://calendar.pair.example/events",
      "https://pair.example/",
    ]);
  });

  it("rechecks Squarespace rows stored under old rule (D-137)", async () => {
    // Insert squarespace rows with no feedUrl
    await db.insert(sources).values([
      {
        id: pipelineId("source", "https://sqs-events.example/"),
        url: "https://sqs-events.example/",
        kind: "squarespace",
        metroId: METRO_ID,
        trustTier: "first_party" as const,
        discoveredBy: VENUE_WEBSITES,
        enabled: true,
        feedUrl: null,
        health: {
          discovery: {
            status: "structured",
            reason: "old rule",
            probedAt: "2026-10-04T21:00:00.000Z",
            group: "dance or salsa club",
          },
        },
      },
      {
        id: pipelineId("source", "https://sqs-noevents.example/"),
        url: "https://sqs-noevents.example/",
        kind: "squarespace",
        metroId: METRO_ID,
        trustTier: "first_party" as const,
        discoveredBy: VENUE_WEBSITES,
        enabled: true,
        feedUrl: null,
        health: {
          discovery: {
            status: "structured",
            reason: "old rule",
            probedAt: "2026-10-04T21:00:00.000Z",
            group: "dance or salsa club",
          },
        },
      },
    ]);

    const fixtures: Fixture[] = [
      robots("https://sqs-events.example"),
      ok(
        "https://sqs-events.example/",
        '<h1>Club</h1><script src="https://static1.squarespace.com/x.js"></script><a href="/events">Events</a>',
      ),
      robots("https://sqs-noevents.example"),
      ok(
        "https://sqs-noevents.example/",
        '<h1>Club</h1><script src="https://static1.squarespace.com/x.js"></script><a href="/about">About</a>',
      ),
    ];

    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt(fixtures),
      now: () => NOW,
      limit: 0,
      seedUrls: [],
    });

    expect(report.rechecked).toHaveLength(2);
    const eventsPage = report.rechecked.find((r) => r.url === "https://sqs-events.example/");
    const switchedOff = report.rechecked.find((r) => r.url === "https://sqs-noevents.example/");
    expect(eventsPage?.outcome).toBe("events_page");
    expect(eventsPage?.feedUrl).toBe("https://sqs-events.example/events");
    expect(switchedOff?.outcome).toBe("switched_off");
    expect(switchedOff?.feedUrl).toBeNull();

    // Check database updates
    const rows = await db
      .select({ url: sources.url, enabled: sources.enabled, feedUrl: sources.feedUrl })
      .from(sources)
      .where(
        sql`${sources.url} in ('https://sqs-events.example/', 'https://sqs-noevents.example/')`,
      )
      .orderBy(sources.url);

    expect(rows[0]).toMatchObject({
      url: "https://sqs-events.example/",
      enabled: true,
      feedUrl: "https://sqs-events.example/events",
    });
    expect(rows[1]).toMatchObject({
      url: "https://sqs-noevents.example/",
      enabled: false,
      feedUrl: null,
    });
  });

  it("switches on a calendar an earlier run held, Squarespace included, with the screen", async () => {
    const held = (
      url: string,
      kind: "feed_ics" | "squarespace",
      group = "dance or salsa club",
    ) => ({
      id: pipelineId("source", url),
      url,
      kind,
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: "venue_websites",
      enabled: false,
      health: {
        discovery: {
          status: "held",
          reason:
            "the page names an iCalendar feed; held until discovered calendars carry the mixed-calendar screen (D-083)",
          probedAt: "2026-10-04T21:00:00.000Z",
          group,
        },
      },
    });
    await db.insert(sources).values([
      held("https://thecopa.example/", "feed_ics"),
      held("https://squared.example/", "squarespace"),
      // A lounge's feed now switches on (D-559).
      held("https://brewery.example/", "feed_ics", "lounge"),
      // A studio's feed still waits.
      held("https://studio.example/", "feed_ics", "dance studio"),
    ]);
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([
        robots("https://squared.example"),
        ok(
          "https://squared.example/",
          '<h1>Squared</h1><script src="https://static1.squarespace.com/x.js"></script><div class="eventlist eventlist--upcoming"><article class="eventlist-event eventlist-event--upcoming"></article></div>',
        ),
      ]),
      now: () => NOW,
      limit: 0,
      seedUrls: [],
    });
    expect(report.released).toEqual([
      { url: "https://brewery.example/", kind: "feed_ics" },
      { url: "https://squared.example/", kind: "squarespace" },
      { url: "https://thecopa.example/", kind: "feed_ics" },
    ]);
    const rows = await db
      .select({
        url: sources.url,
        enabled: sources.enabled,
        mixed: sources.mixedCalendar,
        health: sources.health,
      })
      .from(sources)
      .where(
        sql`${sources.url} in ('https://thecopa.example/', 'https://squared.example/', 'https://brewery.example/', 'https://studio.example/')`,
      )
      .orderBy(sources.url);
    expect(rows.map((r) => [r.url, r.enabled, r.mixed, r.health.discovery?.status])).toEqual([
      ["https://brewery.example/", true, true, "structured"],
      ["https://squared.example/", true, true, "structured"],
      ["https://studio.example/", false, false, "held"],
      ["https://thecopa.example/", true, true, "structured"],
    ]);
    expect(rows.find((r) => r.url === "https://thecopa.example/")?.health.discovery?.reason).toBe(
      "the page names an iCalendar feed; switched on with the mixed-calendar screen (D-121)",
    );
    expect(formatDiscoveryReport(report)).toContain("https://thecopa.example/ [feed_ics]");
    // The studio row remains held.
    const studioRow = rows.find((r) => r.url === "https://studio.example/");
    expect(studioRow?.enabled).toBe(false);
  });

  it("gates a club's page-only events page once, the one probed before the gate included (D-124)", async () => {
    await db.insert(venues).values({
      id: "00000000-0000-4000-8000-000000000041",
      name: "Nova Club",
      nameNormalized: "nova club",
      location: BROOKLYN,
      tz: "America/New_York",
      kind: "night_club",
      danceFloor: "yes",
      websiteUrl: "https://novaclub.example/",
      metroId: METRO_ID,
    });
    // As the run of 2026-10-04 stored it: page only, switched off, no verdict.
    await db.insert(sources).values({
      id: pipelineId("source", "https://novaclub.example/events"),
      url: "https://novaclub.example/events",
      kind: "html",
      platform: "probed",
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: "venue_websites",
      enabled: false,
      mixedCalendar: true,
      health: {
        discovery: {
          status: "page_only",
          reason: "an events page with no feed or structured events",
          probedAt: "2026-10-04T21:00:00.000Z",
          group: "dance or salsa club",
        },
      },
    });
    const nova: Fixture[] = [
      robots("https://novaclub.example"),
      ok("https://novaclub.example/", '<h1>Nova Club</h1><a href="/events">Events</a>'),
      ok(
        "https://novaclub.example/events",
        "<p>October 9, 2026 11:00 PM JULIAN JORDAN</p><p>October 10, 2026 11:00 PM KAAZE</p>",
      ),
    ];
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([...FIXTURES, ...nova]),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });
    const line = report.probed.find((l) => l.host === "novaclub.example");
    expect([line?.status, line?.stored]).toEqual(["page_only", "source"]);
    expect(line?.reason).toContain("dance gate: 2 dates to come on a dance club's page");
    // The lounge's one dated night does not pass.
    expect(report.probed.find((l) => l.host === "lounge.example")?.reason).toContain(
      "dance gate: one date to come, no weekly night",
    );
    const [row] = await db
      .select({ enabled: sources.enabled, mixed: sources.mixedCalendar, health: sources.health })
      .from(sources)
      .where(sql`${sources.url} = 'https://novaclub.example/events'`);
    expect([row!.enabled, row!.mixed]).toEqual([true, true]);
    expect(row!.health.discovery?.gate?.pass).toBe(true);

    // Judged once: the next run asks nothing of either.
    const again = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([]),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });
    expect(again.probed).toEqual([]);
  });

  it("stores the new verdict for a page an older dance gate held, and leaves a current verdict alone (D-514)", async () => {
    // Nova Club (held under older version)
    await db.insert(venues).values({
      id: "00000000-0000-4000-8000-000000000041",
      name: "Nova Club",
      nameNormalized: "nova club",
      location: BROOKLYN,
      tz: "America/New_York",
      kind: "night_club",
      danceFloor: "yes",
      websiteUrl: "https://novaclub.example/",
      metroId: METRO_ID,
    });
    await db.insert(sources).values({
      id: pipelineId("source", "https://novaclub.example/events"),
      url: "https://novaclub.example/events",
      kind: "html",
      platform: "probed",
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: "venue_websites",
      enabled: false,
      mixedCalendar: true,
      health: {
        discovery: {
          status: "page_only",
          reason: "an events page with no feed or structured events",
          probedAt: "2026-10-01T21:00:00.000Z",
          group: "dance or salsa club",
          gate: {
            pass: false,
            reason: "no dates to come and no weekly night",
            version: GATE_VERSION - 1,
          },
        },
      },
    });
    // Vega Club (held under current version)
    await db.insert(venues).values({
      id: "00000000-0000-4000-8000-000000000042",
      name: "Vega Club",
      nameNormalized: "vega club",
      location: BROOKLYN,
      tz: "America/New_York",
      kind: "night_club",
      danceFloor: "yes",
      websiteUrl: "https://vegaclub.example/",
      metroId: METRO_ID,
    });
    await db.insert(sources).values({
      id: pipelineId("source", "https://vegaclub.example/events"),
      url: "https://vegaclub.example/events",
      kind: "html",
      platform: "probed",
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: "venue_websites",
      enabled: false,
      mixedCalendar: true,
      health: {
        discovery: {
          status: "page_only",
          reason: "an events page with no feed or structured events",
          probedAt: "2026-10-01T21:00:00.000Z",
          group: "dance or salsa club",
          gate: {
            pass: false,
            reason: "no dates to come and no weekly night",
            version: GATE_VERSION,
          },
        },
      },
    });
    const novaFixtures: Fixture[] = [
      robots("https://novaclub.example"),
      ok("https://novaclub.example/", '<h1>Nova Club</h1><a href="/events">Events</a>'),
      ok(
        "https://novaclub.example/events",
        "<p>October 9, 2026 11:00 PM JULIAN JORDAN</p><p>October 10, 2026 11:00 PM KAAZE</p>",
      ),
    ];
    const vegaFixtures: Fixture[] = [
      robots("https://vegaclub.example"),
      ok("https://vegaclub.example/", '<h1>Vega Club</h1><a href="/events">Events</a>'),
      ok(
        "https://vegaclub.example/events",
        "<p>October 9, 2026 11:00 PM JULIAN JORDAN</p><p>October 10, 2026 11:00 PM KAAZE</p>",
      ),
    ];
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([...FIXTURES, ...novaFixtures, ...vegaFixtures]),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });
    // Nova should be re-probed and switched on
    const novaLine = report.probed.find((l) => l.host === "novaclub.example");
    expect(novaLine).toBeDefined();
    expect([novaLine?.status, novaLine?.stored]).toEqual(["page_only", "source"]);
    expect(novaLine?.reason).not.toContain("already exists and is left as it is");
    const [novaRow] = await db
      .select({ enabled: sources.enabled, health: sources.health })
      .from(sources)
      .where(sql`${sources.url} = 'https://novaclub.example/events'`);
    expect(novaRow!.enabled).toBe(true);
    expect(novaRow!.health.discovery?.gate?.pass).toBe(true);
    expect(novaRow!.health.discovery?.gate?.version).toBe(GATE_VERSION);
    // Vega should not be re-probed
    const vegaLine = report.probed.find((l) => l.host === "vegaclub.example");
    expect(vegaLine).toBeUndefined();
    const [vegaRow] = await db
      .select({ enabled: sources.enabled, health: sources.health })
      .from(sources)
      .where(sql`${sources.url} = 'https://vegaclub.example/events'`);
    expect(vegaRow!.enabled).toBe(false);
    expect(vegaRow!.health.discovery?.gate?.pass).toBe(false);
    expect(vegaRow!.health.discovery?.gate?.version).toBe(GATE_VERSION);
  });

  it("re-probes a host after 60 days when its row is stale", async () => {
    // Insert a stale row for feedclub.example (which is seeded in the test)
    const staleDate = new Date(NOW);
    staleDate.setDate(staleDate.getDate() - 61);
    await db.insert(sources).values({
      id: pipelineId("source", "https://feedclub.example/"),
      url: "https://feedclub.example/",
      kind: "html",
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: VENUE_WEBSITES,
      enabled: false,
      health: {
        discovery: {
          status: "nothing",
          reason: "no events page",
          probedAt: staleDate.toISOString(),
          group: "dance or salsa club",
        },
      },
    });
    // Insert a non-stale row for lounge.example (10 days ago)
    const recentDate = new Date(NOW);
    recentDate.setDate(recentDate.getDate() - 10);
    await db.insert(sources).values({
      id: pipelineId("source", "https://lounge.example/"),
      url: "https://lounge.example/",
      kind: "html",
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: VENUE_WEBSITES,
      enabled: false,
      health: {
        discovery: {
          status: "nothing",
          reason: "no events page",
          probedAt: recentDate.toISOString(),
          group: "lounge",
        },
      },
    });

    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt(FIXTURES),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });

    // feedclub.example should be probed again (stale)
    const feedclubLine = report.probed.find((l) => l.host === "feedclub.example");
    expect(feedclubLine).toBeDefined();
    expect(feedclubLine?.reason).toContain("(re-probed after 60 days)");
    // lounge.example should be skipped (not stale)
    const loungeSkipped = report.skipped.find((s) => s.host === "lounge.example");
    expect(loungeSkipped?.reason).toBe("probed before");
  });

  it("switches off a calendar it switched on whose host is now skipped (aoh.com)", async () => {
    await db.insert(sources).values({
      id: pipelineId("source", "https://aoh.com/"),
      url: "https://aoh.com/",
      kind: "feed_ics",
      metroId: METRO_ID,
      trustTier: "first_party" as const,
      discoveredBy: "venue_websites",
      enabled: true,
      mixedCalendar: true,
      health: {
        discovery: {
          status: "structured",
          reason: "the page names an iCalendar feed",
          probedAt: "2026-10-04T21:00:00.000Z",
          group: "dance or salsa club",
        },
      },
    });
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([]),
      now: () => NOW,
      limit: 0,
      seedUrls: [],
    });
    expect(report.retired).toEqual([
      { url: "https://aoh.com/", reason: "a fraternal order's site, not a dance venue's" },
    ]);
    const [row] = await db
      .select({ enabled: sources.enabled, health: sources.health })
      .from(sources)
      .where(sql`${sources.url} = 'https://aoh.com/'`);
    expect(row!.enabled).toBe(false);
    expect(row!.health.discovery?.status).toBe("skipped");
    expect(formatDiscoveryReport(report)).toContain("https://aoh.com/: a fraternal order's site");
  });

  it("switches on a lounge's readable calendar (D-559)", async () => {
    await db.insert(venues).values({
      id: "00000000-0000-4000-8000-000000000031",
      name: "Brew Hall",
      nameNormalized: "brew hall",
      location: BROOKLYN,
      tz: "America/New_York",
      kind: "bar",
      danceFloor: "unknown",
      websiteUrl: "https://brewhall.example/",
      metroId: METRO_ID,
    });
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt([
        ...FIXTURES,
        robots("https://brewhall.example"),
        ok(
          "https://brewhall.example/",
          '<h1>Brew Hall</h1><link rel="alternate" type="text/calendar" href="/cal.ics">',
        ),
      ]),
      now: () => NOW,
      seedUrls: ["https://seeded.example/calendar"],
    });
    const line = report.probed.find((l) => l.host === "brewhall.example");
    expect(line).toMatchObject({ status: "structured", stored: "source" });
    expect(line?.reason).toBe("the page names an iCalendar feed");
  });

  it("probes no more hosts than the cap, best first, and counts the rest as waiting", async () => {
    const report = await runVenueDiscovery({
      db,
      metro,
      http: httpAt(FIXTURES),
      now: () => NOW,
      limit: 1,
      seedUrls: ["https://seeded.example/calendar"],
    });
    expect(report.probed.map((l) => l.host)).toEqual(["feedclub.example"]);
    expect(report.waiting).toBe(4);
  });
});
