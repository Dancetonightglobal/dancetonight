// D-080 on the layouts two reviews of it found (2026-09-29), end to end over a real database: a
// true night is never retired because a menu, a notice, a price or the next card carries a date,
// a card that says "Weekly" keeps its rule, a rule written after the title outlives a date the page
// contradicts (D-078), and a contradicted night goes even when no part of the page could be read.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

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

// Monday 2026-09-28, noon in New York: tonight is Monday 28 September.
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

const venue = { name: "The Factory", address: "144 Allen St, New York, NY" };
const AT = { lat: 40.7206, lng: -73.9897 };

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

/** Every row, as "night title status", by night. */
const rows = async () =>
  (
    await db
      .select({ title: events.title, night: events.nightDate, status: events.status })
      .from(events)
      .orderBy(events.nightDate, events.title)
  ).map((r) => `${r.night} ${r.title} ${r.status}`);

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

/** Text only the second part of `twoParts` holds: failing on it leaves that part unread. */
const UNREAD = "More classes every week";

/** A page of two parts; a model failing on `UNREAD` reads only the first. */
const twoParts = (a: string, b: string) =>
  `<html><body><h2>Part A</h2><p>${"a ".repeat(1_800)}</p>${a}<h2>Part B</h2><p>${"b ".repeat(1_800)}</p>${b}<p>${UNREAD}</p></body></html>`;

const page = (body: string) => `<html><body>${body}</body></html>`;

