// This Week in Swing read as empty (D-074), end to end over a real database: an answer cached from
// an empty 304 read no longer comes back, a page whose text was pruned is fetched again and read,
// a whole read that lists nothing retires the rows whose title its page no longer writes (and only
// those), and an empty read of a page full of dates is read again by the stronger model and
// counted in the report. Synthetic pages throughout.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, extractionCache, metros } from "@/src/db/schema";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp, type Transport, type TransportResponse } from "@/src/pipeline/http";
import { formatReport, runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  loadSources,
  pruneRawDocuments,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Monday 2026-09-28, noon in New York: the window runs to Sunday 11 October.
const NOW = new Date("2026-09-28T16:00:00Z");
const TONIGHT = "2026-09-28";
const PAGE = "https://swing.example/";
const venue = { name: "The Studio", address: "37 W 26th St, New York, NY" };

let db: Db;
let metro: Metro;

/** The page: 304 to a conditional request, the whole page to any other; counts the whole ones. */
function site(body: string): Transport & { plain: number } {
  const transport = async (req: Parameters<Transport>[0]): Promise<TransportResponse> => {
    if (req.url.endsWith("/robots.txt")) {
      return { url: req.url, status: 200, headers: {}, body: "User-agent: *\nDisallow:\n" };
    }
    if (req.headers["if-none-match"] === '"v1"') {
      return { url: req.url, status: 304, headers: { etag: '"v1"' }, body: "" };
    }
    transport.plain += 1;
    return { url: req.url, status: 200, headers: { etag: '"v1"' }, body };
  };
  transport.plain = 0;
  return transport;
}

function httpAt(transport: Transport) {
  let t = NOW.getTime();
  return {
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  };
}

/** A model that answers each job with these listings, and counts the calls per job. */
function model(
  byJob: Partial<Record<"extract" | "escalate", Array<Record<string, unknown>>>>,
): AiClient & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    async run(request: { job: { id: string } }) {
      const job = request.job.id as "extract" | "escalate";
      asked.push(job);
      const listings = byJob[job] ?? [];
      return {
        ok: true,
        provider: "cloudflare",
        model: job === "extract" ? "granite" : "gemma",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: listings.length > 0 ? "list" : "not_relevant",
          language: "en",
          listings: listings.map((l) => ({ styles: [], organizer: {}, venue, ...l })),
        }),
      };
    },
  } as unknown as AiClient & { asked: string[] };
}

const ingest = (transport: Transport, client: AiClient) =>
  runIngest({
    db,
    metro,
    env: {},
    only: [PAGE],
    ai: { client, cache: postgresExtractionCache(db) },
    ...httpAt(transport),
  });

