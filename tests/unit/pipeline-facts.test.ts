// D-100 and D-101 end to end over a real database: a read's prices and age are stored as its own
// part of the page writes them, with the page's clause as evidence; a cached read that dropped a
// fact is re-read once by the stronger model, and never again.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, metros, organizers } from "@/src/db/schema";
import { rawExtractionSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro, upsertSource, withdrawUnwrittenFacts } from "@/src/pipeline/store";
import { cleanPageText } from "@/src/pipeline/clean";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Sunday 2026-10-04, noon in New York.
const NOW = new Date("2026-10-04T16:00:00Z");
const URL_ = "https://studio.example/events";
const venue = { name: "Studio", address: "37 W 26th St, New York, NY" };

const HTML = `<html><body><h2>Upcoming socials</h2>
<h3>Salsa Night</h3><p>Friday October 9, 9pm to 1am</p><p>Admission: $15 / Students $10</p>
<h3>Tango Social</h3><p>Saturday October 10, 8pm to midnight</p><p>$25 at the door</p><p>21+</p>
</body></html>`;

/** A read as the base model gave it: Tango Social's $25 and 21+ given to Salsa Night too. */
const slipped = [
  {
    title: "Salsa Night",
    local_date: "2026-10-09",
    dancing_time: "21:00",
    prices: [
      { label: "Admission", amount: 15, currency: "USD" },
      { label: "door", amount: 25, currency: "USD" },
    ],
    age_min: 21,
    evidence: { prices: "$25 at the door", age_min: "21+" },
  },
  {
    title: "Tango Social",
    local_date: "2026-10-10",
    dancing_time: "20:00",
    prices: [{ label: "door", amount: 25, currency: "USD" }],
    age_min: 21,
  },
];
/** The stronger model's read of the same page. */
const right = [
  { ...slipped[0]!, prices: [{ label: "Admission", amount: 15, currency: "USD" }], age_min: null },
  slipped[1]!,
];

let db: Db;
let metro: Metro;

const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
});

