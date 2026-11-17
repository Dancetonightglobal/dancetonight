// What the next ingest run does to rows an earlier read stored wrongly (D-070), end to end over a
// real database: the rows run 26 wrote are re-read from the extraction cache and corrected by the
// run itself, with no manual step.

import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, metros, organizers, sources } from "@/src/db/schema";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import {
  createPoliteHttp,
  fixtureTransport,
  type Fixture,
  type Transport,
  type TransportResponse,
} from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { normalizeListing, type NormalizedEvent } from "@/src/pipeline/normalize";
import {
  loadMetro,
  loadSources,
  pruneRawDocuments,
  resolveVenue,
  retireUnlisted,
  storedPageText,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-09-28, noon in New York: the night of run 26.
const NOW = new Date("2026-09-28T16:00:00Z");
const TONIGHT = "2026-09-28";

let db: Db;
let metro: Metro;

const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
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

/** A model that answers every read with these listings, or fails a part that holds `failOn`. */
function model(listings: Array<Record<string, unknown>>, failOn?: string): AiClient {
  return {
    async run(request: { user: string }) {
      if (failOn && request.user.includes(failOn)) {
        return { ok: false, reason: "provider_error", provider: "cloudflare", detail: "timed out" };
      }
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

/**
 * Writes rows as an earlier run's read stored them: dated, with what that read said. `old` puts
 * back what the earlier code stored and this one no longer does.
 */
async function storedBefore(
  source: Source,
  listings: Array<Record<string, unknown>>,
  old: (event: NormalizedEvent) => NormalizedEvent = (event) => event,
) {
  const normalized = listings.map((fields) => {
    const outcome = normalizeListing(
      {
        listing: rawListingSchema.parse({ styles: [], organizer: {}, ...fields }),
        externalId: null,
        tz: null,
        venueLocation: { lat: 40.7406, lng: -73.9916 },
        recurrence: null,
        provenance: { sourceUrl: source.url, fetchedAt: NOW, method: "llm" },
      },
      // The earlier code: no source tier, so nothing was withdrawn.
      { metro, source: { styles: source.styles }, now: NOW },
    );
    if (!outcome.ok) throw new Error(outcome.reason);
    return old(outcome.event);
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

describeDb("the next run corrects what run 26 stored (D-070)", () => {
  beforeAll(async () => {
    db = await testDb("listings");
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

  const STUDIO = "https://studio.example/socials";
  const studioPage = [
    "<html><body><h1>Social Event Details</h1>",
    "<h3>Robins Argentine Tango Practica</h3><p>Date: Every Thursday</p><p>Time: 9:30pm - 11:30pm</p>",
    "<h3>Tango Y Te</h3><p>Date: Every Sunday - Time: 3:00pm – 6:00 pm</p>",
    "</body></html>",
  ].join("");
  const venue = { name: "Stepping Out Studios", address: "37 W 26th St, New York, NY" };
  // Run 26's read of the page: a date on every weekly night, which the page never states.
  const run26: [Record<string, unknown>, Record<string, unknown>] = [
    {
      title: "Robins Argentine Tango Practica",
      listing_type: "practica",
      local_date: "2026-09-30",
      doors_time: "21:30",
      recurrence_text: "Every Thursday",
      venue,
    },
    {
      title: "Tango Y Te",
      listing_type: "social",
      local_date: "2026-09-29",
      doors_time: "15:00",
      recurrence_text: "Every Sunday",
      venue,
    },
  ];

  it("lists Stepping Out's weekly nights on their weekdays and retires the wrongly dated rows", async () => {
    const studio = await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const wrong = await storedBefore(studio, [
      ...run26,
      // Stored for tonight by an earlier run: tonight is left to the day-of check.
      { ...run26[0], local_date: TONIGHT },
    ]);
    // Another source's copy that dedupe had merged into the wrongly dated Tango Y Te.
    const other = await upsertSource(db, metro.id, {
      url: "https://tango.example/",
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const [copy] = await storedBefore(other, [{ ...run26[1], recurrence_text: null }]);
    await db
      .update(events)
      .set({ status: "merged", mergedIntoId: wrong[1] })
      .where(eq(events.id, copy!));

    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: { client: model(run26), cache: postgresExtractionCache(db) },
      ...httpAt([
        ok("https://studio.example/robots.txt", "User-agent: *\nDisallow:\n"),
        ok(STUDIO, studioPage),
      ]),
    });
    const line = report.sources.find((s) => s.url === STUDIO)!;
    expect(line).toMatchObject({ status: "ok", rejected: 0 });
    expect(line.notes[0]).toBe(
      "2 stored listing(s) this page no longer lists were retired: Tango Y Te on 2026-09-29; Robins Argentine Tango Practica on 2026-09-30",
    );
    expect(line.notes).toContain(
      "2 listing(s) came with a date the page does not state beside a recurrence it does: listed by the recurrence",
    );

    const rows = await db
      .select({
        id: events.id,
        title: events.title,
        night: events.nightDate,
        status: events.status,
        styles: events.styles,
        mergedIntoId: events.mergedIntoId,
      })
      .from(events)
      .orderBy(events.nightDate, events.title);
    const listed = rows
      .filter((r) => r.status === "active" && r.id !== copy)
      .map((r) => [r.title, r.night]);
    expect(listed).toEqual([
      ["Robins Argentine Tango Practica", TONIGHT],
      ["Robins Argentine Tango Practica", "2026-10-01"],
      ["Tango Y Te", "2026-10-04"],
      ["Robins Argentine Tango Practica", "2026-10-08"],
      ["Tango Y Te", "2026-10-11"],
    ]);
    expect(rows.filter((r) => wrong.slice(0, 2).includes(r.id)).map((r) => r.status)).toEqual([
      "removed",
      "removed",
    ]);
    // The copy merged into a retired row stands on its own again, for the next dedupe.
    expect(rows.find((r) => r.id === copy)).toMatchObject({ status: "active", mergedIntoId: null });
    // Tango Y Te is a tango night (L4).
    expect(rows.find((r) => r.title === "Tango Y Te" && r.status === "active")?.styles).toEqual([
      "tango",
    ]);

    // The second run reads the same page from the cache and changes nothing more.
    const again = await runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: { client: model(run26), cache: postgresExtractionCache(db) },
      ...httpAt([
        ok("https://studio.example/robots.txt", "User-agent: *\nDisallow:\n"),
        ok(STUDIO, studioPage),
      ]),
    });
    expect(again.sources.find((s) => s.url === STUDIO)?.notes[0]).not.toMatch(/retired/);
    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(events)
      .where(eq(events.status, "active"));
    expect(after[0]?.n).toBe(6);
  });

  it("retires nothing after a read with a part it could not read", async () => {
    const studio = await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const [wrongId] = await storedBefore(studio, [run26[0]]);
    // Two parts: the second fails, so the page's word on its nights is not complete.
    // The listing is on the part that is read (D-073: a title the page does not write is rejected).
    const long = `<html><body><h2>Part A</h2><p>${"a ".repeat(1_800)}</p><p>Tango Y Te, Every Sunday</p><h2>Part B</h2><p>${"b ".repeat(1_800)}</p></body></html>`;
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: { client: model([run26[1]], "Part B"), cache: postgresExtractionCache(db) },
      ...httpAt([
        ok("https://studio.example/robots.txt", "User-agent: *\nDisallow:\n"),
        ok(STUDIO, long),
      ]),
    });
    const line = report.sources.find((s) => s.url === STUDIO)!;
    expect(line.status).toBe("ok");
    expect(line.notes.some((n) => /parts could not be read/.test(n))).toBe(true);
    expect(line.notes.some((n) => /no longer lists/.test(n))).toBe(false);
    const [row] = await db.select().from(events).where(eq(events.id, wrongId!));
    expect(row?.status).toBe("active");
  });

  describe("an unchanged page whose read was partial (a 304)", () => {
    const long = `<html><body><h2>Part A</h2><p>${"a ".repeat(1_800)}</p><p>Robins Argentine Tango Practica, Thursday, October 1</p><h2>Part B</h2><p>${"b ".repeat(1_800)}</p></body></html>`;
    const dated = { ...run26[0], local_date: "2026-10-01", recurrence_text: null };
    /** The page answers 304 to a conditional request and the whole page to any other. */
    const conditional = (): Transport & { plain: number } => {
      const transport = async (req: Parameters<Transport>[0]): Promise<TransportResponse> => {
        if (req.url.endsWith("/robots.txt")) {
          return { url: req.url, status: 200, headers: {}, body: "User-agent: *\nDisallow:\n" };
        }
        if (req.headers["if-none-match"]) {
          return { url: req.url, status: 304, headers: { etag: '"v1"' }, body: "" };
        }
        transport.plain += 1;
        return { url: req.url, status: 200, headers: { etag: '"v1"' }, body: long };
      };
      transport.plain = 0;
      return transport;
    };
    /** The model's page text for each call. */
    const recording = (client: AiClient, seen: string[]) =>
      ({
        run: (request: { user: string }, ...rest: unknown[]) => {
          seen.push(request.user.slice(request.user.indexOf("Page text:")));
          return (client.run as (...args: unknown[]) => unknown)(request, ...rest);
        },
      }) as unknown as AiClient;

    const partialRead = async () => {
      await upsertSource(db, metro.id, {
        url: STUDIO,
        kind: "html",
        platform: "probed",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      const first = await runIngest({
        db,
        metro,
        env: {},
        only: [STUDIO],
        ai: { client: model([dated], "Part B"), cache: postgresExtractionCache(db) },
        ...httpAt(conditional()),
      });
      expect(first.sources.find((s) => s.url === STUDIO)?.notes.join(" ")).toMatch(
        /parts could not be read/,
      );
    };
    const readAgain = async (transport: Transport, seen: string[]) =>
      (
        await runIngest({
          db,
          metro,
          env: {},
          only: [STUDIO],
          ai: {
            client: recording(model([dated]), seen),
            cache: postgresExtractionCache(db),
          },
          ...httpAt(transport),
        })
      ).sources.find((s) => s.url === STUDIO)!;

    it("reads the text stored for the page, never an empty page", async () => {
      await partialRead();
      const seen: string[] = [];
      const transport = conditional();
      const line = await readAgain(transport, seen);
      // The part that failed last run (the one holding "Part B") is read now, from the stored text;
      // the other part was read and cached then.
      expect(transport.plain).toBe(0);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^Page text:\nPart A\n\na a a/);
      expect(line.status).toBe("ok");
      expect(line.notes).not.toContain("the model found no dance events on this page");
      expect(line.written).toBeGreaterThan(0);
      // The whole page's read is cached now: the next 304 asks the model nothing.
      const after: string[] = [];
      await readAgain(conditional(), after);
      expect(after).toEqual([]);
    });

    it("fetches the page again in full once its stored text is pruned", async () => {
      await partialRead();
      await pruneRawDocuments(db, new Date(NOW.getTime() + 4 * 86_400_000));
      const seen: string[] = [];
      const transport = conditional();
      const line = await readAgain(transport, seen);
      expect(transport.plain).toBe(1);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatch(/^Page text:\nPart A\n\na a a/);
      expect(line.status).toBe("ok");
      expect(line.written).toBeGreaterThan(0);
      // The text fetched again is stored again, for the next 304's date checks.
      const source = (await loadSources(db, metro.id)).find((s) => s.url === STUDIO)!;
      expect(await storedPageText(db, source.id, source.contentHash!)).toMatch(/^Part A/);
    });
  });

  it("retires only this source's rows after tonight that the run did not list", async () => {
    const studio = await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const ids = await storedBefore(studio, [run26[0], { ...run26[1], local_date: "2026-10-04" }]);
    expect(
      await retireUnlisted(db, { source: studio, listedIds: [], nights: ["2026-09-30"] }),
    ).toEqual({ retired: 0, notes: [] });
    const done = await retireUnlisted(db, {
      source: studio,
      listedIds: [ids[1]!],
      nights: ["2026-09-30", "2026-10-04"],
    });
    expect(done.retired).toBe(1);
    const rows = await db.select({ id: events.id, status: events.status }).from(events);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({
      [ids[0]!]: "removed",
      [ids[1]!]: "active",
    });
  });

  it("retires rows the page no longer gives on their night (owner, 2026-10-23)", async () => {
    const studio = await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // The page's text: "Fall Social" with its date, "Salsa Thursdays" with its weekday, "Past
    // Party" with another date, and no "Old Gala".
    const PAGE = [
      "Fall Social",
      "Sunday, October 4: Fall Social at the hall.",
      "Salsa Thursdays",
      "Every Thursday at 9pm.",
      "Past Party",
      "September 12: Past Party.",
    ].join("\n");
    // Store four rows.
    const rows = [
      { title: "Old Gala", night: "2026-10-04" },
      { title: "Fall Social", night: "2026-10-04" },
      { title: "Salsa Thursdays", night: "2026-10-01" }, // Thursday 2026-10-01
      { title: "Past Party", night: "2026-10-04" },
    ];
    const ids: string[] = [];
    for (const r of rows) {
      const [id] = await storedBefore(studio, [
        { title: r.title, listing_type: "social", local_date: r.night, doors_time: "20:00", venue },
      ]);
      ids.push(id!);
    }
    const result = await retireUnlisted(db, {
      source: studio,
      listedIds: [],
      nights: ["2026-10-01", "2026-10-04"],
      unsupportedIn: { text: PAGE, lang: "en" },
    });
    expect(result.retired).toBe(2);
    expect(result.notes[0]).toMatch(/no longer gives on their night/);
    const statuses = await db
      .select({ id: events.id, status: events.status })
      .from(events)
      .where(inArray(events.id, ids));
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s.status]));
    // Old Gala (title not written) -> removed
    expect(byId[ids[0]!]).toBe("removed");
    // Fall Social (date beside it) -> active
    expect(byId[ids[1]!]).toBe("active");
    // Salsa Thursdays (weekday beside it) -> active
    expect(byId[ids[2]!]).toBe("active");
    // Past Party (title written but wrong date) -> removed
    expect(byId[ids[3]!]).toBe("removed");
  });

  it("retires a stored night a multi-city page still writes once a read no longer lists it", async () => {
    const DAYBREAKER = "https://www.daybreaker.com/our-events/";
    const robots = ok("https://www.daybreaker.com/robots.txt", "User-agent: *\nDisallow:\n");
    await upsertSource(db, metro.id, {
      url: DAYBREAKER,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const venue = { name: "Stepping Out Studios", address: "37 W 26th St, New York, NY" };
    const sauna = {
      title: "Sauna Rave",
      listing_type: "dj_night",
      local_date: "2026-10-01",
      doors_time: "21:00",
      venue,
      event_url: "https://www.daybreaker.com/event/new-york-10-1/",
    };
    const friends = {
      title: "Let's Be Friends Dance Party",
      listing_type: "dj_night",
      local_date: "2026-10-03",
      doors_time: "10:00",
      venue,
    };
    const page1 = (etag: string): Fixture => ({
      request: { method: "GET", url: DAYBREAKER },
      response: {
        url: DAYBREAKER,
        status: 200,
        headers: { etag },
        body: `<html><body><a href="https://www.daybreaker.com/event/new-york-10-1/"><p>Oct 1, 2026</p><p>9PM - 12AM</p><p>New York</p><h2>Sauna Rave</h2></a><a href="https://www.daybreaker.com/event/atlanta-10-3/"><p>Oct 3, 2026</p><p>10AM - 1PM</p><p>Atlanta</p><h2>Let's Be Friends Dance Party</h2></a><p>Updated 1</p></body></html>`,
      },
    });
    // The page is unchanged but for a line: it still writes the Atlanta night beside its title.
    const page2 = (etag: string): Fixture => {
      const page = page1(etag);
      page.response.body = page.response.body.replace("Updated 1", "Updated 2");
      return page;
    };
    // Run 1: both nights listed
    await runIngest({
      db,
      metro,
      env: {},
      only: [DAYBREAKER],
      ai: { client: model([sauna, friends]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page1('"v1"')]),
    });
    // Run 2: only Sauna Rave listed
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [DAYBREAKER],
      ai: { client: model([sauna]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page2('"v2"')]),
    });
    const line = report.sources.find((s) => s.url === DAYBREAKER)!;
    expect(line.status).toBe("ok");
    // Should have retired the Atlanta night (Let's Be Friends Dance Party on 2026-10-03)
    const rows = await db
      .select({ title: events.title, night: events.nightDate, status: events.status })
      .from(events)
      .where(and(eq(events.metroId, metro.id), eq(events.status, "active")))
      .orderBy(events.nightDate);
    expect(rows).toEqual([{ title: "Sauna Rave", night: "2026-10-01", status: "active" }]);
    const removed = await db
      .select({ title: events.title, night: events.nightDate, status: events.status })
      .from(events)
      .where(and(eq(events.metroId, metro.id), eq(events.status, "removed")))
      .orderBy(events.nightDate);
    expect(removed).toEqual([
      { title: "Let's Be Friends Dance Party", night: "2026-10-03", status: "removed" },
    ]);
  });

  it("does not list again a retired night a multi-city page still writes", async () => {
    const DAYBREAKER = "https://www.daybreaker.com/our-events/";
    const robots = ok("https://www.daybreaker.com/robots.txt", "User-agent: *\nDisallow:\n");
    await upsertSource(db, metro.id, {
      url: DAYBREAKER,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const venue = { name: "Stepping Out Studios", address: "37 W 26th St, New York, NY" };
    const sauna = {
      title: "Sauna Rave",
      listing_type: "dj_night",
      local_date: "2026-10-01",
      doors_time: "21:00",
      venue,
      event_url: "https://www.daybreaker.com/event/new-york-10-1/",
    };
    const friends = {
      title: "Let's Be Friends Dance Party",
      listing_type: "dj_night",
      local_date: "2026-10-03",
      doors_time: "10:00",
      venue,
    };
    const page1 = (etag: string): Fixture => ({
      request: { method: "GET", url: DAYBREAKER },
      response: {
        url: DAYBREAKER,
        status: 200,
        headers: { etag },
        body: `<html><body><a href="https://www.daybreaker.com/event/new-york-10-1/"><p>Oct 1, 2026</p><p>9PM - 12AM</p><p>New York</p><h2>Sauna Rave</h2></a><a href="https://www.daybreaker.com/event/atlanta-10-3/"><p>Oct 3, 2026</p><p>10AM - 1PM</p><p>Atlanta</p><h2>Let's Be Friends Dance Party</h2></a><p>Updated 1</p></body></html>`,
      },
    });
    // The page is unchanged but for a line: it still writes the Atlanta night beside its title.
    const page2 = (etag: string): Fixture => {
      const page = page1(etag);
      page.response.body = page.response.body.replace("Updated 1", "Updated 2");
      return page;
    };
    // Run 1: both nights listed
    await runIngest({
      db,
      metro,
      env: {},
      only: [DAYBREAKER],
      ai: { client: model([sauna, friends]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page1('"v1"')]),
    });
    // Manually retire the Atlanta night (Let's Be Friends Dance Party on 2026-10-03)
    await db
      .update(events)
      .set({ status: "removed" })
      .where(
        and(
          eq(events.title, "Let's Be Friends Dance Party"),
          eq(events.nightDate, "2026-10-03"),
          eq(events.metroId, metro.id),
        ),
      );
    // Run 2: only Sauna Rave listed
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [DAYBREAKER],
      ai: { client: model([sauna]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page2('"v2"')]),
    });
    const line = report.sources.find((s) => s.url === DAYBREAKER)!;
    expect(line.status).toBe("ok");
    // Should NOT have a note about listing again
    expect(line.notes.some((n) => /listed again/.test(n))).toBe(false);
    // The retired row should still be removed
    const removed = await db
      .select({ title: events.title, night: events.nightDate, status: events.status })
      .from(events)
      .where(
        and(
          eq(events.title, "Let's Be Friends Dance Party"),
          eq(events.nightDate, "2026-10-03"),
          eq(events.metroId, metro.id),
        ),
      );
    expect(removed[0]?.status).toBe("removed");
  });

  it("retires an untimed no-dance row a venue calendar's whole read no longer lists (D-167)", async () => {
    const HOSTOS = "https://www.hostoscenter.org/events";
    const robots = ok("https://www.hostoscenter.org/robots.txt", "User-agent: *\nDisallow:\n");
    // Upsert source with mixedCalendar: true (the seed has mixedCalendar: true)
    await upsertSource(db, metro.id, {
      url: HOSTOS,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      mixedCalendar: true,
    });
    const venue = { name: "Stepping Out Studios", address: "37 W 26th St, New York, NY" };
    const violines = {
      title: "Violines Para Ochún",
      listing_type: "other",
      local_date: "2026-10-04",
      venue,
    };
    const salsaSocial = {
      title: "Salsa Social",
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-10-04",
      venue,
    };
    const bachata = {
      title: "Bachata Night",
      listing_type: "social",
      styles: ["bachata"],
      local_date: "2026-10-03",
      dancing_time: "22:00",
      venue,
    };
    const page1 = (etag: string): Fixture => ({
      request: { method: "GET", url: HOSTOS },
      response: {
        url: HOSTOS,
        status: 200,
        headers: { etag },
        body: `<html><body><h2>Bachata Night</h2><p>Saturday, October 3, 10pm</p><h2>Violines Para Ochún</h2><p>Sunday, October 4</p><h2>Salsa Social</h2><p>Sunday, October 4</p><p>Updated 1</p></body></html>`,
      },
    });
    const page2 = (etag: string): Fixture => {
      const page = page1(etag);
      page.response.body = page.response.body.replace("Updated 1", "Updated 2");
      return page;
    };
    // Run 1: all three listed
    await runIngest({
      db,
      metro,
      env: {},
      only: [HOSTOS],
      ai: { client: model([violines, salsaSocial, bachata]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page1('"v1"')]),
    });
    // Check that Violines is active (if screened at write time, the premise is wrong)
    const afterRun1 = await db
      .select({ title: events.title, night: events.nightDate, status: events.status })
      .from(events)
      .where(eq(events.metroId, metro.id))
      .orderBy(events.title);
    expect(afterRun1).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Violines Para Ochún",
          night: "2026-10-04",
          status: "active",
        }),
        expect.objectContaining({ title: "Salsa Social", night: "2026-10-04", status: "active" }),
        expect.objectContaining({ title: "Bachata Night", night: "2026-10-03", status: "active" }),
      ]),
    );
    // Run 2: only Bachata listed
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [HOSTOS],
      ai: { client: model([bachata]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page2('"v2"')]),
    });
    const line = report.sources.find((s) => s.url === HOSTOS)!;
    expect(line.status).toBe("ok");
    // Should have a note about Violines being retired
    expect(
      line.notes.some((n) =>
        /Violines Para Ochún on 2026-10-04 \(names no dance and no time/.test(n),
      ),
    ).toBe(true);
    // Salsa Social stays active (kept by D-079)
    const afterRun2 = await db
      .select({ title: events.title, night: events.nightDate, status: events.status })
      .from(events)
      .where(eq(events.metroId, metro.id))
      .orderBy(events.title);
    expect(afterRun2).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Violines Para Ochún",
          night: "2026-10-04",
          status: "removed",
        }),
        expect.objectContaining({ title: "Salsa Social", night: "2026-10-04", status: "active" }),
        expect.objectContaining({ title: "Bachata Night", night: "2026-10-03", status: "active" }),
      ]),
    );
  });

  const salsa = {
    title: "Salsa Thursdays",
    listing_type: "social",
    local_date: "2026-10-01",
    doors_time: "21:00",
    recurrence_text: "Every Thursday",
    venue,
  };
  const salsaPage = (etag: string): Fixture => ({
    request: { method: "GET", url: STUDIO },
    response: {
      url: STUDIO,
      status: 200,
      headers: { etag },
      body: "<html><body><h2>Salsa Thursdays</h2><p>Every Thursday, 9pm. Next: Thursday, October 1</p><h2>Bachata Fridays</h2><p>Friday, October 2, 9pm</p></body></html>",
    },
  });
  const robots = ok("https://studio.example/robots.txt", "User-agent: *\nDisallow:\n");

  it("checks an unchanged page's dates against the text stored when it was read", async () => {
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const run = (fixtures: Fixture[]) =>
      runIngest({
        db,
        metro,
        env: {},
        only: [STUDIO],
        ai: { client: model([salsa]), cache: postgresExtractionCache(db) },
        ...httpAt(fixtures),
      });
    await run([robots, salsaPage('"v1"')]);
    // The second fetch is answered 304: no page text in hand, only the stored one.
    const report = await run([
      robots,
      {
        request: { method: "GET" as const, url: STUDIO },
        response: { url: STUDIO, status: 304, headers: { etag: '"v1"' }, body: "" },
      },
    ]);
    expect(report.sources.find((s) => s.url === STUDIO)?.adapter).toMatch(/^llm \(cached/);
    const rows = await db
      .select({ night: events.nightDate, confirmation: events.confirmation })
      .from(events)
      .where(eq(events.status, "active"))
      .orderBy(events.nightDate);
    // The page writes October 1, so that night is the dated listing, seen, not a rule's guess.
    expect(rows).toEqual([
      { night: "2026-10-01", confirmation: "confirmed_today" },
      { night: "2026-10-08", confirmation: "recurring_unconfirmed" },
    ]);
  });

  // A read that drops a night's time gives way to the timed row (D-060) while the page writes the
  // time; once the page no longer writes it, the night is listed with no time (seam review,
  // 2026-09-29: a time is kept only where the listing's own part of the page writes it).
  it.each([
    ["while the page still writes its time", "Next: ", "Next night: ", "2026-10-02T01:00:00Z"],
    ["with no time once the page no longer writes it", "9pm. ", "", null],
  ])(
    "keeps a timed night that a listing without its time gave way to, %s",
    async (_, from, to, oct1) => {
      await upsertSource(db, metro.id, {
        url: STUDIO,
        kind: "html",
        platform: "probed",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
      const run = (listings: Array<Record<string, unknown>>, fixtures: Fixture[]) =>
        runIngest({
          db,
          metro,
          env: {},
          only: [STUDIO],
          ai: { client: model(listings), cache: postgresExtractionCache(db) },
          ...httpAt(fixtures),
        });
      const dated = { ...salsa, recurrence_text: null };
      await run([dated], [robots, salsaPage('"v1"')]);
      // The page changes and the next read drops the time, while another night on the page is
      // written, so the read retires what it no longer lists.
      const changed = salsaPage('"v2"');
      changed.response.body = changed.response.body.replace(from, to);
      expect(changed.response.body).not.toBe(salsaPage('"v2"').response.body);
      const bachata = { ...dated, title: "Bachata Fridays", local_date: "2026-10-02" };
      const report = await run([{ ...dated, doors_time: null }, bachata], [robots, changed]);
      const line = report.sources.find((s) => s.url === STUDIO)!;
      expect(line.notes.some((n) => /already lists that night with one/.test(n))).toBe(true);
      expect(line.notes.some((n) => /no longer lists/.test(n))).toBe(false);
      const rows = await db
        .select({ night: events.nightDate, status: events.status, startsAt: events.startsAt })
        .from(events)
        .where(inArray(events.status, ["active", "cancelled"]))
        .orderBy(events.nightDate);
      expect(rows).toEqual([
        { night: "2026-10-01", status: "active", startsAt: oct1 === null ? null : new Date(oct1) },
        { night: "2026-10-02", status: "active", startsAt: new Date("2026-10-03T01:00:00Z") },
      ]);
    },
  );

  // Each run reads a changed page (a new etag and body), so the model reads it afresh. `dropped`
  // is a page that no longer writes October 1: the night is gone from it, not only from the read.
  const pageRun = (n: number, dropped = false, time = "9pm"): Fixture => {
    const page = salsaPage(`"v${n}"`);
    page.response.body = page.response.body.replace(
      "Every Thursday, 9pm",
      `Every Thursday, ${time}`,
    );
    page.response.body = page.response.body.replace("</body>", `<p>Updated ${n}</p></body>`);
    if (dropped) page.response.body = page.response.body.replace(" Next: Thursday, October 1", "");
    return page;
  };
  const listingsRun = (
    listings: Array<Record<string, unknown>>,
    n: number,
    dropped = false,
    time = "9pm",
  ) =>
    runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: { client: model(listings), cache: postgresExtractionCache(db) },
      ...httpAt([robots, pageRun(n, dropped, time)]),
    });
  const salsaRows = () =>
    db
      .select({ status: events.status, startsAt: events.startsAt })
      .from(events)
      .where(and(eq(events.title, "Salsa Thursdays"), eq(events.nightDate, "2026-10-01")))
      .orderBy(events.startsAt);

  it("lists again a night one read missed and a later read lists", async () => {
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const dated = { ...salsa, recurrence_text: null };
    const bachata = { ...dated, title: "Bachata Fridays", local_date: "2026-10-02" };
    await listingsRun([dated, bachata], 1);
    const missed = await listingsRun([bachata], 2, true);
    expect(missed.sources.find((s) => s.url === STUDIO)?.notes[0]).toBe(
      "1 stored listing(s) this page no longer lists were retired: Salsa Thursdays on 2026-10-01",
    );
    expect(await salsaRows()).toEqual([
      { status: "removed", startsAt: new Date("2026-10-02T01:00:00Z") },
    ]);
    await listingsRun([dated, bachata], 3);
    expect(await salsaRows()).toEqual([
      { status: "active", startsAt: new Date("2026-10-02T01:00:00Z") },
    ]);
  });

  it("keeps a night the read missed while the page still writes its title and date (D-079)", async () => {
    // Frim Fram Jam, run 29: the page wrote "October 1, 2026" under its title, the model gave
    // that night a title the page does not write, and the stored October 1 row was retired.
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const dated = { ...salsa, recurrence_text: null };
    const bachata = { ...dated, title: "Bachata Fridays", local_date: "2026-10-02" };
    await listingsRun([dated, bachata], 1);
    const missed = await listingsRun([bachata], 2);
    const line = missed.sources.find((s) => s.url === STUDIO)!;
    expect(line.notes.some((n) => /no longer lists/.test(n))).toBe(false);
    expect(await salsaRows()).toEqual([
      { status: "active", startsAt: new Date("2026-10-02T01:00:00Z") },
    ]);
  });

  it("lists again a night an earlier read retired while the page still writes it (D-079)", async () => {
    // Run 29 retired Frim Fram Jam's October 1 row before this rule; the page is unchanged, so the
    // next read comes from the cache with the same miss. The row comes back on that run.
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const dated = { ...salsa, recurrence_text: null };
    const bachata = { ...dated, title: "Bachata Fridays", local_date: "2026-10-02" };
    await listingsRun([dated, bachata], 1);
    await db
      .update(events)
      .set({ status: "removed" })
      .where(and(eq(events.title, "Salsa Thursdays"), eq(events.nightDate, "2026-10-01")));
    const again = await listingsRun([bachata], 2);
    expect(again.sources.find((s) => s.url === STUDIO)?.notes).toContain(
      "1 listing(s) retired before that the page still writes were listed again: Salsa Thursdays on 2026-10-01",
    );
    expect(await salsaRows()).toEqual([
      { status: "active", startsAt: new Date("2026-10-02T01:00:00Z") },
    ]);
  });

  it("does not list again a retired row whose title is screened (D-156)", async () => {
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const dated = { ...salsa, recurrence_text: null };
    const bachata = { ...dated, title: "Bachata Fridays", local_date: "2026-10-02" };
    await listingsRun([dated, bachata], 1);
    const [row] = await db
      .select({ titleNormalized: events.titleNormalized })
      .from(events)
      .where(and(eq(events.title, "Salsa Thursdays"), eq(events.nightDate, "2026-10-01")));
    await db
      .update(events)
      .set({
        status: "removed",
        title: "Karaoke Thursdays",
        titleNormalized: row!.titleNormalized.replace(/salsa/i, "karaoke"),
      })
      .where(and(eq(events.title, "Salsa Thursdays"), eq(events.nightDate, "2026-10-01")));
    const page = pageRun(2);
    page.response.body = page.response.body.replace(
      "<h2>Salsa Thursdays</h2>",
      "<h2>Karaoke Thursdays</h2>",
    );
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: { client: model([bachata]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, page]),
    });
    expect(
      report.sources.find((s) => s.url === STUDIO)?.notes.some((n) => /listed again/.test(n)),
    ).toBe(false);
    const [after] = await db
      .select({ status: events.status })
      .from(events)
      .where(and(eq(events.title, "Karaoke Thursdays"), eq(events.nightDate, "2026-10-01")));
    expect(after?.status).toBe("removed");
  });

  it("retires tonight's row on a weekday the page contradicts, and lists the page's rule (D-079)", async () => {
    // Tango Y Te, run 29: dated a Tuesday (tonight) where the page gives Sunday beside it. The read
    // put it on Sundays, and the Tuesday row an earlier read stored stayed on tonight's list.
    const studio = await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const tonightRow = { ...run26[1], local_date: TONIGHT, recurrence_text: null };
    const [storedId] = await storedBefore(studio, [tonightRow]);
    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: { client: model([tonightRow]), cache: postgresExtractionCache(db) },
      ...httpAt([robots, ok(STUDIO, studioPage)]),
    });
    const line = report.sources.find((s) => s.url === STUDIO)!;
    expect(line.notes).toContain(
      `1 stored listing(s) on a night the page contradicts were retired: Tango Y Te on ${TONIGHT}`,
    );
    const rows = await db
      .select({ id: events.id, night: events.nightDate, status: events.status })
      .from(events)
      .where(eq(events.title, "Tango Y Te"))
      .orderBy(events.nightDate);
    expect(rows.find((r) => r.id === storedId)?.status).toBe("removed");
    expect(rows.filter((r) => r.status === "active").map((r) => r.night)).toEqual([
      "2026-10-04",
      "2026-10-11",
    ]);
  });

  it("lists a night at 9pm after its time changed to 8pm and back", async () => {
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const nine = { ...salsa, recurrence_text: null };
    const eight = { ...nine, doors_time: "20:00" };
    await listingsRun([nine], 1);
    await listingsRun([eight], 2, false, "8pm");
    await listingsRun([nine], 3);
    expect(await salsaRows()).toEqual([
      { status: "removed", startsAt: new Date("2026-10-02T00:00:00Z") },
      { status: "active", startsAt: new Date("2026-10-02T01:00:00Z") },
    ]);
  });

  describe("D-079's restore beside a night this source still lists (seam review, 2026-09-29)", () => {
    it("does not list again a row the source's mixed-calendar screen now leaves out", async () => {
      await setUp();
      // Build a page with a concert card (Jazz Trio Live) that will be screened out on a mixed calendar.
      const pageWithConcert = (etag: string): Fixture => ({
        request: { method: "GET" as const, url: STUDIO },
        response: {
          url: STUDIO,
          status: 200,
          headers: { etag },
          body: `<html><body><h1>Upcoming events</h1>
            <div><h3>Lindy Hop Class</h3><p>Thu, Oct 1 • 6:30 PM</p><p>Stepping Out Studios</p><a href="https://studio.example/e/lindy-0/">Learn More</a></div>
            <div><h3>Jazz Trio Live</h3><p>Sat, Oct 3 • 8:00 PM</p><p>Stepping Out Studios</p></div>
            <div><h3>Swing Social Night</h3><p>Fri, Oct 2 • 9:00 PM</p><p>Stepping Out Studios</p><a href="https://studio.example/e/social/">Learn More</a></div>
            </body></html>`,
        },
      });
      const jazzTrio = {
        title: "Jazz Trio Live",
        listing_type: "social",
        local_date: "2026-10-03",
        dancing_time: "20:00",
        venue,
      };
      const lindyCard = lindy("18:30");
      const socialCard = social;
      // First read: all three listings
      await read(pageWithConcert('"v1"'), [lindyCard, jazzTrio, socialCard]);
      // Mark source as mixed calendar
      await db.update(sources).set({ mixedCalendar: true }).where(eq(sources.url, STUDIO));
      // Second read: same page, same listings
      const line = await read(pageWithConcert('"v2"'), [lindyCard, jazzTrio, socialCard]);
      // Jazz Trio Live should be removed (screened out) and not restored.
      // Its own night (Saturday): the restore only lists again a night this source lists nothing on.
      const jazzRows = await db
        .select({ title: events.title, night: events.nightDate, status: events.status })
        .from(events)
        .where(and(eq(events.title, "Jazz Trio Live"), eq(events.nightDate, "2026-10-03")));
      expect(jazzRows).toHaveLength(1);
      expect(jazzRows[0]?.status).toBe("removed");
      // Swing Social Night should stay active
      const socialRows = await db
        .select({ status: events.status })
        .from(events)
        .where(and(eq(events.title, "Swing Social Night"), eq(events.nightDate, "2026-10-02")));
      expect(socialRows[0]?.status).toBe("active");
      // No note about listing again
      expect(line.notes.some((n) => /were listed again/.test(n))).toBe(false);
    });
    // A card page that dates each class beside its title, as NYC Swings does. Every run is a fresh
    // model read: the cache never answers.
    const cards = (sessions: string[]) =>
      ok(
        STUDIO,
        `<html><body><h1>Upcoming events</h1>${sessions
          .map(
            (time, i) =>
              `<div><h3>Lindy Hop Class</h3><p>Thu, Oct 1 • ${time}</p><p>Stepping Out Studios</p><a href="https://studio.example/e/lindy-${i}/">Learn More</a></div>`,
          )
          .join(
            "",
          )}<div><h3>Swing Social Night</h3><p>Fri, Oct 2 • 9:00 PM</p><p>Stepping Out Studios</p><a href="https://studio.example/e/social/">Learn More</a></div></body></html>`,
      );
    const fresh = { get: async () => null, put: async () => {} };
    const lindy = (time: string) => ({
      title: "Lindy Hop Class",
      listing_type: "class",
      local_date: "2026-10-01",
      dancing_time: time,
      venue,
    });
    const social = {
      title: "Swing Social Night",
      listing_type: "social",
      local_date: "2026-10-02",
      dancing_time: "21:00",
      venue,
    };
    const read = async (page: Fixture, listings: Array<Record<string, unknown>>) =>
      (
        await runIngest({
          db,
          metro,
          env: {},
          only: [STUDIO],
          ai: { client: model(listings), cache: fresh },
          ...httpAt([robots, page]),
        })
      ).sources.find((s) => s.url === STUDIO)!;
    /** Lindy Hop Class's October 1 rows standing, as "HH:MM" New York time or "untimed". */
    const standing = async () =>
      (
        await db
          .select({ status: events.status, startsAt: events.startsAt })
          .from(events)
          .where(and(eq(events.title, "Lindy Hop Class"), eq(events.nightDate, "2026-10-01")))
      )
        .filter((r) => r.status === "active" || r.status === "cancelled")
        .map((r) =>
          r.startsAt
            ? new Intl.DateTimeFormat("en-GB", {
                timeZone: "America/New_York",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              }).format(r.startsAt)
            : "untimed",
        )
        .sort();
    const setUp = () =>
      upsertSource(db, metro.id, {
        url: STUDIO,
        kind: "html",
        platform: "probed",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });

    it("does not list an old time again beside the untimed listing a withdrawn time made", async () => {
      await setUp();
      await read(cards(["6:30 PM"]), [lindy("18:30"), social]);
      // The page's time changes: the 6:30 row is retired as unlisted.
      await read(cards(["7:00 PM"]), [lindy("19:00"), social]);
      // The page drops the time and the model gives 7:30, which the page does not write:
      // withdrawn (D-081), the untimed listing is written and the 7:00 row is retired into it.
      await read(cards(["time to be announced"]), [lindy("19:30"), social]);
      expect(await standing()).toEqual(["untimed"]);
      // The model misses the class: the page still states the night, but this source lists it.
      const line = await read(cards(["time to be announced"]), [social]);
      expect(line.notes.some((n) => /were listed again/.test(n))).toBe(false);
      expect(await standing()).toEqual(["untimed"]);
    });

    it("keeps the page's time through a slip and a miss", async () => {
      await setUp();
      await read(cards(["6:30 PM"]), [lindy("18:30"), social]);
      await read(cards(["7:00 PM"]), [lindy("19:00"), social]);
      // The model slips to 7:30: withdrawn, but the 7:00 row is at the time the page writes, and
      // stays (seam review F4). Then the model misses the class, and the 6:30 row stays off.
      await read(cards(["7:00 PM"]), [lindy("19:30"), social]);
      expect(await standing()).toEqual(["19:00"]);
      const line = await read(cards(["7:00 PM"]), [social]);
      expect(line.notes.some((n) => /were listed again/.test(n))).toBe(false);
      expect(await standing()).toEqual(["19:00"]);
    });

    it("does not list an old time again beside the row that replaced it", async () => {
      await setUp();
      await read(cards(["6:30 PM"]), [lindy("18:30"), social]);
      await read(cards(["7:00 PM"]), [lindy("19:00"), social]);
      const line = await read(cards(["7:00 PM"]), [social]);
      expect(line.notes.some((n) => /were listed again/.test(n))).toBe(false);
      expect(await standing()).toEqual(["19:00"]);
    });

    it("leaves a missed session of a title off while another session of it stands", async () => {
      // The trade-off: two sessions of one title on one night are one title and night, so the
      // restore keeps the missed one off until a read lists it again.
      await setUp();
      const page = cards(["7:00 PM", "8:30 PM"]);
      await read(page, [lindy("19:00"), lindy("20:30"), social]);
      await read(page, [lindy("19:00"), social]);
      expect(await standing()).toEqual(["19:00"]);
      await read(page, [social]);
      expect(await standing()).toEqual(["19:00"]);
      await read(page, [lindy("19:00"), lindy("20:30"), social]);
      expect(await standing()).toEqual(["19:00", "20:30"]);
    });
  });

  describe("this source's untimed row merged into a timed row the page no longer lists", () => {
    const setUp = async () => {
      await upsertSource(db, metro.id, {
        url: STUDIO,
        kind: "html",
        platform: "probed",
        trustTier: "first_party",
        discoveredBy: "seed_list",
      });
    };
    const nine = { ...salsa, recurrence_text: null };
    const untimed = { ...nine, doors_time: null };
    const bachata = { ...nine, title: "Bachata Fridays", local_date: "2026-10-02" };

    it("is retired with it when the page drops the night", async () => {
      await setUp();
      await listingsRun([untimed, bachata], 1);
      await listingsRun([nine, bachata], 2);
      expect((await salsaRows()).map((r) => r.status)).toEqual(["active", "merged"]);
      await listingsRun([bachata], 3, true);
      expect(await salsaRows()).toEqual([
        { status: "removed", startsAt: new Date("2026-10-02T01:00:00Z") },
        { status: "removed", startsAt: null },
      ]);
    });

    it("is retired with it when the night moves to another time", async () => {
      await setUp();
      await listingsRun([untimed], 1);
      await listingsRun([nine], 2);
      await listingsRun([{ ...nine, doors_time: "20:00" }], 3, false, "8pm");
      expect(await salsaRows()).toEqual([
        { status: "active", startsAt: new Date("2026-10-02T00:00:00Z") },
        { status: "removed", startsAt: new Date("2026-10-02T01:00:00Z") },
        { status: "removed", startsAt: null },
      ]);
    });

    it("stands on its own again when this run listed it", async () => {
      await setUp();
      const studio = (await loadSources(db, metro.id))[0]!;
      // Written untimed, then with a time: the untimed row is merged into the timed one.
      const [untimedId] = await storedBefore(studio, [untimed, nine]);
      expect((await salsaRows()).map((r) => r.status)).toEqual(["active", "merged"]);
      await retireUnlisted(db, { source: studio, listedIds: [untimedId!], nights: ["2026-10-01"] });
      expect(await salsaRows()).toEqual([
        { status: "removed", startsAt: new Date("2026-10-02T01:00:00Z") },
        { status: "active", startsAt: null },
      ]);
    });
  });

  it("keeps a Thursday night whose phrase names a Tuesday first", async () => {
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const report = await listingsRun(
      [{ ...salsa, recurrence_text: "Tuesdays 8pm & Thursdays 9pm" }],
      1,
    );
    expect(report.sources.find((s) => s.url === STUDIO)).toMatchObject({
      status: "ok",
      rejected: 0,
    });
    const rows = await db
      .select({ night: events.nightDate, status: events.status, startsAt: events.startsAt })
      .from(events)
      .orderBy(events.nightDate);
    expect(rows).toEqual([
      { night: "2026-10-01", status: "active", startsAt: new Date("2026-10-02T01:00:00Z") },
    ]);
  });

  it("lists an every-other-Thursday night on the week the page writes, not the week it is off", async () => {
    await upsertSource(db, metro.id, {
      url: STUDIO,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const page = pageRun(1);
    page.response.body =
      "<html><body><h2>Salsa Thursdays</h2><p>Every other Thursday, 9pm. Next: Thursday, October 8</p></body></html>";
    await runIngest({
      db,
      metro,
      env: {},
      only: [STUDIO],
      ai: {
        client: model([
          { ...salsa, local_date: "2026-10-08", recurrence_text: "Every other Thursday" },
        ]),
        cache: postgresExtractionCache(db),
      },
      ...httpAt([robots, page]),
    });
    const rows = await db
      .select({ night: events.nightDate, status: events.status })
      .from(events)
      .orderBy(events.nightDate);
    expect(rows).toEqual([{ night: "2026-10-08", status: "active" }]);
  });

  const DIRECTORY = "https://theronda.example/nyc";
  const EVENT_PAGE = "https://theronda.example/event/tango-cafe-2026-09-30-74420121";
  const directoryPage = [
    "<html><body><h1>Tango Events in New York City</h1>",
    "<h2>Wednesday, September 30, 2026</h2>",
    "<p>milonga</p>",
    `<p><a href="${EVENT_PAGE}">Tango Cafe</a></p>`,
    "<p>You Should Be Dancing (37W 26th St, 2nd Fl). Class: 7-8p. Door code: 9035#</p>",
    // The level is the page's (D-103): a level it does not write is dropped.
    "<p>Beginners welcome</p>",
    "</body></html>",
  ].join("");
  const tangoCafe = {
    title: "Tango Cafe",
    listing_type: "other",
    styles: ["milonga"],
    local_date: "2026-09-30",
    doors_time: "19:00",
    venue: { name: "You Should Be Dancing", address: "37 W 26th St, New York, NY" },
    organizer: { name: "Theronda", url: null },
    ticket_url: EVENT_PAGE,
    dress_code: "Door code: 9035#",
    level: "beginner",
  };

  it("clears a directory's own event page, name and door code from the stored row", async () => {
    const ronda = await upsertSource(db, metro.id, {
      url: DIRECTORY,
      kind: "html",
      platform: "probed",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
    // What run 26 stored: the door code as the dress code, the level as the page wrote it.
    const [id] = await storedBefore(ronda, [tangoCafe], (e) => ({
      ...e,
      dressCode: tangoCafe.dress_code,
      level: tangoCafe.level,
      ticketUrl: EVENT_PAGE,
      canonicalUrl: null,
      withdrawn: [],
    }));
    const [before] = await db.select().from(events).where(eq(events.id, id!));
    expect(before).toMatchObject({
      ticketUrl: EVENT_PAGE,
      canonicalUrl: DIRECTORY,
      dressCode: "Door code: 9035#",
      level: "beginner",
      listingType: "other",
    });
    expect(before?.organizerId).not.toBeNull();

    const report = await runIngest({
      db,
      metro,
      env: {},
      only: [DIRECTORY],
      ai: { client: model([tangoCafe]), cache: postgresExtractionCache(db) },
      ...httpAt([
        ok("https://theronda.example/robots.txt", "User-agent: *\nDisallow:\n"),
        ok(DIRECTORY, directoryPage),
      ]),
    });
    expect(report.sources.find((s) => s.url === DIRECTORY)).toMatchObject({
      status: "ok",
      written: 1,
    });
    const [after] = await db.select().from(events).where(eq(events.id, id!));
    expect(after).toMatchObject({
      status: "active",
      ticketUrl: null,
      canonicalUrl: EVENT_PAGE,
      dressCode: null,
      organizerId: null,
      listingType: "social",
      level: "Beginner",
    });
    // Their provenance is no longer current; the organiser row itself is left for others to use.
    const facts = await db
      .select({ field: fieldProvenance.field, isCurrent: fieldProvenance.isCurrent })
      .from(fieldProvenance)
      .where(
        and(
          eq(fieldProvenance.entityId, id!),
          sql`${fieldProvenance.field} in ('organizer_name', 'dress_code', 'ticket_url')`,
        ),
      );
    expect(facts.every((f) => !f.isCurrent)).toBe(true);
    expect(facts.map((f) => f.field).sort()).toEqual([
      "dress_code",
      "organizer_name",
      "ticket_url",
    ]);
    expect((await db.select().from(organizers)).length).toBe(1);
  });
});
