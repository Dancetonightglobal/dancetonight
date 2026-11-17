// This Week in Swing read as empty (D-074): the extraction cache held answers to empty pages, a
// dense page's parts ran past the call limit or lost their date headings, and an empty read of a
// page full of dates was taken at its word. Synthetic page text throughout, in the shapes the
// saved pages print; the saved pages themselves calibrate the checks in text-facts-twis.test.ts.

import { describe, expect, it } from "vitest";

import type { AiClient, AiFailure } from "@/src/ai";
import { rawExtractionSchema, type RawExtraction } from "@/src/domain/listing";
import {
  CARRIED_HEADING_NOTE,
  EXTRACT_PROMPT_VERSION,
  extractPage,
  extractPageInChunks,
  extractionToHarvested,
  splitPageText,
  textKey,
  type CachedExtraction,
  type ExtractionCache,
} from "@/src/pipeline/extract";

const TODAY = "2026-09-29";

function extraction(titles: string[], kind: RawExtraction["page_kind"] = "list") {
  return rawExtractionSchema.parse({
    page_kind: kind,
    language: "en",
    listings: titles.map((title) => ({
      title,
      listing_type: "social",
      styles: ["lindy_hop"],
      local_date: "2026-10-01",
      doors_time: "20:00",
      venue: { name: "The Studio" },
      organizer: {},
      evidence: { title },
      confidence: { title: 0.9 },
    })),
  });
}

type Reply = RawExtraction | AiFailure;

/** A client that answers each job from a queue and records the jobs and page texts it was sent. */
function fakeClient(replies: Partial<Record<"extract" | "escalate", Reply[]>>) {
  const asked: string[] = [];
  const texts: string[] = [];
  const client = {
    async run(request: { job: { id: string }; user: string }) {
      const job = request.job.id as "extract" | "escalate";
      asked.push(job);
      texts.push(request.user.slice(request.user.indexOf("Page text:\n") + "Page text:\n".length));
      const reply = replies[job]?.shift();
      if (!reply) throw new Error(`no reply queued for ${job}`);
      if (typeof reply === "string") {
        return { ok: false, reason: reply, provider: "cloudflare", detail: "test" };
      }
      return {
        ok: true,
        value: reply,
        provider: "cloudflare",
        model: job === "extract" ? "granite" : "gemma",
        usage: { inputTokens: 100, outputTokens: 50, cost: 1.5, unit: "neuron" },
      };
    },
  } as unknown as AiClient;
  return { client, asked, texts };
}

function memoryCache(): ExtractionCache & { rows: Map<string, CachedExtraction> } {
  const rows = new Map<string, CachedExtraction>();
  return {
    rows,
    async get(hash, version) {
      return rows.get(`${hash}/${version}`) ?? null;
    },
    async put(hash, version, value) {
      rows.set(`${hash}/${version}`, value);
    },
  };
}

const input = (pageText: string) => ({
  pageText,
  header: { url: "https://swing.example/", today: TODAY, tz: "America/New_York" },
  metro: "nyc",
});

/** A weekly swing list, one entry per night from Tuesday 29 September: date heading, title, details. */
function swingWeek(nights: number, details = "9pm to midnight at The Studio, 37 W 26th St. $15.") {
  const names = ["Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Monday"];
  const entries: string[] = [];
  for (let i = 0; i < nights; i++) {
    const at = new Date(Date.UTC(2026, 8, 29 + i));
    const month = at.getUTCMonth() === 8 ? "September" : "October";
    entries.push(
      `${names[i % 7]}, ${month} ${at.getUTCDate()}\n\nSwing Night ${i + 1}\n\n${details}`,
    );
  }
  return entries.join("\n\n");
}

