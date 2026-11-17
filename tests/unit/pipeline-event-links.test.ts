// The ingest side of a listing's own link (D-073), end to end over a real database: a listing the
// page does not write is rejected and the rows it made before are retired; each source row keeps
// its own page for the event (event_sources.event_url); a read that could not be checked keeps the
// stored page; a merge keeps the merged row's page; and event pages in canonical_url do not make
// two nights of one list page a pair.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { eventSources, events, metros } from "@/src/db/schema";
import { scorePair, type DedupeSide } from "@/src/domain/dedupe";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { dedupeMetro } from "@/src/pipeline/dedupe";
import {
  createPoliteHttp,
  fixtureTransport,
  type Fixture,
  type Transport,
  type TransportResponse,
} from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  mergeInto,
  pipelineId,
  pruneRawDocuments,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-09-28, noon in New York.
const NOW = new Date("2026-09-28T16:00:00Z");
const TONIGHT = "2026-09-28";

let db: Db;
let metro: Metro;

const ok = (url: string, body: string, etag?: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: etag ? { etag } : {}, body },
});

function httpAt(fixtures: Fixture[] | Transport) {
  let t = NOW.getTime();
  return {
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: Array.isArray(fixtures) ? fixtureTransport(fixtures) : fixtures,
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  };
}

/** A model that answers every read with these listings. */
function model(listings: Array<Record<string, unknown>>): AiClient {
  return {
    async run() {
      return {
        ok: true,
        provider: "cloudflare",
        model: "@cf/ibm-granite/granite-4.0-h-micro",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: listings.map((l) => ({ styles: [], organizer: {}, ...l })),
        }),
      };
    },
  } as unknown as AiClient;
}

const venue = { name: "The Factory", address: "144 Allen St, New York, NY" };
const AT = { lat: 40.7206, lng: -73.9897 };

/** Rows as an earlier run stored them, one per listing. */
async function storedBefore(source: Source, listings: Array<Record<string, unknown>>) {
  const normalized = listings.map((fields) => {
    const outcome = normalizeListing(
      {
        listing: rawListingSchema.parse({ styles: [], organizer: {}, venue, ...fields }),
        externalId: null,
        tz: null,
        venueLocation: AT,
        recurrence: null,
        provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "llm" },
        eventUrl: (fields.eventUrl as string | undefined) ?? null,
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
      placeVenue: (input) => resolveVenue(db, metro, input),
    })
  ).eventIds;
}

const pageSource = (url: string, trustTier: Source["trustTier"] = "first_party") =>
  upsertSource(db, metro.id, {
    url,
    kind: "html",
    platform: "probed",
    trustTier,
    discoveredBy: "seed_list",
  });

const statusOf = async (id: string) =>
  (await db.select({ status: events.status }).from(events).where(eq(events.id, id)))[0]?.status;

