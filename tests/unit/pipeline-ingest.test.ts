import { readFileSync } from "node:fs";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { costLog, events, fieldProvenance, metros, sources, venues } from "@/src/db/schema";
import type { AiClient } from "@/src/ai";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { formatReport, runIngest } from "@/src/pipeline/ingest";
import { setGlobalFlag } from "@/src/pipeline/runner";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  loadSources,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Thursday 2026-09-24, noon in New York: the ICS fixture's override night is tonight.
const NOW = new Date("2026-09-24T16:00:00Z");
const ICS = readFileSync(
  path.join(__dirname, "../../src/adapters/feeds/__fixtures__/salsa-example.ics"),
  "utf8",
);
const SITE = "https://salsa.example/";

const ok = (url: string, body: string, headers: Record<string, string> = {}): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers, body },
});

const FIXTURES: Fixture[] = [
  ok("https://salsa.example/robots.txt", "User-agent: *\nDisallow: /admin\n"),
  ok(
    SITE,
    `<html><head><link rel="alternate" type="text/calendar" href="/calendar.ics"></head>
     <body><a href="https://www.eventbrite.com/o/salsa-example-99887766554">Tickets</a>
     <a href="https://www.instagram.com/salsaexample/">Instagram</a></body></html>`,
  ),
  ok("https://salsa.example/calendar.ics", ICS, { etag: '"v1"' }),
];

let db: Db;
let metro: Metro;

function httpAt(fixtures: Fixture[], start: Date = NOW) {
  let t = start.getTime();
  return {
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport(fixtures),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  };
}