/** Rows as an earlier run stored them, one per listing. */
async function storedBefore(source: Source, listings: Array<Record<string, unknown>>) {
  const normalized = listings.map((fields) => {
    const outcome = normalizeListing(
      {
        listing: rawListingSchema.parse({ styles: [], organizer: {}, venue, ...fields }),
        externalId: null,
        tz: null,
        venueLocation: { lat: 40.7443, lng: -73.9903 },
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

const statusOf = async (id: string) =>
  (await db.select({ status: events.status }).from(events).where(eq(events.id, id)))[0]?.status;

const line = (report: Awaited<ReturnType<typeof runIngest>>) =>
  report.sources.find((s) => s.url === PAGE)!;

describeDb("This Week in Swing's empty reads (D-074)", () => {
  beforeAll(async () => {
    db = await testDb("twis");
  });
  afterAll(closeTestDb);

  let source: Source;
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

  it("reads again a page whose 304 answer was cached from no text, and lists its night", async () => {
    const page =
      "<!DOCTYPE html><html><body><h2>Thursday, October 1</h2><h3>Frim Fram Jam</h3><p>9pm to midnight at The Studio</p></body></html>";
    const frimFram = {
      title: "Frim Fram Jam",
      listing_type: "social",
      local_date: "2026-10-01",
      dancing_time: "21:00",
    };
    const transport = site(page);
    await ingest(transport, model({ extract: [frimFram] }));
    const [stored] = (await loadSources(db, metro.id)).filter((s) => s.url === PAGE);

    // Runs 22 to 25: a 304 sent the model no text, and its answer was cached under the page's
    // hash with the prompt version of the day; the page's text was then pruned.
    await db.delete(extractionCache);
    await postgresExtractionCache(db).put(stored!.contentHash!, "2026-09-28.4", {
      extraction: rawExtractionSchema.parse({
        page_kind: "not_relevant",
        language: "en",
        listings: [],
      }),
      model: "@cf/google/gemma-4-26b-a4b-it",
    });
    await pruneRawDocuments(db, new Date(NOW.getTime() + 4 * 86_400_000));
    await db.delete(events);

    const client = model({ extract: [frimFram] });
    const report = await ingest(transport, client);
    // The page is fetched again in full, read, and its night listed.
    expect(transport.plain).toBe(2);
    expect(client.asked).toEqual(["extract"]);
    expect(line(report)).toMatchObject({ status: "ok", written: 1 });
    expect(line(report).notes).not.toContain("the model found no dance events on this page");
  });

  it("retires, after a whole read that lists nothing, the rows whose title the page no longer writes", async () => {
    const page =
      "<html><body><h1>NYLX 2026</h1><p>The New York Lindy Exchange, October 9-11, 2026</p><h2>Balboa Night</h2><p>Friday, October 2, 8pm</p></body></html>";
    const [tonight, invented, balboa] = await storedBefore(source, [
      { title: "Nylon Lindy Hop", listing_type: "class", local_date: TONIGHT, doors_time: "19:00" },
      {
        title: "Nylon Lindy Hop",
        listing_type: "class",
        local_date: "2026-10-01",
        doors_time: "19:00",
      },
      {
        title: "Balboa Night",
        listing_type: "social",
        local_date: "2026-10-02",
        doors_time: "20:00",
      },
    ]);
    const report = await ingest(site(page), model({}));
    expect(line(report)).toMatchObject({ status: "ok", written: 0 });
    expect(line(report).notes).toContain(
      "1 stored listing(s) the page no longer gives on their night were retired: Nylon Lindy Hop on 2026-10-01",
    );
    expect(await statusOf(invented!)).toBe("removed");
    // The page still writes Balboa Night: an empty read is not the page's word on it.
    expect(await statusOf(balboa!)).toBe("active");
    // Tonight is left to the day-of check.
    expect(await statusOf(tonight!)).toBe("active");
  });

  it("reads an empty read of a page full of dates again with the stronger model, and counts it", async () => {
    const nights = [
      ["Tuesday, September 29", "Midtown Swings"],
      ["Wednesday, September 30", "Gotham Jazz"],
      ["Thursday, October 1", "Frim Fram Jam"],
      ["Friday, October 2", "Big Band Swing Concert"],
    ];
    const page = `<html><body>${nights.map(([d, t]) => `<h2>${d}</h2><h3>${t}</h3><p>8pm, The Studio</p>`).join("")}</body></html>`;
    const [gotham] = await storedBefore(source, [
      {
        title: "Gotham Jazz",
        listing_type: "social",
        local_date: "2026-09-30",
        doors_time: "20:00",
      },
    ]);
    const client = model({
      extract: [],
      escalate: [
        {
          title: "Gotham Jazz",
          listing_type: "social",
          local_date: "2026-09-30",
          doors_time: "20:00",
        },
      ],
    });
    const report = await ingest(site(page), client);
    expect(client.asked).toEqual(["extract", "escalate"]);
    expect(report.ai).toMatchObject({ emptySuspect: 1, escalated: 1 });
    expect(line(report).notes).toContain(
      "escalated: the text writes 4 of the window's 14 nights but the read listed none",
    );
    expect(formatReport(report)).toContain("1 empty reads of dated parts escalated");
    expect(await statusOf(gotham!)).toBe("active");

    // The stronger model's answer is cached: the next run asks nothing.
    const again = model({});
    await ingest(site(page), again);
    expect(again.asked).toEqual([]);
  });
});
