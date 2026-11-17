// D-524: fixed weekly night from a page line, with an end-to-end ingest test.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawExtractionSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { createPoliteHttp, fixtureTransport } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-11-02, 11am New York.
const NOW = new Date("2026-11-02T16:00:00Z");
const URL_ = "https://thetrestleinn.com/";
const venue = { name: "The Trestle Inn", address: "339 N 11th St, Philadelphia, PA 19107" };

const HTML_WITH_LINE = `<html><body><h1>The Trestle Inn</h1><p>Join us Thursday, Friday and Saturday nights for dance parties featuring all vinyl DJs and Philly's only troupe of go-go dancers.</p><p>Open Thursday-Saturday 5pm-2am</p></body></html>`;
const HTML_WITHOUT_LINE = `<html><body><h1>The Trestle Inn</h1><p>Closed for renovation.</p></body></html>`;

/** A model that answers each job with its read, and records which jobs were asked. */
function model(reads: Partial<Record<"extract", Array<Record<string, unknown>>>>) {
  const asked: string[] = [];
  const client = {
    async run(request: { job: { id: string } }) {
      const job = request.job.id as "extract";
      asked.push(job);
      const listings = reads[job];
      if (!listings) throw new Error(`model called for ${job}`);
      return {
        ok: true,
        provider: "cloudflare",
        model: "granite",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: listings.map((l) => ({
            listing_type: "social",
            styles: ["disco"],
            organizer: {},
            venue,
            ...l,
          })),
        }),
      };
    },
  } as unknown as AiClient;
  return { client, asked };
}

let db: Db;
let metro: Metro;