describe("the extraction cache is keyed by the text read (D-074)", () => {
  it("cannot store an answer under a hash the caller names for other text", async () => {
    const page = swingWeek(1);
    const other = "Nothing about dancing here.";
    // A caller that passes a hash that is not its text's, as the empty 304 reads of runs 22 to
    // 25 did: the answer lands under the text read, never under the named hash.
    const poisoned = { ...input(other), contentHash: textKey(page) };
    const first = fakeClient({ extract: [extraction([], "not_relevant")] });
    const cache = memoryCache();
    await extractPage(poisoned, first.client, cache);
    expect([...cache.rows.keys()]).toEqual([`${textKey(other)}/${EXTRACT_PROMPT_VERSION}`]);

    // The real page is read, not served the other text's empty answer.
    const second = fakeClient({ extract: [extraction(["Swing Night 1"])] });
    const read = await extractPage(input(page), second.client, cache);
    expect(second.asked).toEqual(["extract"]);
    expect(read).toMatchObject({ status: "ok", cached: false });
    if (read.status === "ok") expect(read.extraction.listings).toHaveLength(1);
  });

  it("keys a whole page read in parts by its own text too", async () => {
    const page = swingWeek(14);
    const cache = memoryCache();
    // Other text long enough to be read in two parts, so its joined answer is cached as a whole.
    const other = `${"Nothing on tonight. ".repeat(150)}\n\n${"Still nothing. ".repeat(150)}`;
    const poisoned = { ...input(other), contentHash: textKey(page) };
    const first = await extractPageInChunks(
      poisoned,
      fakeClient({ extract: [extraction([], "not_relevant"), extraction([], "not_relevant")] })
        .client,
      cache,
    );
    expect(first.status === "ok" && first.calls).toHaveLength(2);
    const { client, asked } = fakeClient({
      extract: [
        extraction(["Swing Night 1"]),
        extraction(["Swing Night 7"]),
        extraction(["Swing Night 13"]),
      ],
    });
    const read = await extractPageInChunks(input(page), client, cache);
    expect(asked).toEqual(["extract", "extract", "extract"]);
    expect(read.status === "ok" && read.extraction.listings.length).toBe(3);
    expect(cache.rows.has(`${textKey(page)}/${EXTRACT_PROMPT_VERSION}`)).toBe(true);
  });
});

describe("a page cut at its date headings (D-074)", () => {
  it("starts each part at a date heading, with at most six dated entries in it", () => {
    const page = swingWeek(14);
    const parts = splitPageText(page);
    // 14 short entries fit one 4,000-character part; six entries a part keep each reply short.
    expect(page.length).toBeLessThan(4_000);
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.split("\n")[0])).toEqual([
      "Tuesday, September 29",
      "Monday, October 5",
      "Sunday, October 11",
    ]);
    expect(parts.map((p) => (p.match(/Swing Night \d+/g) ?? []).length)).toEqual([6, 6, 2]);
    expect(parts.join("\n\n")).toBe(page);
  });

  it("carries the heading above into a part cut inside an entry, marked as context", () => {
    // One night's entry runs past the part size, so the cut falls inside it.
    const long = Array.from({ length: 60 }, (_, i) => `Band set ${i + 1}: the Hot Toddies.`).join(
      "\n",
    );
    const page = [
      "Wednesday, September 30",
      "",
      "Gotham Jazz",
      "",
      long,
      "",
      "Rooftop, 39th floor. Tables and walk-ins welcome.",
    ].join("\n");
    const parts = splitPageText(page, 1_500);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts.slice(1)) {
      expect(part.startsWith(`${CARRIED_HEADING_NOTE}\nWednesday, September 30\n\n`)).toBe(true);
    }
    // Every line of the page is in exactly one part, in order.
    const own = parts.map((p) =>
      p.replace(`${CARRIED_HEADING_NOTE}\nWednesday, September 30\n\n`, ""),
    );
    const lines = (t: string) => t.split("\n").filter(Boolean);
    expect(own.flatMap(lines)).toEqual(lines(page));
  });

  it("folds a last part of 306 characters into the part before it", () => {
    const body = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => `Detail line ${String(i).padStart(3, "0")} of the evening.`,
      );
    // A part's worth of one event's details (3,839 characters), then run 21's tail: 306 more
    // characters of the same details, past the 4,000-character part.
    const full = body(120).join("\n");
    const text = `${full}\n\n${"t".repeat(306)}`;
    expect(full.length).toBe(3_839);
    expect(text.length).toBeGreaterThan(4_000);
    expect(splitPageText(text)).toEqual([text]);
  });
});