/** A model that answers each job with its read, and records which jobs were asked. */
function model(reads: Partial<Record<"extract" | "escalate", Array<Record<string, unknown>>>>) {
  const asked: string[] = [];
  const client = {
    async run(request: { job: { id: string } }) {
      const job = request.job.id as "extract" | "escalate";
      asked.push(job);
      const listings = reads[job];
      if (!listings) throw new Error(`model called for ${job}`);
      return {
        ok: true,
        provider: "cloudflare",
        model: job === "extract" ? "granite" : "gemma",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: listings.map((l) => ({
            listing_type: "social",
            styles: ["salsa"],
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

async function ingest(source: Source, client: AiClient, html = HTML) {
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
        ok("https://studio.example/robots.txt", "User-agent: *\nDisallow:\n"),
        ok(source.url, html),
      ]),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
  return report.sources.find((s) => s.url === source.url)!;
}

const salsa = async () => {
  const rows = await db.select().from(events).where(eq(events.title, "Salsa Night"));
  return rows.find((r) => r.status === "active")!;
};
const provenance = async (id: string, field: string) =>
  db
    .select()
    .from(fieldProvenance)
    .where(and(eq(fieldProvenance.entityId, id), eq(fieldProvenance.field, field)));

describeDb("a listing's facts on the write path (D-100, D-101)", () => {
  beforeAll(async () => {
    db = await testDb("facts_rows");
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

  it("stores only the facts the part writes, re-reads once, and never again", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });

    // Run 1, a fresh read: the neighbour's $25 and 21+ are not stored; the page's clause is.
    const first = model({ extract: slipped });
    const one = await ingest(source, first.client);
    expect(first.asked).toEqual(["extract"]);
    let row = await salsa();
    expect(row.prices.map((p) => [p.amount, p.label])).toEqual([[15, "Admission"]]);
    expect(row.ageMin).toBeNull();
    expect((await provenance(row.id, "prices")).find((p) => p.isCurrent)?.evidence).toBe(
      "Admission: $15",
    );
    expect(one.notes.join("\n")).toMatch(/Salsa Night \(\$25 door, 21\+\)/);

    // Run 2, the page unchanged: the cached read still drops facts, so it is read once more by
    // the stronger model.
    const second = model({ escalate: right });
    const two = await ingest(source, second.client);
    expect(second.asked).toEqual(["escalate"]);
    expect(two.notes.join("\n")).toMatch(/re-read by the stronger model/);
    row = await salsa();
    expect(row.prices.map((p) => [p.amount, p.label])).toEqual([[15, "Admission"]]);

    // Run 3: the re-read answer is served from the cache, and no model is called.
    const third = model({});
    await ingest(source, third.client);
    expect(third.asked).toEqual([]);
  });

  it("erases a stored organiser the page writes only in a neighbour's part (D-105)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const host = (l: Record<string, unknown>) => ({ ...l, organizer: { name: "Ana Ruiz" } });
    // Run 1: the page names Ana Ruiz above every listing, so the read's organiser stands.
    const before = HTML.replace("<h2>", "<p>Hosted by Ana Ruiz</p><h2>");
    await ingest(source, model({ extract: right.map(host) }).client, before);
    const organizerOf = async () => {
      const row = await salsa();
      if (!row.organizerId) return null;
      const [o] = await db.select().from(organizers).where(eq(organizers.id, row.organizerId));
      return o!.name;
    };
    expect(await organizerOf()).toBe("Ana Ruiz");

    // Run 2: she is now written only in Tango Social's part; the read still gives her to Salsa.
    const after = HTML.replace("<p>21+</p>", "<p>21+</p><p>Your host: Ana Ruiz</p>");
    const two = await ingest(source, model({ extract: right.map(host) }).client, after);
    expect(await organizerOf()).toBeNull();
    expect(two.notes.join("\n")).toMatch(/Salsa Night \(Ana Ruiz\)/);
    const tango = (await db.select().from(events).where(eq(events.title, "Tango Social")))[0]!;
    expect(tango.organizerId).not.toBeNull();
  });

  it("stores a read's style only where the page names its family or the source is of it (D-107)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
      styles: ["lindy_hop"],
    });
    const read = model({
      extract: [
        { ...right[0]!, styles: ["salsa", "lindy_hop"] },
        { ...right[1]!, styles: ["tango", "kizomba"] },
      ],
    });
    const report = await ingest(source, read.client);
    const rows = await db.select().from(events);
    const active = (title: string) => rows.find((r) => r.title === title && r.status === "active")!;
    expect(active("Salsa Night").styles).toEqual(["salsa", "lindy_hop"]);
    expect(active("Tango Social").styles).toEqual(["tango"]);
    expect(report.notes.join("\n")).toContain("Tango Social (kizomba)");
  });

  it("withdraws a stored row's facts its part no longer writes when the read does not list it (D-108)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    // Run 1: Salsa Night's part writes 21+ and its dress code, and the read gives both.
    const before = HTML.replace(
      "<p>Admission: $15 / Students $10</p>",
      "<p>Admission: $15 / Students $10</p><p>21+ only. Dress code: casual</p>",
    );
    const salsaRead = { ...right[0]!, age_min: 21, dress_code: "casual" };
    await ingest(source, model({ extract: [salsaRead, right[1]!] }).client, before);
    let row = await salsa();
    expect(row.ageMin).toBe(21);
    expect(row.dressCode).toBe("casual");

    // Run 2: the page no longer writes either, and the read lists only Tango Social.
    const two = await ingest(source, model({ extract: [right[1]!] }).client, HTML);
    row = await salsa();
    expect(row.ageMin).toBeNull();
    expect(row.dressCode).toBeNull();
    expect(row.prices.map((p) => [p.amount, p.label])).toEqual([[15, "Admission"]]);
    expect((await provenance(row.id, "age_min")).some((p) => p.isCurrent)).toBe(false);
    expect((await provenance(row.id, "prices")).some((p) => p.isCurrent)).toBe(true);
    expect(two.notes.join("\n")).toMatch(
      /stored listing\(s\) the read did not list held facts .*Salsa Night on 2026-10-09 \(21\+/,
    );
  });

  it("leaves a listed row, a row the page no longer titles and another source's row alone (D-108)", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const before = HTML.replace(
      "<p>Admission: $15 / Students $10</p>",
      "<p>Admission: $15 / Students $10</p><p>21+ only</p>",
    );
    await ingest(
      source,
      model({ extract: [{ ...right[0]!, age_min: 21 }, right[1]!] }).client,
      before,
    );
    const row = await salsa();
    const text = cleanPageText(HTML, URL_);
    const titles = ["Salsa Night", "Tango Social"];
    const call = (listedIds: string[], page = text) =>
      withdrawUnwrittenFacts(db, { source, listedIds, nights: ["2026-10-09"], text: page, titles });
    const age = async () => (await salsa()).ageMin;

    // Listed by id.
    expect(await call([row.id])).toEqual([]);
    // Listed by title and night: another row of the same night and title.
    const [copy] = await db
      .insert(events)
      .values({ ...row, id: undefined, slug: `${row.slug}-copy`, status: "removed" })
      .returning({ id: events.id });
    expect(await call([copy!.id])).toEqual([]);
    await db.delete(events).where(eq(events.id, copy!.id));
    // The page no longer writes its title.
    expect(await call([], text.replace("Salsa Night", "Mambo Night"))).toEqual([]);
    // Another source lists it too.
    await db
      .update(events)
      .set({ sourceIds: [...row.sourceIds, "00000000-0000-4000-8000-000000000001"] })
      .where(eq(events.id, row.id));
    expect(await call([])).toEqual([]);
    expect(await age()).toBe(21);
    await db.update(events).set({ sourceIds: row.sourceIds }).where(eq(events.id, row.id));
    // A structured reader stored it, not this page's model read.
    await db
      .update(fieldProvenance)
      .set({ method: "jsonld" })
      .where(and(eq(fieldProvenance.entityId, row.id), eq(fieldProvenance.field, "age_min")));
    expect(await call([])).toEqual([]);
    expect(await age()).toBe(21);
    await db
      .update(fieldProvenance)
      .set({ method: "llm" })
      .where(and(eq(fieldProvenance.entityId, row.id), eq(fieldProvenance.field, "age_min")));
    // Only this source, and its model read: withdrawn.
    expect((await call([])).join("\n")).toMatch(/Salsa Night on 2026-10-09 \(21\+\)/);
    expect(await age()).toBeNull();
  });
});
