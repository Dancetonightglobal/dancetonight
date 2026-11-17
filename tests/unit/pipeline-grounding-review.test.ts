// What a read's grounding retires, end to end over a real database (review 2026-09-29): a partial
// read retires nothing, whatever it rejected (#2); a title the page writes whose recurrence it does
// not is never retired as a title, and a whole read retires only the nights that recurrence made,
// never a night the page states or a weekday it names beside the title (#1a, #17).

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import { loadMetro, resolveVenue, upsertSource, writeEvents } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-09-28, noon in New York.
const NOW = new Date("2026-09-28T16:00:00Z");

let db: Db;
let metro: Metro;

const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
});

function httpAt(fixtures: Fixture[]) {
  let t = NOW.getTime();
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

/** A model that answers every read with these listings, or fails a part that holds `failOn`. */
function model(listings: Array<Record<string, unknown>>, failOn?: string): AiClient {
  return {
    async run(request: { user: string }) {
      if (failOn && request.user.includes(failOn)) {
        return { ok: false, reason: "provider_error", provider: "cloudflare", detail: "503" };
      }
      return {
        ok: true,
        provider: "cloudflare",
        model: "@cf/ibm-granite/granite-4.0-h-micro",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: listings.map((l) => ({ styles: [], organizer: {}, venue, ...l })),
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

const statusOf = async (id: string | undefined) =>
  (await db.select({ status: events.status }).from(events).where(eq(events.id, id!)))[0]?.status;

const PAGE = "https://studio.example/";

async function ingest(html: string, listings: Array<Record<string, unknown>>, failOn?: string) {
  const report = await runIngest({
    db,
    metro,
    env: {},
    only: [PAGE],
    ai: { client: model(listings, failOn), cache: postgresExtractionCache(db) },
    ...httpAt([ok(`${PAGE}robots.txt`, "User-agent: *\nDisallow:\n"), ok(PAGE, html)]),
  });
  return report.sources.find((s) => s.url === PAGE)!;
}

/** A page of two parts, the second of which the model fails to read (a provider's 503). */
const twoParts = (a: string, b: string) =>
  `<html><body><h2>Part A</h2><p>${"a ".repeat(1_800)}</p><p>${a}</p><h2>Part B</h2><p>${"b ".repeat(1_800)}</p><p>${b}</p></body></html>`;

describeDb("what a read's grounding retires (review 2026-09-29)", () => {
  let source: Source;

  beforeAll(async () => {
    db = await testDb("grounding_review");
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
    source = await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  });

  const salsa = { title: "Salsa Social", listing_type: "social", dancing_time: "21:00" };

  describe("a partial read (#2)", () => {
    it("retires nothing under a title the page does not write", async () => {
      const nylon = { title: "Nylon Lindy Hop", listing_type: "class", doors_time: "19:00" };
      const [oct1] = await storedBefore(source, [{ ...nylon, local_date: "2026-10-01" }]);
      const line = await ingest(
        twoParts("Balboa Night, Friday, October 2", "More nights"),
        [{ ...nylon, recurrence_text: "every Thursday" }],
        "More nights",
      );
      expect(line.status).toBe("ok");
      expect(line.notes).toContain(
        "Nylon Lindy Hop: the page does not write this title; not listed",
      );
      expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
      expect(line.notes.join(" ")).not.toMatch(/were retired/);
      expect(await statusOf(oct1)).toBe("active");
    });

    it("retires nothing under a title whose recurrence the part it read does not write", async () => {
      // The review's page: part A praises the Salsa Social, part B (not read) lists its Fridays.
      // Not even the Thursday an earlier read took from the model goes on a partial read.
      const [oct1, oct2, oct9] = await storedBefore(source, [
        { ...salsa, local_date: "2026-10-01" },
        { ...salsa, local_date: "2026-10-02" },
        { ...salsa, local_date: "2026-10-09" },
      ]);
      const line = await ingest(
        twoParts("Our Salsa Social is the best in town", "Salsa Social, every Friday, 9pm"),
        [{ ...salsa, recurrence_text: "every Thursday" }],
        "Salsa Social, every Friday, 9pm",
      );
      expect(line).toMatchObject({ status: "ok", written: 0, rejected: 1 });
      expect(line.notes.join(" ")).not.toMatch(/were retired/);
      expect(await statusOf(oct1)).toBe("active");
      expect(await statusOf(oct2)).toBe("active");
      expect(await statusOf(oct9)).toBe("active");
    });
  });

  describe("a title whose recurrence the page does not write, on a whole read (#1a, #17)", () => {
    it("keeps the nights the page states, and retires those the invented rule made", async () => {
      // The page writes the Salsa Social's dates, and no weekday; an earlier read also stored the model's
      // "every Thursday" (October 1 and 8). This read has only that invented rule.
      const [oct1, oct2, oct8, oct9] = await storedBefore(source, [
        { ...salsa, local_date: "2026-10-01" },
        { ...salsa, local_date: "2026-10-02" },
        { ...salsa, local_date: "2026-10-08" },
        { ...salsa, local_date: "2026-10-09" },
      ]);
      const line = await ingest(
        "<p>Salsa Social, October 2, 9pm</p><p>Salsa Social, October 9, 9pm</p>",
        [{ ...salsa, recurrence_text: "every Thursday" }],
      );
      expect(line).toMatchObject({ status: "ok", written: 0, rejected: 1 });
      expect(line.notes[0]).toBe(
        "2 stored listing(s) on nights from a recurrence the page does not write (on no date or weekday it gives) were retired: Salsa Social on 2026-10-01; Salsa Social on 2026-10-08",
      );
      expect(await statusOf(oct2)).toBe("active");
      expect(await statusOf(oct9)).toBe("active");
      expect(await statusOf(oct1)).toBe("removed");
      expect(await statusOf(oct8)).toBe("removed");
    });

    it("keeps a real rule's nights whose wording the check could not match", async () => {
      // "Saturdays, twice a month" names no ordinal, so "every 2nd and 4th Saturday" is dropped;
      // the listing is not written this run, and its stored Saturday is kept.
      const tango = { title: "Tango Night", listing_type: "social", dancing_time: "21:00" };
      const [oct3] = await storedBefore(source, [{ ...tango, local_date: "2026-10-03" }]);
      const line = await ingest("<p>Tango Night</p><p>Saturdays, twice a month, 9pm</p>", [
        { ...tango, recurrence_text: "every 2nd and 4th Saturday" },
      ]);
      expect(line).toMatchObject({ status: "ok", written: 0, rejected: 1 });
      expect(line.notes.join(" ")).not.toMatch(/were retired/);
      expect(await statusOf(oct3)).toBe("active");
    });

    it("leaves its rows out of the rows a read that lists other nights retires", async () => {
      const tango = { title: "Tango Night", listing_type: "social", dancing_time: "21:00" };
      const [oct1, oct3] = await storedBefore(source, [
        { ...tango, local_date: "2026-10-01" },
        { ...tango, local_date: "2026-10-03" },
      ]);
      const line = await ingest(
        "<p>Balboa Night, Friday, October 2, 8pm</p><p>Tango Night</p><p>Saturdays, twice a month, 9pm</p>",
        [
          {
            title: "Balboa Night",
            listing_type: "social",
            local_date: "2026-10-02",
            dancing_time: "20:00",
          },
          { ...tango, recurrence_text: "every 2nd and 4th Saturday" },
        ],
      );
      expect(line).toMatchObject({ status: "ok", written: 1, rejected: 1 });
      // The Saturday the page names beside the title stays; the Thursday it does not goes.
      expect(await statusOf(oct3)).toBe("active");
      expect(await statusOf(oct1)).toBe("removed");
      expect(line.notes.join(" ")).not.toMatch(/Tango Night on 2026-10-03/);
    });
  });
});

// D-080: a dated heading is a night, not a weekly rule; a date counts only beside its own listing;
// a stored night the page's own words contradict goes, whatever the model could read.
describeDb("dates beside their own listing (D-080)", () => {
  let source: Source;

  beforeAll(async () => {
    db = await testDb("grounding_d080");
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
    source = await upsertSource(db, metro.id, {
      url: PAGE,
      kind: "html",
      platform: "probed",
      trustTier: "directory",
      discoveredBy: "seed_list",
    });
  });

  const milonga = (title: string) => ({ title, listing_type: "social", dancing_time: "19:00" });
  const RONDA =
    "<h2>Tuesday, September 29, 2026</h2><p>milonga</p><h3>Los Tres Amigos Milonga</h3><p>7:00 PM</p>" +
    "<h2>Wednesday, September 30, 2026</h2><p>milonga</p><h3>Tango Cafe</h3><p>7:00 PM</p>";

  it("retires the nights a week on that a dated heading's weekday made (The Ronda, run 30)", async () => {
    const [oct6, oct7] = await storedBefore(source, [
      { ...milonga("Los Tres Amigos Milonga"), local_date: "2026-10-06" },
      { ...milonga("Tango Cafe"), local_date: "2026-10-07" },
    ]);
    const line = await ingest(RONDA, [
      {
        ...milonga("Los Tres Amigos Milonga"),
        local_date: "2026-09-29",
        recurrence_text: "every Tuesday",
      },
      { ...milonga("Tango Cafe"), local_date: "2026-09-30", recurrence_text: "every Wednesday" },
    ]);
    expect(line).toMatchObject({ status: "ok", written: 2 });
    expect(line.notes).toContain(
      "2 stored listing(s) on nights from a recurrence the page does not write (on no date or weekday it gives) were retired: Los Tres Amigos Milonga on 2026-10-06; Tango Cafe on 2026-10-07",
    );
    expect(await statusOf(oct6)).toBe("removed");
    expect(await statusOf(oct7)).toBe("removed");
    const active = await db
      .select({ title: events.title, night: events.nightDate })
      .from(events)
      .where(eq(events.status, "active"))
      .orderBy(events.nightDate);
    expect(active).toEqual([
      { title: "Los Tres Amigos Milonga", night: "2026-09-29" },
      { title: "Tango Cafe", night: "2026-09-30" },
    ]);
  });

  const CARDS = (flow: string) =>
    `<p>Class West Coast Swing with Jes Ann Nail Wed, Sep 30 • 7:00 PM Danznik Studios <a href="${PAGE}e/wcs/">Learn More</a> ` +
    `Social Dance Flow Fridays NYC's biggest West Coast Swing social. ${flow} • 8:30 PM Danznik Studios <a href="${PAGE}e/flow-fridays/">Learn More</a> ` +
    `Class West Coast Swing with Swingiversity Fri, Oct 2 • 6:30 PM Danznik Studios <a href="${PAGE}e/swingiversity/">Learn More</a></p>`;
  const flow = {
    title: "Social Dance Flow Fridays",
    listing_type: "social",
    dancing_time: "20:30",
  };
  const jes = {
    title: "Class West Coast Swing with Jes Ann Nail",
    listing_type: "class",
    doors_time: "19:00",
  };

  it("does not list a date written on another card (NYC Swings, run 30)", async () => {
    const line = await ingest(CARDS("Fri, Oct 30"), [
      { ...jes, local_date: "2026-09-30" },
      { ...flow, local_date: "2026-10-02", recurrence_text: "first Friday of the month" },
    ]);
    expect(line.notes).toContain(
      'Social Dance Flow Fridays: dated 2026-10-02, but the page gives it "Fri, Oct 30" beside its title; not listed on that date',
    );
    const rows = await db.select({ title: events.title, night: events.nightDate }).from(events);
    expect(rows).toEqual([{ title: jes.title, night: "2026-09-30" }]);
  });

  it("retires a stored night another card's date kept, on a whole read (D-079's keep)", async () => {
    const [oct2] = await storedBefore(source, [{ ...flow, local_date: "2026-10-02" }]);
    const line = await ingest(CARDS("Fri, Oct 30"), [{ ...jes, local_date: "2026-09-30" }]);
    expect(line.notes).toContain(
      "1 stored listing(s) this page no longer lists were retired: Social Dance Flow Fridays on 2026-10-02",
    );
    expect(await statusOf(oct2)).toBe("removed");
  });

  it("retires a stored night the page dates otherwise though part of the read failed", async () => {
    const [oct2] = await storedBefore(source, [{ ...flow, local_date: "2026-10-02" }]);
    const line = await ingest(
      twoParts(CARDS("Fri, Oct 30"), "More classes every week"),
      [{ ...jes, local_date: "2026-09-30" }],
      "More classes every week",
    );
    expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
    expect(line.notes).toContain(
      "1 stored listing(s) on a night the page contradicts were retired: Social Dance Flow Fridays on 2026-10-02",
    );
    expect(await statusOf(oct2)).toBe("removed");
  });

  it("keeps a stored night the page gives beside the title, and one on a weekday it gives as a rule", async () => {
    const [oct2, oct9] = await storedBefore(source, [
      { ...flow, local_date: "2026-10-02" },
      { ...flow, local_date: "2026-10-09" },
    ]);
    const line = await ingest(
      twoParts(
        `<p>Social Dance Flow Fridays, every Friday. Next: Fri, Oct 2 • 8:30 PM <a href="${PAGE}e/flow-fridays/">Learn More</a></p>`,
        "More classes every week",
      ),
      [{ ...jes, local_date: "2026-09-30" }],
      "More classes every week",
    );
    expect(line.notes.join(" ")).not.toMatch(/were retired/);
    expect(await statusOf(oct2)).toBe("active");
    expect(await statusOf(oct9)).toBe("active");
  });

  it("keeps Frim Fram Jam's night that the first date under its title gives (D-079)", async () => {
    const [oct1] = await storedBefore(source, [
      {
        title: "Frim Fram Jam",
        listing_type: "social",
        dancing_time: "21:00",
        local_date: "2026-10-01",
      },
    ]);
    const html =
      `<p>Frim Fram Jam and its staff consider it a safe place. Please read our <a href="${PAGE}code">Code of Conduct</a> and ensure we foster a welcoming community.</p>` +
      `<p>Up Next at Frim Fram:</p><p>Featured</p><p><a href="${PAGE}calendar/20261001">Oct 1</a></p><p>October 1, 2026</p>` +
      `<p><a href="${PAGE}calendar/20261008">Oct 8- NYLX Warmup w/ DJs TJ Savino</a></p><p>October 8, 2026</p>`;
    const line = await ingest(html, [
      {
        title: "NYLX Warmup w/ DJs TJ Savino",
        listing_type: "social",
        dancing_time: "21:00",
        local_date: "2026-10-08",
      },
    ]);
    expect(line.notes.join(" ")).not.toMatch(/were retired/);
    // Its night stays listed. The part of the page that dates it writes no time, so the stored 9pm
    // gives way to the night with no time (seam review, 2026-09-29).
    expect(await statusOf(oct1)).toBe("removed");
    const listed = (await db.select().from(events)).filter(
      (r) => r.title === "Frim Fram Jam" && r.nightDate === "2026-10-01" && r.status === "active",
    );
    expect(listed.map((r) => r.startsAt)).toEqual([null]);
  });
});