describe("an empty read of a part that writes the window's nights (D-074)", () => {
  const dated = swingWeek(4);

  it("is escalated once, and the stronger model's answer is cached, an empty one too", async () => {
    const { client, asked } = fakeClient({
      extract: [extraction([])],
      escalate: [extraction([], "not_relevant")],
    });
    const cache = memoryCache();
    const result = await extractPage(input(dated), client, cache);
    expect(asked).toEqual(["extract", "escalate"]);
    expect(result).toMatchObject({ status: "ok", escalated: true, emptySuspect: 1 });
    if (result.status === "ok") {
      expect(result.notes).toEqual([
        "escalated: the text writes 4 of the window's 14 nights but the read listed none",
      ]);
    }
    expect(cache.rows.get(`${textKey(dated)}/${EXTRACT_PROMPT_VERSION}`)?.model).toBe("gemma");

    // Not read again next run: the escalated answer stands.
    const again = await extractPage(input(dated), client, cache);
    expect(again).toMatchObject({ status: "ok", cached: true });
    expect(asked).toEqual(["extract", "escalate"]);
  });

  it("returns what the stronger model lists", async () => {
    const { client } = fakeClient({
      extract: [extraction([])],
      escalate: [extraction(["Swing Night 1", "Swing Night 2"])],
    });
    const result = await extractPage(input(dated), client, memoryCache());
    expect(result.status === "ok" && result.extraction.listings).toHaveLength(2);
  });

  it("is left unread, and caches nothing, when the stronger model cannot read it", async () => {
    const cache = memoryCache();
    const deferred = await extractPage(
      input(dated),
      fakeClient({ extract: [extraction([])], escalate: ["quota_exhausted"] }).client,
      cache,
    );
    expect(deferred).toMatchObject({ status: "deferred", emptySuspect: 1 });
    expect(cache.rows.size).toBe(0);
  });

  it("is taken at its word for text that writes fewer than three of the window's nights", async () => {
    for (const text of [swingWeek(2), "Every Thursday, 8pm. October 1, 2020: our old blog post."]) {
      const { client, asked } = fakeClient({ extract: [extraction([], "not_relevant")] });
      const cache = memoryCache();
      expect(await extractPage(input(text), client, cache)).toMatchObject({
        status: "ok",
        escalated: false,
      });
      expect(asked).toEqual(["extract"]);
      expect(cache.rows.size).toBe(1);
    }
  });

  it("does not count nights stated in another year", async () => {
    const old = [
      "Thursday, October 1, 2020",
      "Friday, October 2, 2020",
      "Saturday, October 3, 2020",
      "Sunday, October 4, 2020",
    ].join("\n\nArchive.\n\n");
    const { client, asked } = fakeClient({ extract: [extraction([], "not_relevant")] });
    await extractPage(input(old), client, memoryCache());
    expect(asked).toEqual(["extract"]);
  });
});

describe("a dated listing the page lists only under other nights (D-074)", () => {
  const page = [
    "Wednesday, September 30",
    "",
    "Gotham Jazz",
    "",
    "Rooftop party on the 39th floor, 6:15-10pm",
    "",
    "Thursday, October 1",
    "",
    "Frim Fram Jam",
    "",
    "8:30pm intro lesson, 9pm open dancing",
    "",
    "Wednesday, October 7",
    "",
    "Gotham Jazz",
    "",
    "Rooftop party on the 39th floor, 6:15-10pm",
  ].join("\n");
  const read = (title: string, date: string) =>
    extractionToHarvested(
      rawExtractionSchema.parse({
        page_kind: "list",
        language: "en",
        listings: [
          {
            title,
            listing_type: "social",
            styles: [],
            local_date: date,
            doors_time: "18:15",
            venue: { name: "Somewhere Nowhere" },
            organizer: {},
          },
        ],
      }),
      {
        pageUrl: "https://swing.example/",
        fetchedAt: new Date("2026-09-29T16:00:00Z"),
        today: TODAY,
        pageText: page,
      },
    );

  it("rejects Gotham Jazz dated October 1, naming the heading it is under", () => {
    const result = read("Gotham Jazz", "2026-10-01");
    expect(result.listings).toEqual([]);
    expect(result.rejected).toEqual([
      {
        title: "Gotham Jazz",
        reason:
          'dated 2026-10-01, but the page lists it only under "Wednesday, September 30"; not listed on that date',
      },
    ]);
    expect(result.notOnPage).toEqual([]);
  });

  it("keeps the same title on its own nights, and a title under its own night", () => {
    for (const [title, date] of [
      ["Gotham Jazz", "2026-09-30"],
      ["Gotham Jazz", "2026-10-07"],
      ["Frim Fram Jam", "2026-10-01"],
    ] as const) {
      const result = read(title, date);
      expect(result.rejected, `${title} ${date}`).toEqual([]);
      expect(result.listings.map((h) => h.listing.local_date)).toEqual([date]);
    }
  });
});