describeDb("D-080 on the layouts its reviews found", () => {
  let source: Source;

  beforeAll(async () => {
    db = await testDb("dates_critic");
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

  // A studio's menu (not in <nav>, so the cleaner keeps it) names the weekly social; a notice
  // under the menu carries an unrelated date; the social's own card writes no date.
  const MENU =
    `<div class="menu"><ul><li><a href="${PAGE}">Home</a></li><li><a href="${PAGE}salsa">Salsa Mondays</a></li><li><a href="${PAGE}about">About us</a></li></ul></div>` +
    `<p>Our new sprung floor is in! Renovations finished September 15 - come and see it.</p>`;
  const SALSA_CARD = `<h3>Salsa Mondays</h3><p>Beginner lesson at 8pm, then social dancing until midnight. $15 at the door.</p>`;
  const BACHATA_CARD = `<h3>Bachata Wednesdays</h3><p>Every Wednesday, 8pm to 11pm.</p>`;
  const salsa = { title: "Salsa Mondays", listing_type: "social", dancing_time: "20:00" };
  const bachata = { title: "Bachata Wednesdays", listing_type: "social", dancing_time: "20:00" };

  it("keeps a weekly night on a partial read when a menu names the title above a dated notice", async () => {
    const [tonight, oct5] = await storedBefore(source, [
      { ...salsa, local_date: "2026-09-28" },
      { ...salsa, local_date: "2026-10-05" },
    ]);
    const line = await ingest(
      twoParts(MENU + BACHATA_CARD, SALSA_CARD),
      [{ ...bachata, recurrence_text: "every Wednesday" }],
      UNREAD,
    );
    expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
    expect(await statusOf(tonight)).toBe("active");
    expect(await statusOf(oct5)).toBe("active");
  });

  it("lists a weekly social on the night the model gives when a notice further down carries a date", async () => {
    await storedBefore(source, [{ ...salsa, local_date: "2026-09-28" }]);
    const line = await ingest(page(MENU + SALSA_CARD + BACHATA_CARD), [
      { ...salsa, local_date: "2026-09-28" },
      { ...bachata, recurrence_text: "every Wednesday" },
    ]);
    expect(line.notes.join("\n")).not.toMatch(/September 15/);
    expect(await rows()).toContain("2026-09-28 Salsa Mondays active");
  });

  // Stepping Out's Tango Y Te block, with one dated sentence in its description.
  const STEPPING =
    `<h3>Tango Y Te</h3><p>Date: Every Sunday - Time: 3:00pm – 6:00 pm</p><p>Description: Join host Maria Jose Sosa to practice your Tango steps.</p><p>$15 For Everyone. No practica on October 11 (studio closed for the holiday weekend).</p>` +
    `<h3>Ballroom and Smooth Practice</h3><p>Date: Every Tuesday</p><p>Time: 9:30pm-10:30pm</p>`;
  const tango = { title: "Tango Y Te", listing_type: "social", dancing_time: "15:00" };
  const ballroom = {
    title: "Ballroom and Smooth Practice",
    listing_type: "social",
    dancing_time: "21:30",
  };

  it("lists Tango Y Te by its rule when a dated sentence stands in its description (D-078)", async () => {
    const [oct4] = await storedBefore(source, [
      { ...tango, local_date: "2026-10-04" },
      { ...tango, local_date: "2026-10-11" },
    ]);
    const line = await ingest(page(STEPPING), [
      { ...tango, local_date: "2026-09-28" },
      { ...ballroom, recurrence_text: "Every Tuesday" },
    ]);
    expect(line.notes).toContain(
      "Tango Y Te: dated 2026-09-28, a Monday, but the page gives Sunday beside it; not listed on that date",
    );
    expect(await statusOf(oct4)).toBe("active");
    expect(await rows()).toContain("2026-10-04 Tango Y Te active");
  });

  // NYC Swings' own card for a weekly party: "Weekly", and only the next date.
  const MIDTOWN = `<p>Social Dance Midtown Swings – Weekly Swing Dance Party Weekly social dance hosted by Gaby &amp; AJ featuring rotating DJs. Tue, Sep 29 • 9:00 PM Danznik Studios <a href="${PAGE}e/midtown/">Learn More</a></p>`;
  const midtown = {
    title: "Midtown Swings – Weekly Swing Dance Party",
    listing_type: "social",
    dancing_time: "21:00",
  };

  it("keeps a weekly party's next week on a partial read when its card prints only the next date", async () => {
    const [sep29, oct6] = await storedBefore(source, [
      { ...midtown, local_date: "2026-09-29" },
      { ...midtown, local_date: "2026-10-06" },
    ]);
    const line = await ingest(
      twoParts(MIDTOWN, "<p>Classes for every level.</p>"),
      [{ ...midtown, local_date: "2026-09-29", recurrence_text: "every Tuesday" }],
      UNREAD,
    );
    expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
    expect(await statusOf(sep29)).toBe("active");
    expect(await statusOf(oct6)).toBe("active");
  });

  it("keeps the model's weekly rule for a card that says Weekly", async () => {
    const line = await ingest(page(MIDTOWN), [
      { ...midtown, local_date: "2026-09-29", recurrence_text: "every Tuesday" },
    ]);
    expect(line.notes.join("\n")).not.toMatch(/does not write "every Tuesday"/);
    expect(await rows()).toEqual(
      expect.arrayContaining([
        "2026-09-29 Midtown Swings – Weekly Swing Dance Party active",
        "2026-10-06 Midtown Swings – Weekly Swing Dance Party active",
      ]),
    );
  });

  it("keeps an after-midnight party on a partial read when its card prints its calendar date", async () => {
    const kizomba = { title: "Late Night Kizomba", listing_type: "social", dancing_time: "00:30" };
    const [stored] = await storedBefore(source, [{ ...kizomba, local_date: "2026-10-03" }]);
    const line = await ingest(
      twoParts(
        BACHATA_CARD,
        `<p>Late Night Kizomba Sat, Oct 3 • 12:30 AM The Loft <a href="${PAGE}e/kiz/">Learn More</a></p>`,
      ),
      [{ ...bachata, recurrence_text: "every Wednesday" }],
      UNREAD,
    );
    expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
    expect(await statusOf(stored)).toBe("active");
  });

  it("keeps a weekly social on a partial read when its card offers 1/2 price drinks", async () => {
    const [tonight, oct5] = await storedBefore(source, [
      { ...salsa, local_date: "2026-09-28" },
      { ...salsa, local_date: "2026-10-05" },
    ]);
    const card = `<h3>Salsa Mondays</h3><p>Beginner lesson at 8pm, social dancing until midnight. 1/2 price drinks until 10pm!</p>`;
    const line = await ingest(
      twoParts(BACHATA_CARD, card),
      [{ ...bachata, recurrence_text: "every Wednesday" }],
      UNREAD,
    );
    expect(line.notes.join("\n")).not.toMatch(/contradicts/);
    expect(await statusOf(tonight)).toBe("active");
    expect(await statusOf(oct5)).toBe("active");
  });

  // The Events Calendar's list view prints each date and time above its title.
  const tec = (day: string, weekday: string, date: string, title: string, slug: string) =>
    `<div class="tribe-events-calendar-list__event-row">` +
    `<div class="tribe-events-calendar-list__event-date-tag"><time><span>${weekday}</span> <span>${day}</span></time></div>` +
    `<article><header><div><time><span>${date} @ 8:00 pm</span> - <span>11:00 pm</span></time></div>` +
    `<h3><a href="${PAGE}event/${slug}/">${title}</a></h3>` +
    `<address><span>Studio 54th</span> <span>250 W 54th St, New York</span></address></header>` +
    `<div><p>Beginner lesson at 8, then social dancing until late.</p></div></article></div>`;
  const TEC =
    `<main><h2>Upcoming Events</h2>` +
    tec("28", "Mon", "September 28", "Monday Salsa Social", "mss") +
    tec("30", "Wed", "September 30", "Bachata Wednesday", "bw") +
    tec("2", "Fri", "October 2", "Kizomba Friday", "kf") +
    `</main>`;
  const tecListings = [
    { title: "Monday Salsa Social", local_date: "2026-09-28" },
    { title: "Bachata Wednesday", local_date: "2026-09-30" },
    { title: "Kizomba Friday", local_date: "2026-10-02" },
  ].map((l) => ({ ...l, listing_type: "social", dancing_time: "20:00" }));

  it("keeps tonight's true row on a list that prints each date above its title", async () => {
    const [tonight, sep30] = await storedBefore(source, tecListings.slice(0, 2));
    const line = await ingest(page(TEC), tecListings);
    expect(line).toMatchObject({ status: "ok", written: 3, rejected: 0 });
    expect(await statusOf(tonight)).toBe("active");
    expect(await statusOf(sep30)).toBe("active");
  });

  it("keeps tonight's true row on a partial read of a list that prints each date above its title", async () => {
    const [tonight, sep30] = await storedBefore(source, tecListings.slice(0, 2));
    const line = await ingest(
      twoParts(TEC, "<p>Private lessons on request.</p>"),
      tecListings.slice(2),
      UNREAD,
    );
    expect(line.notes.some((n) => /could not be read/.test(n))).toBe(true);
    expect(await statusOf(tonight)).toBe("active");
    expect(await statusOf(sep30)).toBe("active");
  });

  const CARDS =
    `<p>Class West Coast Swing with Jes Ann Nail Wed, Sep 30 • 7:00 PM Danznik Studios <a href="${PAGE}e/wcs/">Learn More</a> ` +
    `Social Dance Flow Fridays NYC's biggest West Coast Swing social. Fri, Oct 30 • 8:30 PM Danznik Studios <a href="${PAGE}e/flow-fridays/">Learn More</a> ` +
    `Class West Coast Swing with Swingiversity Fri, Oct 2 • 6:30 PM Danznik Studios <a href="${PAGE}e/swingiversity/">Learn More</a></p>`;

  it("retires a stored night the page dates otherwise though no part could be read", async () => {
    const flow = { title: "Social Dance Flow Fridays", listing_type: "social" };
    const [oct2] = await storedBefore(source, [
      { ...flow, local_date: "2026-10-02", dancing_time: "20:30" },
    ]);
    // Every part of the page holds "Danznik": the model reads none of it.
    const line = await ingest(page(CARDS), [], "Danznik");
    expect(line.status).toBe("failed");
    expect(line.notes).toContain(
      "1 stored listing(s) on a night the page contradicts were retired: Social Dance Flow Fridays on 2026-10-02",
    );
    expect(await statusOf(oct2)).toBe("removed");
  });
});
