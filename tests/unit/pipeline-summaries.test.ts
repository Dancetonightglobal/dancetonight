// Summaries end to end over a real database (PLAN 8.3, D-109): written once per set of facts,
// shared by a weekly night's listings, kept while the facts stand, refused when they name what the
// facts do not, and never asked of a mock client.
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, fieldProvenance, metros } from "@/src/db/schema";
import { rawExtractionSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { runIngest } from "@/src/pipeline/ingest";
import { loadMetro, upsertSource } from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Sunday 2026-10-04, noon in New York.
const NOW = new Date("2026-10-04T16:00:00Z");
const URL_ = "https://studio.example/events";
const venue = { name: "Studio", address: "37 W 26th St, New York, NY" };

const page = (price: number) => `<html><body><h2>Upcoming socials</h2>
<h3>Salsa Night</h3><p>Friday October 9, 9pm to 1am</p><p>Admission: $${price}</p>
<h3>Salsa Night</h3><p>Friday October 16, 9pm to 1am</p><p>Admission: $${price}</p>
<h3>Tango Social</h3><p>Saturday October 10, 8pm to midnight</p><p>$25 at the door</p>
</body></html>`;

const read = (price: number) =>
  [
    { title: "Salsa Night", local_date: "2026-10-09", dancing_time: "21:00", end_time: "01:00" },
    { title: "Salsa Night", local_date: "2026-10-16", dancing_time: "21:00", end_time: "01:00" },
    {
      title: "Tango Social",
      local_date: "2026-10-10",
      dancing_time: "20:00",
      end_time: "00:00",
      styles: ["tango"],
      prices: [{ label: "door", amount: 25, currency: "USD" }],
    },
  ].map((l) =>
    l.title === "Salsa Night"
      ? { ...l, prices: [{ label: "Admission", amount: price, currency: "USD" }] }
      : l,
  );

let db: Db;
let metro: Metro;

const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
});

/** A model: extraction from `listings`, and a summary from `write(facts)`. */
function model(
  listings: Array<Record<string, unknown>>,
  write: (user: string) => string,
  mock = false,
) {
  const asked: string[] = [];
  const client = {
    mock,
    async run(request: { job: { id: string }; user: string }) {
      asked.push(request.job.id);
      const usage = { inputTokens: 500, outputTokens: 80, cost: 1, unit: "request" };
      if (request.job.id === "summarise") {
        return {
          ok: true,
          provider: "gemini",
          model: "flash-lite",
          usage,
          value: { summary: write(request.user) },
        };
      }
      return {
        ok: true,
        provider: "cloudflare",
        model: "granite",
        usage,
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

const writer = (user: string) =>
  user.includes("Tango Social")
    ? "Tango Social is a Saturday tango social at La Boca. It runs from 8pm to 12am."
    : `Salsa Night is a Friday salsa social. Dancing runs from 9pm to 1am, and admission is $${/\$(\d+)/.exec(user)![1]}.`;

async function ingest(source: Source, client: AiClient, html: string) {
  let t = NOW.getTime();
  return runIngest({
    db,
    metro,
    env: {},
    only: [source.url],
    ai: { client, cache: postgresExtractionCache(db), summarize: true },
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
}

const summaries = async () =>
  Object.fromEntries(
    (await db.select().from(events).where(eq(events.status, "active"))).map((r) => [
      `${r.title} ${r.nightDate}`,
      r.summary,
    ]),
  );

describeDb("summaries on the write path (D-109)", () => {
  beforeAll(async () => {
    db = await testDb("summaries_rows");
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

  it("writes, shares, keeps, refuses and rewrites as the facts say", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });

    // Run 1: one call for both Salsa nights, one refused for Tango Social's invented venue.
    const one = model(read(15), writer);
    const r1 = await ingest(source, one.client, page(15));
    expect(one.asked.filter((j) => j === "summarise")).toHaveLength(2);
    expect(r1.summaries).toMatchObject({ written: 1, reused: 1, cleared: 0, left: 0, calls: 2 });
    expect(r1.summaries.refused).toEqual(['Tango Social on 2026-10-10 (name "La")']);
    const salsa15 =
      "Salsa Night is a Friday salsa social. Dancing runs from 9pm to 1am, and admission is $15.";
    expect(await summaries()).toEqual({
      "Salsa Night 2026-10-09": salsa15,
      "Salsa Night 2026-10-16": salsa15,
      "Tango Social 2026-10-10": null,
    });
    const [prov] = await db
      .select()
      .from(fieldProvenance)
      .where(and(eq(fieldProvenance.field, "summary"), eq(fieldProvenance.isCurrent, true)));
    expect(prov).toMatchObject({ method: "llm", model: "flash-lite", sourceId: null });

    // Run 2, nothing changed: no summary is asked, the refusal included.
    const two = model(read(15), writer);
    const r2 = await ingest(source, two.client, page(15));
    expect(two.asked).not.toContain("summarise");
    expect(r2.summaries.calls).toBe(0);

    // Run 3, the price changed: one new call serves both nights.
    const three = model(read(18), writer);
    const r3 = await ingest(source, three.client, page(18));
    expect(r3.summaries).toMatchObject({ written: 1, reused: 1, calls: 1 });
    expect((await summaries())["Salsa Night 2026-10-16"]).toContain("$18");
  });

  it("clears a summary whose facts changed when no new one can be written", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    await ingest(source, model(read(15), writer).client, page(15));
    const quota = model(read(18), writer);
    const run = quota.client.run.bind(quota.client);
    (quota.client as { run: unknown }).run = async (request: { job: { id: string } }) =>
      request.job.id === "summarise"
        ? { ok: false, reason: "quota_exhausted", provider: null, detail: "spent" }
        : run(request as never, { metro: "nyc" });
    const r = await ingest(source, quota.client, page(18));
    expect(r.summaries).toMatchObject({ written: 0, cleared: 2, left: 2, calls: 1 });
    expect((await summaries())["Salsa Night 2026-10-09"]).toBeNull();
  });

  it("asks nothing of a mock client", async () => {
    const source = await upsertSource(db, metro.id, {
      url: URL_,
      kind: "html",
      platform: "probed",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
    const mock = model(read(15), writer, true);
    const r = await ingest(source, mock.client, page(15));
    expect(mock.asked).not.toContain("summarise");
    expect(r.summaries.calls).toBe(0);
  });
});