async function ingest(source: Source, client: AiClient, html = HTML_WITH_LINE) {
  let t = NOW.getTime();
  const report = await runIngest({
    db,
    metro,
    env: {},
    only: [source.url],
    ai: { client, cache: postgresExtractionCache(db) },
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport([
        {
          request: { method: "GET", url: `${new URL(source.url).origin}/robots.txt` },
          response: {
            url: `${new URL(source.url).origin}/robots.txt`,
            status: 200,
            headers: {},
            body: "User-agent: *\nDisallow:\n",
          },
        },
        {
          request: { method: "GET", url: source.url },
          response: { url: source.url, status: 200, headers: {}, body: html },
        },
      ]),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
  return report.sources.find((s) => s.url === source.url)!;
}

describeDb("fixedNights ingest (D-524)", () => {
  beforeAll(async () => {
    db = await testDb("fixed_nights_ingest");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "philadelphia",
      name: "Philadelphia",
      countryCode: "US",
      center: { lat: 39.9526, lng: -75.1652 },
      radiusKm: 30,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "philadelphia"))!;
  });

  it("lists the page line's weekly night and drops the replaced read", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["dj_night", "disco", "retro"],
      mixedCalendar: true,
    });

    const read = model({
      extract: [
        {
          title: "The Trestle Inn",
          local_date: "2026-11-06",
          dancing_time: "22:00",
        },
      ],
    });
    const report = await ingest(source, read.client);
    expect(read.asked).toEqual(["extract"]);

    // Should have rows titled "Trestle Inn Dance Party" for nights 2026-11-05 (Thursday), 2026-11-06 (Friday), 2026-11-07 (Saturday)
    const rows = await db.select().from(events).where(eq(events.title, "Trestle Inn Dance Party"));
    // The two-week window from Monday 11-02: Thu-Sat twice.
    const nights = rows.map((r) => r.nightDate).sort();
    expect(nights).toEqual([
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-12",
      "2026-11-13",
      "2026-11-14",
    ]);

    // The Friday row should start at 21:00 (9pm)
    const fridayRow = rows.find((r) => r.nightDate === "2026-11-06");
    // 21:00 in New York on 2026-11-06 (EST, after DST ended 11-01) is 02:00Z on 11-07.
    expect(fridayRow?.startsAt?.toISOString()).toBe("2026-11-07T02:00:00.000Z");

    // No row titled "The Trestle Inn"
    const replacedRows = await db.select().from(events).where(eq(events.title, "The Trestle Inn"));
    expect(replacedRows).toHaveLength(0);

    // Notes contain "fixed weekly night"
    expect(report.notes.join(" ")).toContain("fixed weekly night");
  });

  it("lists nothing when the page no longer writes the line", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["dj_night", "disco", "retro"],
      mixedCalendar: true,
    });

    const read = model({ extract: [] });
    const report = await ingest(source, read.client, HTML_WITHOUT_LINE);
    expect(read.asked).toEqual(["extract"]);

    // No fixed night row
    const rows = await db.select().from(events).where(eq(events.title, "Trestle Inn Dance Party"));
    expect(rows).toHaveLength(0);

    // Notes contain "no longer writes"
    expect(report.notes.join(" ")).toContain("no longer writes");
  });

  it("lists Ascend from a footer line that page cleaning drops (raw page, D-531)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: "https://www.tavernoncamac.com/schedule",
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["dj_night", "queer_party"],
      mixedCalendar: true,
    });
    const html = `<html><body><main><h1>Piano Bar Entertainment Schedule</h1><p>Monday: John Flynn 5 pm to 9 pm</p></main>
<footer><p><span class="wixui-rich-text__text">Ascend Lounge:</span></p><p><span>Tuesday - Thursday 9-2</span></p>
<p>&#8203;DJ 9pm -2 am</p></footer></body></html>`;
    const read = model({ extract: [{ title: "Ascend Lounge", local_date: "2026-11-03" }] });
    const report = await ingest(source, read.client, html);
    const rows = await db.select().from(events).where(eq(events.title, "Ascend Lounge DJ"));
    // The two-week window from Monday 11-02: Tue-Thu twice.
    expect(rows.map((r) => r.nightDate).sort()).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ]);
    const replaced = await db.select().from(events).where(eq(events.title, "Ascend Lounge"));
    expect(replaced).toHaveLength(0);
    expect(report.notes.join(" ")).toContain("fixed weekly night");
  });
  // D-801: a page probed to its JSON-LD (or any reader) still lists its seed's fixed weekly nights.
  const JSONLD_EVENT = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Event",
    name: "Trestle Halloween Hangover",
    startDate: "2026-11-09T21:00:00-05:00",
    location: { "@type": "Place", name: venue.name, address: venue.address },
  })}</script>`;
  const HTML_JSONLD = HTML_WITH_LINE.replace("</body>", `${JSONLD_EVENT}</body>`);
  const TRESTLE_NIGHTS = [
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-12",
    "2026-11-13",
    "2026-11-14",
  ];

  it("lists the fixed nights when the page is read through its JSON-LD (D-801)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "jsonld",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["dj_night", "disco", "retro"],
      mixedCalendar: true,
    });
    const read = model({});
    const report = await ingest(source, read.client, HTML_JSONLD);
    expect(read.asked).toEqual([]);
    const rows = await db.select().from(events).where(eq(events.title, "Trestle Inn Dance Party"));
    expect(rows.map((r) => r.nightDate).sort()).toEqual(TRESTLE_NIGHTS);
    const own = await db
      .select()
      .from(events)
      .where(eq(events.title, "Trestle Halloween Hangover"));
    expect(own).toHaveLength(1);
    expect(report.notes.join(" ")).toContain("fixed weekly night");
  });

  it("lists the fixed nights on the run that first probes the page to its JSON-LD (D-801)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["dj_night", "disco", "retro"],
      mixedCalendar: true,
    });
    const read = model({});
    const report = await ingest(source, read.client, HTML_JSONLD);
    expect(report.notes.join(" ")).toContain("probed: schema.org events in the page");
    expect(read.asked).toEqual([]);
    const rows = await db.select().from(events).where(eq(events.title, "Trestle Inn Dance Party"));
    expect(rows.map((r) => r.nightDate).sort()).toEqual(TRESTLE_NIGHTS);
  });
});