describeDb("one ingest run, end to end over fixtures", () => {
  beforeAll(async () => {
    db = await testDb("ingest");
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
    // An Overture-seeded venue the feed names without coordinates.
    await db.insert(venues).values({
      name: "Copacabana",
      nameNormalized: "copacabana",
      location: { lat: 40.7652, lng: -73.9942 },
      tz: "America/New_York",
      kind: "night_club",
      danceFloor: "yes",
      seedProvider: "overture test",
      metroId: metro.id,
    });
    await upsertSource(db, metro.id, {
      url: SITE,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  it("probes, harvests, places, writes and reports; a second run sees nothing new", async () => {
    const first = httpAt(FIXTURES);
    const report = await runIngest({ db, metro, env: {}, only: [SITE], ...first });

    expect(report.tonight).toBe("2026-09-24");
    expect(report.adapters.find((a) => a.id === "ticketmaster")?.gate).toMatchObject({
      run: false,
      reason: "not_configured",
    });
    const line = report.sources.find((s) => s.url === SITE)!;
    expect(line).toMatchObject({ status: "ok", adapter: "feed_ics" });
    expect(line.notes[0]).toBe("probed: the page names an iCalendar feed");
    // The Eventbrite organizer and the Instagram profile were recorded as sources of their own.
    expect(report.discovered).toBe(2);
    const kinds = await db.select({ url: sources.url, kind: sources.kind }).from(sources);
    expect(kinds).toEqual(
      expect.arrayContaining([
        { url: SITE, kind: "feed_ics" },
        { url: "https://www.eventbrite.com/o/salsa-example-99887766554", kind: "ticketing_api" },
        { url: "https://www.instagram.com/salsaexample/", kind: "social_link" },
      ]),
    );

    // Tonight: the rule's override night, placed on the seeded Copacabana.
    const tonight = await db
      .select({ title: events.title, venueId: events.venueId })
      .from(events)
      .where(eq(events.nightDate, "2026-09-24"));
    expect(tonight.map((e) => e.title)).toEqual(["Thursday Salsa Social (late start)"]);
    expect(tonight[0]?.venueId).not.toBeNull();
    expect(report.totals.tonightListed).toBe(1);
    expect(report.totals.written).toBe(line.written);
    expect(formatReport(report)).toContain("Listed for tonight: 1.");

    const count = async () =>
      (await db.select({ n: sql<number>`count(*)::int` }).from(events))[0]?.n;
    const before = await count();

    const second = httpAt(FIXTURES);
    const again = await runIngest({ db, metro, env: {}, only: [SITE], ...second });
    expect(again.sources.find((s) => s.url === SITE)?.status).toBe("unchanged");
    expect(await count()).toBe(before);

    // A full read reads the page again in full, never "unchanged" (D-251), and writes no duplicate.
    const third = httpAt(FIXTURES);
    const full = await runIngest({ db, metro, env: {}, only: [SITE], full: true, ...third });
    expect(full.sources.find((s) => s.url === SITE)?.status).toBe("ok");
    expect(await count()).toBe(before);
  });

  it("reads a Squarespace page with no events list with the model, never asking for ?format=json", async () => {
    const SQUARE = "https://square.example/events";
    await upsertSource(db, metro.id, {
      url: SQUARE,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const fixtures: Fixture[] = [
      // Squarespace's own robots.txt refuses the JSON view to every crawler.
      ok("https://square.example/robots.txt", "User-agent: *\nDisallow: /*?format=json\n"),
      ok(
        SQUARE,
        `<html><head><meta name="generator" content="Squarespace"></head>
         <body><div class="eventlist"></div></body></html>`,
      ),
    ];
    const report = await runIngest({ db, metro, env: {}, only: [SQUARE], ...httpAt(fixtures) });
    const line = report.sources.find((s) => s.url === SQUARE)!;
    // The page is read as a browser shows it (D-111): an unrecorded ?format=json request would
    // have thrown. With no model in this run, it waits for one.
    expect(line.status).toBe("waits_for_extraction");
    // An empty list is not a Squarespace events list (D-137): the page is read like any page.
    expect(line.detail).toContain("no feed or structured events");
  });

  it("searches a metro-wide API once and does not harvest its source again", async () => {
    // Run 8 on GitHub searched Ticketmaster, then failed it as an ordinary source.
    let t = NOW.getTime();
    const http = createPoliteHttp({
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
      transport: async (req) => ({
        url: req.url,
        status: 200,
        headers: {},
        body: req.url.startsWith("https://app.ticketmaster.com/")
          ? '{"page":{"totalPages":0}}'
          : "",
      }),
    });
    const report = await runIngest({
      db,
      metro,
      http,
      now: () => new Date(t),
      env: { TICKETMASTER_API_KEY: "test-key" },
      only: ["https://nothing.example/"],
    });
    const lines = report.sources.filter((s) => s.url === "https://www.ticketmaster.com/");
    expect(lines.map((l) => l.status)).toEqual(["ok"]);
    // A full read, so the search is due again at the same clock (D-088).
    const again = await runIngest({
      db,
      metro,
      http,
      now: () => new Date(t),
      env: { TICKETMASTER_API_KEY: "test-key" },
      full: true,
    });
    expect(
      again.sources.filter((s) => s.url === "https://www.ticketmaster.com/").map((l) => l.status),
    ).toEqual(["ok"]);
  });

  it("probes again a page left as html with a platform, which an older run reset", async () => {
    await db
      .update(sources)
      .set({ kind: "html", platform: "squarespace" })
      .where(eq(sources.url, SITE));
    const report = await runIngest({ db, metro, env: {}, only: [SITE], ...httpAt(FIXTURES) });
    expect(report.sources.find((s) => s.url === SITE)).toMatchObject({
      status: "ok",
      adapter: "feed_ics",
    });
  });

  describe("a reader that read every night retires what it no longer lists (D-111)", () => {
    const LIST = "https://contra.example/events";
    const ITEM = "https://contra.example/events/fall-contra";
    const list = `<html><body><div class="eventlist eventlist--upcoming">
      <article class="eventlist-event eventlist-event--upcoming">
        <h1 class="eventlist-title"><a href="/events/fall-contra" class="eventlist-title-link">Fall Contra</a></h1>
        <time class="event-date" datetime="2026-09-27">Sunday, September 27, 2026</time>
        <time class="event-time-localized-start" datetime="2026-09-27">4:30 p.m.</time>
      </article></div></body></html>`;
    const item = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@type": "Event",
      name: "Fall Contra — Contra Example",
      startDate: "2026-09-27T16:30:00-0400",
      location: { "@type": "Place", name: "Camp Friendship", address: "339 8th St, Brooklyn, NY" },
    })}</script></head></html>`;

    // What the model wrote from the old page: a night the list no longer gives.
    async function storedByTheModel() {
      const source = await upsertSource(db, metro.id, {
        url: LIST,
        kind: "squarespace",
        platform: "squarespace",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      const outcome = normalizeListing(
        {
          listing: rawListingSchema.parse({
            title: "Contra on Saturday",
            listing_type: "social",
            styles: ["contra"],
            local_date: "2026-09-26",
            dancing_time: "19:00",
            venue: {},
            organizer: {},
          }),
          externalId: null,
          tz: "America/New_York",
          venueLocation: null,
          recurrence: null,
          provenance: { sourceUrl: LIST, fetchedAt: NOW, method: "llm" },
        },
        { metro, source: { styles: [] }, now: NOW },
      );
      if (!outcome.ok) throw new Error(outcome.reason);
      await writeEvents(db, {
        metro,
        source,
        events: [outcome.event],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: async () => null,
      });
    }
    const titles = async () =>
      db
        .select({ title: events.title, status: events.status })
        .from(events)
        .orderBy(events.nightDate);

    it("takes off a later night of the old reader's that a whole read does not list", async () => {
      await storedByTheModel();
      const report = await runIngest({
        db,
        metro,
        env: {},
        only: [LIST],
        ...httpAt([
          ok("https://contra.example/robots.txt", "User-agent: *\nDisallow: /*?format=json\n"),
          ok(LIST, list),
          ok(ITEM, item),
        ]),
      });
      expect(report.sources.find((s) => s.url === LIST)).toMatchObject({
        status: "ok",
        adapter: "squarespace",
        written: 1,
      });
      expect(await titles()).toEqual([
        { title: "Contra on Saturday", status: "removed" },
        { title: "Fall Contra", status: "active" },
      ]);
    });

    it("retires nothing after a partial read: an event page that failed", async () => {
      await storedByTheModel();
      await runIngest({
        db,
        metro,
        env: {},
        only: [LIST],
        ...httpAt([
          ok("https://contra.example/robots.txt", "User-agent: *\nDisallow:\n"),
          ok(LIST, list),
          {
            request: { method: "GET", url: ITEM },
            response: { url: ITEM, status: 500, headers: {}, body: "" },
          },
        ]),
      });
      // The list's own fields stand in for the page; the stored night stays.
      expect(await titles()).toEqual([
        { title: "Contra on Saturday", status: "active" },
        { title: "Fall Contra", status: "active" },
      ]);
    });

    it("follows a page's event pages on the run that probes it", async () => {
      const HOME = "https://swing.example/";
      await upsertSource(db, metro.id, {
        url: HOME,
        kind: "html",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      const itemList = `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "ItemList",
        itemListElement: [{ "@type": "ListItem", url: "https://swing.example/e/house-party/" }],
      })}</script></head></html>`;
      const party = `<html><head><script type="application/ld+json">${JSON.stringify({
        "@type": "Event",
        name: "House Party",
        startDate: "2026-09-30T21:00:00-04:00",
        location: { "@type": "Place", name: "Studio", address: "240 W 37th St, New York, NY" },
      })}</script></head></html>`;
      const report = await runIngest({
        db,
        metro,
        env: {},
        only: [HOME],
        ...httpAt([
          ok("https://swing.example/robots.txt", "User-agent: *\nDisallow:\n"),
          ok(HOME, itemList),
          ok("https://swing.example/e/house-party/", party),
        ]),
      });
      const line = report.sources.find((s) => s.url === HOME)!;
      expect(line).toMatchObject({ status: "ok", adapter: "jsonld_items", written: 1 });
      expect(line.notes[0]).toBe("probed: the page names its events' own pages");
    });
  });

  it("switches a retired starting address off and still names it in the report", async () => {
    const DEAD = "https://newyorktango.org/";
    await upsertSource(db, metro.id, {
      url: DEAD,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const report = await runIngest({ db, metro, env: {}, only: [SITE], ...httpAt(FIXTURES) });
    const [row] = await db
      .select({ enabled: sources.enabled })
      .from(sources)
      .where(eq(sources.url, DEAD));
    expect(row?.enabled).toBe(false);
    expect(report.sources.find((s) => s.url === DEAD)).toMatchObject({
      status: "skipped",
      detail: expect.stringContaining("retired from the starting list: no answer"),
    });
  });

  it("takes a retired starting address's listings from tonight on off the site, and names them", async () => {
    const DEAD = "https://newyorktango.org/";
    const dead = await upsertSource(db, metro.id, {
      url: DEAD,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const listing = (title: string, localDate: string) => {
      const outcome = normalizeListing(
        {
          listing: rawListingSchema.parse({
            title,
            listing_type: "social",
            styles: ["milonga"],
            local_date: localDate,
            dancing_time: "20:00",
            venue: {},
            organizer: {},
          }),
          externalId: null,
          tz: "America/New_York",
          venueLocation: null,
          recurrence: null,
          provenance: { sourceUrl: DEAD, fetchedAt: NOW, method: "llm" },
        },
        { metro, source: { styles: [] }, now: NOW },
      );
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.event;
    };
    await writeEvents(db, {
      metro,
      source: dead,
      events: [
        listing("Last week's milonga", "2026-09-17"),
        listing("Tonight's milonga", "2026-09-24"),
        listing("Next week's milonga", "2026-10-01"),
      ],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });

    const report = await runIngest({ db, metro, env: {}, only: [SITE], ...httpAt(FIXTURES) });
    const rows = await db
      .select({ title: events.title, status: events.status })
      .from(events)
      .where(sql`${events.title} like '%milonga'`)
      .orderBy(events.nightDate);
    expect(rows).toEqual([
      { title: "Last week's milonga", status: "active" },
      { title: "Tonight's milonga", status: "removed" },
      { title: "Next week's milonga", status: "removed" },
    ]);
    expect(report.sources.find((s) => s.url === DEAD)?.notes).toEqual([
      "2 listing(s) of this retired address were taken off the site: Tonight's milonga on 2026-09-24; Next week's milonga on 2026-10-01",
    ]);
  });

  it("does not bring back a retired starting address that a page links to (D-110)", async () => {
    const RETIRED = "https://www.eventbrite.com/o/33937979455";
    const linking: Fixture[] = [
      ok("https://salsa.example/robots.txt", "User-agent: *\nDisallow: /admin\n"),
      ok(
        SITE,
        `<html><head><link rel="alternate" type="text/calendar" href="/calendar.ics"></head>
         <body><a href="${RETIRED}">Ecstatic dance tickets</a></body></html>`,
      ),
      ok("https://salsa.example/calendar.ics", ICS, { etag: '"v1"' }),
    ];
    // A whole run, not one address: only a whole run queues what it discovers.
    const report = await runIngest({ db, metro, env: {}, ...httpAt(linking) });
    expect(report.sources.find((s) => s.url === SITE)?.status).toBe("ok");
    expect(report.sources.some((s) => s.url === RETIRED && s.status !== "skipped")).toBe(false);
    const rows = await db.select().from(sources).where(eq(sources.url, RETIRED));
    expect(rows).toEqual([]);
  });

  it("puts a page deferred for want of model time first in the next run's queue", async () => {
    const PAGE = "https://slow.example/";
    await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const fixtures: Fixture[] = [
      ...FIXTURES,
      ok("https://slow.example/robots.txt", "User-agent: *\nDisallow:\n"),
      ok(PAGE, "<html><body><h1>Monday social</h1></body></html>"),
    ];
    const client = {
      run: () => Promise.reject(new Error("not reached")),
    } as unknown as AiClient;
    const ai = { client, cache: postgresExtractionCache(db), timeBudgetMs: 0 };
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [SITE, PAGE],
      ai,
      ...httpAt(fixtures),
    });
    expect(report.sources.find((s) => s.url === PAGE)?.status).toBe("deferred");
    expect(report.sources.find((s) => s.url === SITE)?.status).toBe("ok");
    // The deferred page goes first, ahead of the starting addresses never read yet (which sort
    // before it by address); the feed read this run, due again since, comes next, and the
    // addresses never read come last (D-088).
    // The next run, a day later.
    const nextRun = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
    const queue = (await loadSources(db, metro.id, nextRun)).map((s) => s.url);
    expect(queue[0]).toBe(PAGE);
    expect(queue[1]).toBe(SITE);
    expect(queue.length).toBeGreaterThan(2);
  });

  it("defers model reads once the run's model time is spent, without calling the model", async () => {
    const PAGE = "https://slow.example/";
    await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const fixtures: Fixture[] = [
      ok("https://slow.example/robots.txt", "User-agent: *\nDisallow:\n"),
      ok(PAGE, "<html><body><h1>Monday social</h1></body></html>"),
    ];
    let calls = 0;
    const client = {
      run() {
        calls += 1;
        return Promise.reject(new Error("not reached"));
      },
    } as unknown as AiClient;
    const ai = { client, cache: postgresExtractionCache(db), timeBudgetMs: 0 };

    const report = await runIngest({ db, metro, env: {}, only: [PAGE], ai, ...httpAt(fixtures) });
    expect(calls).toBe(0);
    expect(report.ai.deferred).toBe(1);
    expect(report.sources.find((s) => s.url === PAGE)).toMatchObject({
      status: "deferred",
      detail: expect.stringContaining("minutes of model reading are spent"),
    });
  });

  it("reads a page with no feed with the model, writes its listing, logs the cost, and caches it", async () => {
    const TANGO = "https://tango.example/";
    await upsertSource(db, metro.id, {
      url: TANGO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const fixtures: Fixture[] = [
      ok("https://tango.example/robots.txt", "User-agent: *\nDisallow:\n"),
      ok(
        TANGO,
        "<html><body><h1>Thursday milonga</h1><p>Tonight at Copacabana, 9pm</p></body></html>",
      ),
    ];
    let calls = 0;
    const client = {
      async run() {
        calls += 1;
        return {
          ok: true,
          provider: "cloudflare",
          model: "@cf/ibm-granite/granite-4.0-h-micro",
          usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
          value: rawExtractionSchema.parse({
            page_kind: "single_event",
            language: "en",
            listings: [
              {
                title: "Thursday milonga",
                listing_type: "social",
                styles: ["milonga"],
                local_date: "2026-09-24",
                doors_time: "21:00",
                venue: { name: "Copacabana" },
                organizer: {},
                evidence: { title: "Thursday milonga", doors_time: "9pm" },
                confidence: { title: 0.95, doors_time: 0.9 },
              },
            ],
          }),
        };
      },
    } as unknown as AiClient;
    const ai = { client, cache: postgresExtractionCache(db) };

    const report = await runIngest({ db, metro, env: {}, only: [TANGO], ai, ...httpAt(fixtures) });
    const line = report.sources.find((s) => s.url === TANGO)!;
    expect(line).toMatchObject({ status: "ok", written: 1, tonight: 1 });
    expect(line.adapter).toContain("granite");
    expect(report.ai).toMatchObject({
      enabled: true,
      pagesRead: 1,
      calls: 1,
      listingsFromModel: 1,
    });
    expect(report.ai.spent.neuron).toBeCloseTo(4.4);
    expect(formatReport(report)).toContain("Listings from model extraction: 1 of 1.");
    const logged = await db.select().from(costLog);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ job: "extract", provider: "cloudflare", unit: "neuron" });

    const again = await runIngest({ db, metro, env: {}, only: [TANGO], ai, ...httpAt(fixtures) });
    expect(calls).toBe(1);
    expect(again.ai).toMatchObject({ pagesRead: 1, cached: 1, calls: 0 });
  });

  it("withdraws The Ronda's stored 3pm and writes its listing without a time (D-063, D-065)", async () => {
    // The seed list's own entry, so the run finds its placeholder in config/sources/nyc.ts.
    const RONDA = "https://theronda.us/nyc";
    const ronda = await upsertSource(db, metro.id, {
      url: RONDA,
      kind: "html",
      platform: "probed",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    const read = {
      title: "Tango Cafe",
      listing_type: "social",
      styles: ["milonga"],
      local_date: "2026-09-24",
      doors_time: "15:00",
      venue: { name: "Ripley-Grier Studios" },
      organizer: {},
    } as const;
    // Stored before D-063: the site's "3:00 PM" read as the doors time.
    const stored = normalizeListing(
      {
        listing: rawListingSchema.parse(read),
        externalId: null,
        tz: null,
        venueLocation: { lat: 40.7527, lng: -73.9923 },
        recurrence: null,
        provenance: { sourceUrl: RONDA, fetchedAt: NOW, method: "llm" },
      },
      { metro, source: ronda, now: NOW },
    );
    if (!stored.ok) throw new Error(stored.reason);
    const [old] = (
      await writeEvents(db, {
        metro,
        source: ronda,
        events: [stored.event],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: (input) => resolveVenue(db, metro, input),
      })
    ).eventIds as [string];

    const fixtures: Fixture[] = [
      ok("https://theronda.us/robots.txt", "User-agent: *\nDisallow:\n"),
      ok(
        RONDA,
        "<html><body><h2>Thursday, September 24, 2026</h2><p>Tango Cafe 3:00 PM Ripley Grier Studios</p></body></html>",
      ),
    ];
    const client = {
      async run() {
        return {
          ok: true,
          provider: "cloudflare",
          model: "@cf/ibm-granite/granite-4.0-h-micro",
          usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
          value: rawExtractionSchema.parse({
            page_kind: "event_list",
            language: "en",
            listings: [{ ...read, evidence: { doors_time: "3:00 PM" } }],
          }),
        };
      },
    } as unknown as AiClient;
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [RONDA],
      ai: { client, cache: postgresExtractionCache(db) },
      ...httpAt(fixtures),
    });
    const line = report.sources.find((s) => s.url === RONDA)!;
    expect(line).toMatchObject({ status: "ok", written: 1, untimed: 1 });
    expect(line.notes).toEqual(
      expect.arrayContaining([
        "1 listing(s) gave only 15:00, which this site prints on every event: read as time not listed",
        "1 stored listing(s) showed 15:00, which this site prints on every event: that time is withdrawn",
        "Tango Cafe: the listing stored on 2026-09-24 with this site's placeholder time was replaced by the listing with no time",
      ]),
    );
    const rows = await db.select().from(events);
    expect(rows.find((r) => r.id === old)).toMatchObject({ status: "removed" });
    const listed = rows.filter((r) => r.status === "active");
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      title: "Tango Cafe",
      startsAt: null,
      nightDate: "2026-09-24",
    });
  });

  it("says a page waits when no model is configured, as Phase 2 did", async () => {
    const TANGO = "https://tango.example/";
    await upsertSource(db, metro.id, {
      url: TANGO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const report = await runIngest({ db, metro, env: {}, only: [TANGO], ...httpAt(FIXTURES) });
    expect(report.sources.find((s) => s.url === TANGO)).toMatchObject({
      status: "waits_for_extraction",
    });
    expect(formatReport(report)).toContain("Model extraction: not configured");
  });

  it("writes nights with no time, screens titles that are not events, and reports both (D-060)", async () => {
    const SWING = "https://swing.example/";
    await upsertSource(db, metro.id, {
      url: SWING,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const ics = [
      "BEGIN:VCALENDAR",
      "X-WR-TIMEZONE:America/New_York",
      "BEGIN:VEVENT",
      "UID:bk-0924@swing.example",
      "DTSTART;VALUE=DATE:20260924",
      "SUMMARY:Brooklyn Social",
      "LOCATION:Copacabana",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:ffj-0925@swing.example",
      "DTSTART;VALUE=DATE:20260925",
      "SUMMARY:Frim Fram Jam",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:closed-0925@swing.example",
      "DTSTART;VALUE=DATE:20260925",
      "SUMMARY:Studio closed",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:heading@swing.example",
      "DTSTART;VALUE=DATE:20261001",
      "SUMMARY:October 2026",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:no-class@swing.example",
      "DTSTART;VALUE=DATE:20260907",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "SUMMARY:No class",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const fixtures: Fixture[] = [
      ok("https://swing.example/robots.txt", "User-agent: *\nDisallow:\n"),
      ok(
        SWING,
        '<html><head><link rel="alternate" type="text/calendar" href="/cal.ics"></head></html>',
      ),
      ok("https://swing.example/cal.ics", ics),
    ];
    const report = await runIngest({ db, metro, env: {}, only: [SWING], ...httpAt(fixtures) });
    const line = report.sources.find((s) => s.url === SWING)!;
    expect(line).toMatchObject({
      status: "ok",
      adapter: "feed_ics",
      written: 2,
      tonight: 1,
      unplaced: 1,
      rejected: 0,
      untimed: 2,
      untimedPlaced: 1,
      // The weekly closure is screened once, not once per night.
      notEvents: 3,
    });
    expect(line.notes).toEqual(
      expect.arrayContaining([
        "Studio closed: not an event (a closure notice)",
        "October 2026: not an event (only a date or a heading)",
        "No class: not an event (a closure notice)",
      ]),
    );
    expect(report.totals).toMatchObject({
      untimed: 2,
      untimedPlaced: 1,
      notEvents: 3,
      tonightListed: 1,
    });

    const rows = await db
      .select({ title: events.title, nightDate: events.nightDate, startsAt: events.startsAt })
      .from(events)
      .orderBy(events.nightDate);
    expect(rows).toEqual([
      { title: "Brooklyn Social", nightDate: "2026-09-24", startsAt: null },
      { title: "Frim Fram Jam", nightDate: "2026-09-25", startsAt: null },
    ]);

    const text = formatReport(report);
    expect(text).toContain(
      `[ok] ${SWING} via feed_ics: 2 written (1 tonight), 1 unplaced, 0 rejected, 2 time not listed, 3 not events`,
    );
    expect(text).toContain(
      "2 time not listed (untimed written 2, placed 1), 3 not events. Listed for tonight: 1.",
    );
  });

  it("retires a night stored at an invented midnight when the model's untimed rule replaces it", async () => {
    const SCHOOL = "https://school.example/";
    const school = await upsertSource(db, metro.id, {
      url: SCHOOL,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // What an earlier run wrote for "every Tuesday" with no time: dancing at 00:00 on Tuesday,
    // which is the Monday night, 2026-09-28.
    const invented = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title: "English - Tuesdays",
          listing_type: "class",
          styles: [],
          local_date: "2026-09-28",
          dancing_time: "00:00",
          venue: { name: "Copacabana" },
          organizer: {},
        }),
        externalId: null,
        tz: null,
        venueLocation: null,
        recurrence: null,
        fromRule: true,
        provenance: { sourceUrl: SCHOOL, fetchedAt: NOW, method: "llm" },
      },
      { metro, source: school, now: NOW },
    );
    if (!invented.ok) throw new Error(invented.reason);
    const [oldId] = (
      await writeEvents(db, {
        metro,
        source: school,
        events: [invented.event],
        blocklist: EMPTY_BLOCKLIST,
        placeVenue: (input) => resolveVenue(db, metro, input),
      })
    ).eventIds;

    const client = {
      async run() {
        return {
          ok: true,
          provider: "cloudflare",
          model: "@cf/ibm-granite/granite-4.0-h-micro",
          usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
          value: rawExtractionSchema.parse({
            page_kind: "class_schedule",
            language: "en",
            listings: [
              {
                title: "English - Tuesdays",
                listing_type: "class",
                styles: [],
                recurrence_text: "every Tuesday",
                venue: { name: "Copacabana" },
                organizer: {},
                evidence: { recurrence_text: "English - Tuesdays" },
              },
            ],
          }),
        };
      },
    } as unknown as AiClient;
    const fixtures: Fixture[] = [
      ok("https://school.example/robots.txt", "User-agent: *\nDisallow:\n"),
      ok(SCHOOL, "<html><body><h2>English - Tuesdays</h2></body></html>"),
    ];
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [SCHOOL],
      ai: { client, cache: postgresExtractionCache(db) },
      ...httpAt(fixtures),
    });
    const line = report.sources.find((s) => s.url === SCHOOL)!;
    // Tuesdays in the 14-night window from Thursday 2026-09-24, with no time.
    expect(line).toMatchObject({ status: "ok", written: 2, untimed: 2, untimedPlaced: 2 });
    expect(line.notes).toContain(
      "English - Tuesdays: the listing stored at midnight on 2026-09-28 was an invented time; replaced by the listing on 2026-09-29 with no time",
    );
    const rows = await db
      .select({
        id: events.id,
        nightDate: events.nightDate,
        startsAt: events.startsAt,
        status: events.status,
      })
      .from(events)
      .orderBy(events.nightDate);
    expect(rows.map((r) => [r.nightDate, r.startsAt, r.status])).toEqual([
      ["2026-09-28", invented.event.startsAt, "removed"],
      ["2026-09-29", null, "active"],
      ["2026-10-06", null, "active"],
    ]);
    expect(rows[0]?.id).toBe(oldId);
    // The night provenance quotes the rule the night came from.
    const [night] = await db
      .select({ evidence: fieldProvenance.evidence })
      .from(fieldProvenance)
      .where(
        sql`${fieldProvenance.entityId} = ${rows[1]!.id} and ${fieldProvenance.field} = 'night_date'`,
      );
    expect(night?.evidence).toBe("English - Tuesdays");
  });

  it("names each listed row with no location in the report, with its night and source (D-082)", async () => {
    const SOBS = "https://sobs.com/calendar";
    const sobs = await upsertSource(db, metro.id, {
      url: SOBS,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // What run 30 wrote from SOB's calendar: the venue's own page names no venue, so the row has
    // none, and no later run places it.
    const concert = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title: "Chow Lee Album Release Show",
          listing_type: "social",
          styles: [],
          local_date: "2026-09-24",
          dancing_time: "19:00",
          venue: {},
          organizer: {},
        }),
        externalId: null,
        tz: null,
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: SOBS, fetchedAt: NOW, method: "llm" },
      },
      { metro, source: sobs, now: NOW },
    );
    if (!concert.ok) throw new Error(concert.reason);
    await writeEvents(db, {
      metro,
      source: sobs,
      events: [concert.event],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async () => null,
    });

    const report = await runIngest({ db, metro, env: {}, only: [SITE], ...httpAt(FIXTURES) });
    // The feed's own nights at places no stored venue matches are listed the same way, after it.
    expect(report.unplacedRows[0]).toEqual({
      title: "Chow Lee Album Release Show",
      night: "2026-09-24",
      source: SOBS,
    });
    expect(report.totals.unplacedListed).toBe(report.unplacedRows.length);
    const text = formatReport(report).split("\n");
    expect(text).toContain(
      "Location not listed: Chow Lee Album Release Show, 2026-09-24, sobs.com",
    );

    // Thirty by name, then how many more.
    const many = Array.from({ length: 32 }, (_, i) => ({
      title: `Night ${i + 1}`,
      night: "2026-09-25",
      source: "https://www.thisweekinswing.com/",
    }));
    const long = formatReport({ ...report, unplacedRows: many }).split("\n");
    expect(long).toContain("Location not listed: Night 30, 2026-09-25, thisweekinswing.com");
    expect(long).not.toContain("Location not listed: Night 31, 2026-09-25, thisweekinswing.com");
    expect(long).toContain("and 2 more");
  });

  it("treats an empty only list as no filter, as the CLI passes it without --only", async () => {
    // Run 7 on GitHub harvested nothing but the metro-wide APIs because [] filtered every source.
    const report = await runIngest({ db, metro, env: {}, only: [], ...httpAt(FIXTURES) });
    expect(report.sources.find((s) => s.url === SITE)).toMatchObject({
      status: "ok",
      adapter: "feed_ics",
    });
  });

  it("reads a calendar page as a page while the Google Calendar reader is off (D-130)", async () => {
    const PAGE = "https://wcs.example/";
    await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "feed_gcal",
      platform: "feed_gcal",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await setGlobalFlag(db, "feed_gcal", false);
    const report = await runIngest({ db, metro, env: {}, only: [PAGE], ...httpAt(FIXTURES) });
    expect(report.sources.find((s) => s.url === PAGE)).toMatchObject({
      status: "waits_for_extraction",
      detail:
        "the Google Calendar reader does not run (adapter.feed_gcal is off); model extraction is not configured in this run",
    });
    await setGlobalFlag(db, "feed_gcal", true);
  });
});