describeDb("a listing's own link, stored (D-073)", () => {
  beforeAll(async () => {
    db = await testDb("event_links");
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

  // nylindy.com on 2026-09-28: the NYLX festival's home page, and no "Nylon Lindy Hop" on it.
  const NYL = "https://nylindy.example/";
  const nylPage =
    "<html><body><h1>NYLX 2026</h1><p>The New York Lindy Exchange, October 9-11, 2026</p><p>Balboa Night, Friday, October 2, 8pm</p></body></html>";
  const invented = {
    title: "Nylon Lindy Hop",
    listing_type: "class",
    recurrence_text: "every Thursday",
    doors_time: "19:00",
    ticket_url: "https://nylindy.example/events/nylon-lindy-hop",
    venue,
  };
  const ingestNyl = (listings: Array<Record<string, unknown>>) =>
    runIngest({
      db,
      metro,
      env: {},
      only: [NYL],
      ai: { client: model(listings), cache: postgresExtractionCache(db) },
      ...httpAt([
        ok("https://nylindy.example/robots.txt", "User-agent: *\nDisallow:\n"),
        ok(NYL, nylPage),
      ]),
    });

  describe("an invented listing's rows (A4)", () => {
    it("are retired when the read lists nothing else, and tonight is left to the day-of check", async () => {
      const source = await pageSource(NYL);
      const [tonightId, oct1, oct8] = await storedBefore(source, [
        { ...invented, local_date: TONIGHT },
        { ...invented, local_date: "2026-10-01" },
        { ...invented, local_date: "2026-10-08" },
      ]);
      const report = await ingestNyl([invented]);
      const line = report.sources.find((s) => s.url === NYL)!;
      expect(line).toMatchObject({ status: "ok", written: 0, rejected: 1 });
      expect(line.notes[0]).toBe(
        "2 stored listing(s) this page no longer lists were retired: Nylon Lindy Hop on 2026-10-01; Nylon Lindy Hop on 2026-10-08",
      );
      expect(line.notes).toContain(
        "Nylon Lindy Hop: the page does not write this title; not listed",
      );
      expect(await statusOf(oct1!)).toBe("removed");
      expect(await statusOf(oct8!)).toBe("removed");
      expect(await statusOf(tonightId!)).toBe("active");

      // The next run reads the same page from the cache and rejects it again; nothing is left.
      const again = await ingestNyl([invented]);
      const second = again.sources.find((s) => s.url === NYL)!;
      expect(second.rejected).toBe(1);
      expect(second.notes.join(" ")).not.toMatch(/were retired/);
    });

    it("go with the other rows the read does not list when it lists a real night", async () => {
      const source = await pageSource(NYL);
      const [oct1] = await storedBefore(source, [{ ...invented, local_date: "2026-10-01" }]);
      const balboa = {
        title: "Balboa Night",
        listing_type: "social",
        local_date: "2026-10-02",
        dancing_time: "20:00",
        venue,
      };
      const report = await ingestNyl([invented, balboa]);
      const line = report.sources.find((s) => s.url === NYL)!;
      expect(line).toMatchObject({ written: 1, rejected: 1 });
      expect(line.notes[0]).toBe(
        "1 stored listing(s) this page no longer lists were retired: Nylon Lindy Hop on 2026-10-01",
      );
      expect(await statusOf(oct1!)).toBe("removed");
    });
  });

  describe("event_sources.event_url", () => {
    const RONDA = "https://ronda.example/nyc";
    const rondaPage = [
      "<html><body><h2>Wednesday, September 30, 2026</h2><p>milonga</p>",
      '<p><a href="https://ronda.example/event/tango-cafe-2026-09-30-74420121">Tango Cafe</a></p>',
      '<p>📍 <a href="https://ronda.example/venue/you-should-be-dancing">You Should Be Dancing</a></p>',
      "<h2>Thursday, October 1, 2026</h2><p>milonga</p><p>Tango la Nacional</p>",
      "</body></html>",
    ].join("");

    it("is the page's own link for the event, and null where the page gives none", async () => {
      await pageSource(RONDA, "directory");
      await runIngest({
        db,
        metro,
        env: {},
        only: [RONDA],
        ai: {
          client: model([
            {
              title: "Tango Cafe",
              listing_type: "social",
              local_date: "2026-09-30",
              dancing_time: "19:00",
              venue,
            },
            {
              title: "Tango la Nacional",
              listing_type: "social",
              local_date: "2026-10-01",
              dancing_time: "19:00",
              venue,
            },
          ]),
          cache: postgresExtractionCache(db),
        },
        ...httpAt([
          ok("https://ronda.example/robots.txt", "User-agent: *\nDisallow:\n"),
          ok(RONDA, rondaPage),
        ]),
      });
      const rows = await db
        .select({
          title: events.title,
          canonical: events.canonicalUrl,
          eventUrl: eventSources.eventUrl,
        })
        .from(events)
        .innerJoin(eventSources, eq(eventSources.eventId, events.id))
        .orderBy(events.nightDate);
      expect(rows).toEqual([
        {
          title: "Tango Cafe",
          canonical: "https://ronda.example/event/tango-cafe-2026-09-30-74420121",
          eventUrl: "https://ronda.example/event/tango-cafe-2026-09-30-74420121",
        },
        // The list it was read from is its canonical URL (dedupe's fallback), never its event page.
        { title: "Tango la Nacional", canonical: RONDA, eventUrl: null },
      ]);
    });

    it("is never a home page or a list, whatever the source calls its event page", async () => {
      const source = await pageSource("https://salsa.example/calendar");
      const [home, list, own] = await storedBefore(source, [
        {
          title: "A",
          listing_type: "social",
          local_date: "2026-10-01",
          eventUrl: "https://salsa.example/",
        },
        {
          title: "B",
          listing_type: "social",
          local_date: "2026-10-01",
          eventUrl: "https://salsa.example/events/",
        },
        {
          title: "C",
          listing_type: "social",
          local_date: "2026-10-01",
          eventUrl: "https://salsa.example/events/c",
        },
      ]);
      const urlOf = async (id: string) =>
        (await db.select().from(eventSources).where(eq(eventSources.eventId, id)))[0]?.eventUrl;
      expect(await urlOf(home!)).toBeNull();
      expect(await urlOf(list!)).toBeNull();
      expect(await urlOf(own!)).toBe("https://salsa.example/events/c");
    });

    it("follows every read, checked even on a 304 whose text was pruned (A5, C, D-074)", async () => {
      const STUDIO = "https://studio.example/socials";
      const withLink =
        '<html><body><h2><a href="/events/salsa-thursdays">Salsa Thursdays</a></h2><p>Thursday, October 1, 9pm</p></body></html>';
      const salsa = {
        title: "Salsa Thursdays",
        listing_type: "social",
        local_date: "2026-10-01",
        doors_time: "21:00",
        venue,
      };
      await pageSource(STUDIO);
      /** 304 to a conditional request, the page to any other. */
      const conditional =
        (body: string, etag: string): Transport =>
        async (req) => {
          if (req.url.endsWith("/robots.txt")) {
            return {
              url: req.url,
              status: 200,
              headers: {},
              body: "User-agent: *\nDisallow:\n",
            } as TransportResponse;
          }
          if (req.headers["if-none-match"] === etag) {
            return { url: req.url, status: 304, headers: { etag }, body: "" } as TransportResponse;
          }
          return { url: req.url, status: 200, headers: { etag }, body } as TransportResponse;
        };
      const run = (transport: Transport) =>
        runIngest({
          db,
          metro,
          env: {},
          only: [STUDIO],
          ai: { client: model([salsa]), cache: postgresExtractionCache(db) },
          ...httpAt(transport),
        });
      const stored = async () =>
        (
          await db
            .select({ eventUrl: eventSources.eventUrl })
            .from(eventSources)
            .innerJoin(events, eq(events.id, eventSources.eventId))
            .where(and(eq(events.title, "Salsa Thursdays"), eq(events.nightDate, "2026-10-01")))
        ).map((r) => r.eventUrl);

      await run(conditional(withLink, '"v1"'));
      expect(await stored()).toEqual(["https://studio.example/events/salsa-thursdays"]);

      // The page is unchanged (304) and its text is pruned: it is fetched again in full, even
      // though its read is cached, so the read is still checked (D-074), and the page it links stands.
      await pruneRawDocuments(db, new Date(NOW.getTime() + 4 * 86_400_000));
      const again = await run(conditional(withLink, '"v1"'));
      const line = again.sources.find((s) => s.url === STUDIO)!;
      expect(line.adapter).toContain("cached");
      expect(line.notes.join(" ")).not.toMatch(/no longer stored/);
      expect(await stored()).toEqual(["https://studio.example/events/salsa-thursdays"]);

      // The page changes and no longer links the night: a checked read takes that.
      const without = withLink.replace(/<a href="[^"]*">([^<]*)<\/a>/, "$1");
      await run(conditional(without, '"v2"'));
      expect(await stored()).toEqual([null]);
    });

    it("comes along when a listing is merged into another", async () => {
      const organizer = await pageSource("https://salsa.example/calendar");
      const ticketing = await upsertSource(db, metro.id, {
        url: "https://www.eventbrite.com/",
        kind: "ticketing_api",
        trustTier: "ticketing",
        discoveredBy: "eventbrite",
      });
      const [survivor] = await storedBefore(organizer, [
        { title: "Salsa Thursdays", listing_type: "social", local_date: "2026-10-01" },
      ]);
      const [merged] = await storedBefore(ticketing, [
        {
          title: "Salsa Thursdays",
          listing_type: "social",
          local_date: "2026-10-01",
          eventUrl: "https://www.eventbrite.com/e/salsa-thursdays-tickets-123",
        },
      ]);
      await db.transaction((tx) => mergeInto(tx, survivor!, merged!));
      const links = await db
        .select({ role: eventSources.role, eventUrl: eventSources.eventUrl })
        .from(eventSources)
        .where(eq(eventSources.eventId, survivor!))
        .orderBy(eventSources.role);
      expect(links).toEqual([
        { role: "primary", eventUrl: null },
        { role: "secondary", eventUrl: "https://www.eventbrite.com/e/salsa-thursdays-tickets-123" },
      ]);
    });

    it("does not bring a source's older untimed row's page over its fresh timed row's (review #20)", async () => {
      const source = await pageSource("https://salsa.example/");
      const night = { title: "Salsa Social", listing_type: "social", local_date: "2026-10-02" };
      const primaryPage = async (id: string) =>
        (
          await db
            .select({ role: eventSources.role, eventUrl: eventSources.eventUrl })
            .from(eventSources)
            .where(eq(eventSources.eventId, id))
        ).filter((l) => l.role === "primary");

      // An earlier run stored the night with no time and an older page; this run lists it at 9pm
      // with the page the site links now. The untimed row is merged into the timed one.
      const [untimed] = await storedBefore(source, [
        { ...night, eventUrl: "https://salsa.example/events/salsa-social-old" },
      ]);
      const [timed] = await storedBefore(source, [
        {
          ...night,
          doors_time: "21:00",
          eventUrl: "https://salsa.example/events/salsa-social-oct-2",
        },
      ]);
      expect(await statusOf(untimed!)).toBe("merged");
      expect(await primaryPage(timed!)).toEqual([
        { role: "primary", eventUrl: "https://salsa.example/events/salsa-social-oct-2" },
      ]);

      // A fresh read whose checks dropped the link does not get the old one back either.
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
      const again = await pageSource("https://salsa.example/");
      await storedBefore(again, [
        { ...night, eventUrl: "https://salsa.example/events/salsa-social-old" },
      ]);
      const [fresh] = await storedBefore(again, [{ ...night, doors_time: "21:00" }]);
      expect(await primaryPage(fresh!)).toEqual([{ role: "primary", eventUrl: null }]);
    });
  });

  describe("event pages as canonical URLs, and dedupe", () => {
    const listing = (source: Source, night: string, eventUrl: string | null, id: string | null) => {
      const harvested: HarvestedListing = {
        listing: rawListingSchema.parse({
          title: "Salsa Thursdays",
          listing_type: "social",
          styles: [],
          venue: { name: "Copacabana" },
          organizer: { name: "Salsa NYC" },
          local_date: night,
          dancing_time: "21:00",
        }),
        externalId: id,
        tz: null,
        venueLocation: { lat: 40.7652, lng: -73.9942 },
        recurrence: null,
        provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "llm" },
        eventUrl,
      };
      const outcome = normalizeListing(harvested, { metro, source, now: NOW });
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.event;
    };

    it("never pairs two nights of one list page, though their event pages share a path", async () => {
      const list = await pageSource("https://salsa.example/calendar");
      const other = await pageSource("https://salsa.example/");
      const write = (source: Source, evs: ReturnType<typeof listing>[]) =>
        writeEvents(db, {
          metro,
          source,
          events: evs,
          blocklist: EMPTY_BLOCKLIST,
          placeVenue: (input) => resolveVenue(db, metro, input),
        });
      await write(list, [
        listing(
          list,
          "2026-10-01",
          "https://salsa.example/events/salsa-thursdays-2026-10-01",
          null,
        ),
        listing(
          list,
          "2026-10-08",
          "https://salsa.example/events/salsa-thursdays-2026-10-08",
          null,
        ),
      ]);
      // The site's home page lists the October 1 night too, linking the same event page.
      await write(other, [
        listing(
          other,
          "2026-10-01",
          "https://salsa.example/events/salsa-thursdays-2026-10-01",
          null,
        ),
      ]);
      const report = await dedupeMetro(db, metro, ["2026-10-01", "2026-10-08"]);
      expect(report).toMatchObject({ pairs: 1, merged: 1 });
      const rows = await db
        .select({ night: events.nightDate, status: events.status, source: events.sourceIds })
        .from(events)
        .orderBy(events.nightDate, events.status);
      expect(rows.map((r) => [r.night, r.status])).toEqual([
        ["2026-10-01", "active"],
        ["2026-10-01", "merged"],
        ["2026-10-08", "active"],
      ]);
      const oct8 = pipelineId("event", `${list.id}:${listing(list, "2026-10-08", null, null).key}`);
      expect(await statusOf(oct8)).toBe("active");
    });
  });
});

describe("what event pages change in dedupe's URL score", () => {
  const side = (fields: Partial<DedupeSide>): DedupeSide => ({
    id: "x",
    startsAt: new Date("2026-10-02T01:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId: "v",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "first_party",
    firstSeenAt: NOW,
    ...fields,
  });
  const facts = { titleSimilarity: 0.4, organizerSimilarity: null };

  it("scores a shared event page where the list pages did not", () => {
    // Before D-073 a page read's canonical URL was the list it was read from; a single-event
    // source on the same site has its event page. Different path families: no URL point.
    const before = scorePair(
      side({ canonicalUrl: "https://salsa.example/calendar" }),
      side({ canonicalUrl: "https://salsa.example/events/salsa-thursdays" }),
      facts,
    );
    expect(before.parts.url).toBe(0);
    const after = scorePair(
      side({ canonicalUrl: "https://salsa.example/events/salsa-thursdays" }),
      side({ canonicalUrl: "https://salsa.example/events/salsa-thursdays" }),
      facts,
    );
    expect(after.parts.url).toBe(0.2);
    // Two different events of one site now share a path family too, and score the URL point:
    // enough, with a shared venue, to be queued, never to merge on the URL alone.
    const siblings = scorePair(
      side({ canonicalUrl: "https://salsa.example/events/salsa-thursdays" }),
      side({ canonicalUrl: "https://salsa.example/events/bachata-fridays" }),
      facts,
    );
    expect(siblings).toMatchObject({ parts: { url: 0.2 }, decision: "queued" });
  });

  it("matches a found Eventbrite page to the Eventbrite API's own row once tracking is stripped", () => {
    const api = side({ ticketUrl: "https://www.eventbrite.com/e/salsa-tickets-123" });
    const found = side({ ticketUrl: "https://www.eventbrite.com/e/salsa-tickets-123" });
    expect(scorePair(api, found, facts).parts.url).toBe(0.2);
    const withAff = side({ ticketUrl: "https://www.eventbrite.com/e/salsa-tickets-123?aff=site" });
    expect(scorePair(api, withAff, facts).parts.url).toBe(0);
  });
});
