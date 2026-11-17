// The seam review of PR 1a (2026-09-29), end to end over a real database: what the date checks
// (D-080) and the time checks (D-081) do to stored rows where each read a title's lines its own
// way. Each case fails without its fix. The pure cases are in seam-review.test.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import type { Metro, Source } from "@/src/adapters/types";
import type { AiClient } from "@/src/ai";
import type { Db } from "@/src/db/client";
import { events, metros } from "@/src/db/schema";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { findPhrase, foldPage } from "@/src/domain/text-facts";
import { postgresExtractionCache } from "@/src/pipeline/ai-stores";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";
import { cleanPageText } from "@/src/pipeline/clean";
import { runIngest } from "@/src/pipeline/ingest";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  mergeInto,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

// Tuesday 2026-09-29, noon in New York: tonight is 2026-09-29.
const NOW = new Date("2026-09-29T16:00:00Z");

const venue = { name: "You Should Be Dancing", address: "37 W 26th St, New York, NY" };
const AT = { lat: 40.7447, lng: -73.9903 };

let db: Db;
let metro: Metro;

const ok = (url: string, body: string): Fixture => ({
  request: { method: "GET", url },
  response: { url, status: 200, headers: {}, body },
});

/** A model that answers each part of a page with the listings whose title that part writes. */
function model(listings: Array<Record<string, unknown>>): AiClient {
  return {
    async run(request: { user: string }) {
      const part = foldPage(request.user);
      return {
        ok: true,
        provider: "cloudflare",
        model: "@cf/ibm-granite/granite-4.0-h-micro",
        usage: { inputTokens: 900, outputTokens: 300, cost: 4.4, unit: "neuron" },
        value: rawExtractionSchema.parse({
          page_kind: "list",
          language: "en",
          listings: listings
            .filter((l) => findPhrase(part, String(l.title)) !== null)
            .map((l) => ({ styles: [], organizer: {}, venue, ...l })),
        }),
      };
    },
  } as unknown as AiClient;
}

/** A model that is down: no part of the page is read. */
const down = {
  async run() {
    return { ok: false, reason: "provider_error", provider: "cloudflare", detail: "503" };
  },
} as unknown as AiClient;

async function ingest(source: Source, html: string, client: AiClient) {
  let t = NOW.getTime();
  const origin = new URL(source.url).origin;
  const report = await runIngest({
    db,
    metro,
    env: {},
    only: [source.url],
    ai: { client, cache: postgresExtractionCache(db) },
    now: () => new Date(t),
    http: createPoliteHttp({
      transport: fixtureTransport([
        ok(`${origin}/robots.txt`, "User-agent: *\nDisallow:\n"),
        ok(source.url, html),
      ]),
      userAgent: "DanceTonightBot/1.0",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
  });
  return report.sources.find((s) => s.url === source.url)!;
}

/** Rows as an earlier read stored them: one per listing, dated, with its times. */
async function storedBefore(source: Source, rows: Array<[Record<string, unknown>, string]>) {
  const normalized = rows.map(([fields, night]) => {
    const outcome = normalizeListing(
      {
        listing: rawListingSchema.parse({
          styles: [],
          organizer: {},
          venue,
          ...fields,
          recurrence_text: null,
          local_date: night,
        }),
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
  await writeEvents(db, {
    metro,
    source,
    events: normalized,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, { ...input, location: AT }),
  });
}

const clock = (d: Date | null) =>
  d
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(d)
    : "-";

/** Every row, as "status night title | doors lesson dancing end" in New York time, sorted. */
async function rows() {
  return (await db.select().from(events))
    .map(
      (r) =>
        `${r.status} ${r.nightDate} ${r.title} | ${[r.doorsAt, r.lessonAt, r.dancingAt, r.endsAt].map(clock).join(" ")}`,
    )
    .sort();
}

/**
 * A page as its site serves it, rebuilt from text as cleanPageText gives it: one paragraph per line,
 * each "label [https://…]" as a link.
 */
function htmlOf(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      let html = "";
      let last = 0;
      for (const m of line.matchAll(/([^[]*?)\s*\[(https?:[^\]\s]*)\]/g)) {
        html += `<a href="${m[2]}">${esc(m[1]!.trim())}</a> `;
        last = m.index + m[0].length;
      }
      return `<p>${html}${esc(line.slice(last))}</p>`;
    });
  return `<html><body>${paragraphs.join("\n")}</body></html>`;
}

/** Frim Fram Jam's own page (frimframjam.com, 2026-09-29), as cleanPageText gives it. */
const FRIM_FRAM = readFileSync(join(__dirname, "fixtures/frimframjam-com.txt"), "utf8");
/**
 * Where it is served. The home page's address is retired as "replaced by" the events list (D-110),
 * and a run switches a retired address off, so the saved text stands at the address now read.
 */
const FRIM_FRAM_URL = "https://frimframjam.com/calendar";

/** The saved Stepping Out page, one paragraph per line, as its site serves it. */
const STEPPING_OUT_HTML = `<html><body>${readFileSync(
  join(__dirname, "../../evals/extraction/pages/steppingoutstudios-social-events1.txt"),
  "utf8",
)
  .split("\n")
  .filter((line) => line.trim() && !line.startsWith("[") && !line.startsWith("<!"))
  .map((line) => `<p>${line.replace(/\[https?:[^\]]*\]/g, "")}</p>`)
  .join("")}</body></html>`;

/** The page's other titles, as run 30 read them: they bound Tango Y Te's part of the page. */
const STEPPING_OUT_OTHERS = [
  "Friday Night Fever",
  "All Night Milonga",
  "Robins Argentine Tango Practica",
  "Noche De Descarga",
  "Bachata Rosa",
  "Zen Zouk",
  "Paciencia Milonga",
  "La Vieja Guardia Salsa",
  "Ballroom and Smooth Practice",
  "Toda La Noche, Salsa Social",
  "Jimmy Anton Salsa Social",
].map((title) => ({ title, listing_type: "social" }));

const source = (url: string, trustTier: "first_party" | "ticketing" = "first_party") =>
  upsertSource(db, metro.id, {
    url,
    kind: "html",
    platform: "probed",
    trustTier,
    discoveredBy: "seed_list",
  });

describeDb("the seam review's cases over a database (2026-09-29)", () => {
  beforeAll(async () => {
    db = await testDb("seam_review");
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

  it("keeps a summary's timed rows when the read skips its first item (F3)", async () => {
    const club = await source("https://club.example/events");
    const item = (title: string, when: string) =>
      `<article><h2><a href="https://club.example/events/${title.replace(/\W+/g, "-")}">${title}</a></h2><time>${when}</time></article>`;
    const html = `<html><body><main><h1>Upcoming</h1>${item("Jazz Brunch Concert (seated)", "Sunday, October 4 · 11:00 AM")}${item("Salsa Night", "Sunday, October 4 · 9:00 PM")}${item("Bachata Night", "Monday, October 5 · 8:00 PM")}</main></body></html>`;
    const salsa = { title: "Salsa Night", listing_type: "social", dancing_time: "21:00" };
    const bachata = { title: "Bachata Night", listing_type: "social", dancing_time: "20:00" };
    await storedBefore(club, [
      [salsa, "2026-10-04"],
      [bachata, "2026-10-05"],
    ]);
    const line = await ingest(
      club,
      html,
      model([
        { ...salsa, local_date: "2026-10-04" },
        { ...bachata, local_date: "2026-10-05" },
      ]),
    );
    expect(line.notes.some((n) => /was replaced/.test(n))).toBe(false);
    expect(await rows()).toEqual([
      "active 2026-10-04 Salsa Night | - - 21:00 -",
      "active 2026-10-05 Bachata Night | - - 20:00 -",
    ]);
  });

  // A read whose every start is wrong (a neighbour's 9:30pm) withdraws its times (D-081); a stored
  // row at the time the listing's own part writes ("Time: 3:00pm – 6:00 pm") is the page's.
  const tango = {
    title: "Tango Y Te",
    listing_type: "social",
    dancing_time: "15:00",
    end_time: "18:00",
  };
  const SUNDAYS = [
    "active 2026-10-04 Tango Y Te | - - 15:00 18:00",
    "active 2026-10-11 Tango Y Te | - - 15:00 18:00",
  ];
  it.each([
    ["dated a Tuesday, rescued to its rule", { local_date: "2026-09-29", dancing_time: "21:30" }],
    ["by its rule", { recurrence_text: "Every Sunday", dancing_time: "21:30" }],
  ])(
    "keeps Tango Y Te's stored 3pm Sundays against a wrong time in a read %s (F4)",
    async (_, read) => {
      const so = await source("https://www.steppingoutstudios.com/social-events1");
      await storedBefore(so, [
        [tango, "2026-10-04"],
        [tango, "2026-10-11"],
      ]);
      const line = await ingest(
        so,
        STEPPING_OUT_HTML,
        model([...STEPPING_OUT_OTHERS, { title: "Tango Y Te", listing_type: "social", ...read }]),
      );
      expect(line.notes.some((n) => /Tango Y Te.*was replaced/.test(n))).toBe(false);
      expect((await rows()).filter((r) => r.includes("Tango Y Te"))).toEqual(SUNDAYS);
    },
  );

  it("retires a sibling at a time the part does not write, keeping the page's (F4)", async () => {
    const so = await source("https://www.steppingoutstudios.com/social-events1");
    await storedBefore(so, [
      [tango, "2026-10-04"],
      [{ ...tango, dancing_time: "21:30", end_time: null }, "2026-10-04"],
      [tango, "2026-10-11"],
    ]);
    await ingest(
      so,
      STEPPING_OUT_HTML,
      model([
        ...STEPPING_OUT_OTHERS,
        {
          title: "Tango Y Te",
          listing_type: "social",
          local_date: "2026-09-29",
          dancing_time: "21:30",
        },
      ]),
    );
    expect((await rows()).filter((r) => r.includes("Tango Y Te"))).toEqual([
      ...SUNDAYS,
      "removed 2026-10-04 Tango Y Te | - - 21:30 -",
    ]);
  });

  // A club's page: Swing Night's part as each case gives it, then Blues Night's.
  const club = (swing: string) =>
    `<html><body><main><h1>Upcoming</h1><h2>Swing Night</h2><p>Saturday, October 3</p><p>${swing}</p><h2>Blues Night</h2><p>Sunday, October 4</p><p>Dancing 8pm to 11pm.</p></main></body></html>`;
  const blues = { title: "Blues Night", listing_type: "social", dancing_time: "20:00" };
  const bluesRead = { ...blues, local_date: "2026-10-04" };
  // A read whose one start for Swing Night is wrong: withdrawn (D-081).
  const swingRead = {
    title: "Swing Night",
    listing_type: "social",
    local_date: "2026-10-03",
    dancing_time: "20:00",
  };

  it("keeps both sessions of a night whose social the page writes as a bare clock face (F4)", async () => {
    const c = await source("https://club.example/two");
    await storedBefore(c, [
      [{ title: "Swing Night", listing_type: "class", lesson_time: "14:00" }, "2026-10-03"],
      [{ title: "Swing Night", listing_type: "social", dancing_time: "21:00" }, "2026-10-03"],
      [blues, "2026-10-04"],
    ]);
    const line = await ingest(
      c,
      club("Beginner class 2pm. Evening social 9:00 - 11:30."),
      model([swingRead, bluesRead]),
    );
    expect(line.notes.some((n) => /at a time the page does not write/.test(n))).toBe(false);
    expect(await rows()).toEqual([
      "active 2026-10-03 Swing Night | - - 21:00 -",
      "active 2026-10-03 Swing Night | - 14:00 - -",
      "active 2026-10-04 Blues Night | - - 20:00 -",
    ]);
  });

  it("replaces a stored row whose lesson and end the page does not write (F4)", async () => {
    const c = await source("https://club.example/lesson");
    await storedBefore(c, [
      [
        {
          title: "Swing Night",
          listing_type: "social",
          lesson_time: "19:00",
          dancing_time: "21:00",
          end_time: "02:00",
        },
        "2026-10-03",
      ],
      [blues, "2026-10-04"],
    ]);
    await ingest(c, club("Social dancing 9pm to 11:30pm."), model([swingRead, bluesRead]));
    expect(await rows()).toEqual([
      "active 2026-10-03 Swing Night | - - - -",
      "active 2026-10-04 Blues Night | - - 20:00 -",
      "removed 2026-10-03 Swing Night | - 19:00 21:00 02:00",
    ]);
  });

  it("writes a cancellation whose read time is withdrawn, never keeping the stored row on (F4)", async () => {
    const c = await source("https://club.example/cancelled");
    await storedBefore(c, [
      [{ title: "Swing Night", listing_type: "social", dancing_time: "21:00" }, "2026-10-03"],
      [blues, "2026-10-04"],
    ]);
    await ingest(
      c,
      club("Social 9pm to 11:30pm. Cancelled this week: the hall is closed."),
      model([{ ...swingRead, cancelled: true }, bluesRead]),
    );
    expect(await rows()).toEqual([
      "active 2026-10-04 Blues Night | - - 20:00 -",
      "cancelled 2026-10-03 Swing Night | - - - -",
      "removed 2026-10-03 Swing Night | - - 21:00 -",
    ]);
  });

  it("retires a sibling at a time the part does not write on a partial read too (F4)", async () => {
    const so = await source("https://www.steppingoutstudios.com/social-events1");
    await storedBefore(so, [
      [tango, "2026-10-04"],
      [{ ...tango, dancing_time: "21:30", end_time: null }, "2026-10-04"],
      [tango, "2026-10-11"],
    ]);
    const { run: readPart } = model([
      ...STEPPING_OUT_OTHERS,
      {
        title: "Tango Y Te",
        listing_type: "social",
        local_date: "2026-09-29",
        dancing_time: "21:30",
      },
    ]) as unknown as { run: (request: { user: string }) => Promise<unknown> };
    // The part that writes Jimmy Anton fails, so the read is partial: nothing is retired as
    // unlisted, and only the withdrawal's own retirement takes the 9:30pm row off.
    const partial = {
      async run(request: { user: string }) {
        if (request.user.includes("Jimmy Anton")) {
          return {
            ok: false,
            reason: "provider_error",
            provider: "cloudflare",
            detail: "timed out",
          };
        }
        return readPart(request);
      },
    } as unknown as AiClient;
    const line = await ingest(so, STEPPING_OUT_HTML, partial);
    expect(line.notes.some((n) => /parts could not be read/.test(n))).toBe(true);
    expect(
      line.notes.some((n) =>
        /Tango Y Te: 1 listing\(s\) on 2026-10-04 at a time the page does not write were retired/.test(
          n,
        ),
      ),
    ).toBe(true);
    expect((await rows()).filter((r) => r.includes("Tango Y Te"))).toEqual([
      ...SUNDAYS,
      "removed 2026-10-04 Tango Y Te | - - 21:30 -",
    ]);
  });

  it("lists no old time again beside this source's row merged into another source's (S1)", async () => {
    const c = await source("https://club.example/moved");
    const tickets = await source("https://tickets.example/moved", "ticketing");
    await storedBefore(c, [
      [{ title: "Swing Night", listing_type: "social", dancing_time: "19:00" }, "2026-10-03"],
      [blues, "2026-10-04"],
    ]);
    // The page moved Swing Night to 9pm: a whole read lists 21:00, and the 7pm row retires.
    const moved = club("Dancing 9pm to 11:30pm.");
    await ingest(c, moved, model([{ ...swingRead, dancing_time: "21:00" }, bluesRead]));
    // A ticketing source lists it too, and dedupe merges this source's row into its row.
    await storedBefore(tickets, [
      [{ title: "Swing Night", listing_type: "social", dancing_time: "21:00" }, "2026-10-03"],
    ]);
    const all = await db.select().from(events);
    const nine = (r: (typeof all)[number]) =>
      r.title === "Swing Night" && r.status === "active" && clock(r.dancingAt) === "21:00";
    const ours = all.find((r) => nine(r) && r.sourceIds.includes(c.id))!;
    const theirs = all.find((r) => nine(r) && r.id !== ours.id)!;
    await mergeInto(db, theirs.id, ours.id);
    // A whole read that misses October 3, which the page still writes beside the title.
    const line = await ingest(
      c,
      moved.replace("<h1>Upcoming</h1>", "<h1>Upcoming</h1><p>Updated weekly.</p>"),
      model([bluesRead]),
    );
    expect(line.notes.some((n) => /were listed again/.test(n))).toBe(false);
    expect((await rows()).filter((r) => r.includes("Swing Night"))).toEqual([
      "active 2026-10-03 Swing Night | - - 21:00 -",
      "merged 2026-10-03 Swing Night | - - 21:00 -",
      "removed 2026-10-03 Swing Night | - - 19:00 -",
    ]);
  });

  // Frim Fram Jam's October 1 row as an early read stored it (run 30's site: doors 7pm, dancing
  // 7:30pm to 10:30pm), none of which its part of the page writes (8:30pm lesson, 9pm to close).
  const stale = {
    title: "Frim Fram Jam",
    listing_type: "social",
    doors_time: "19:00",
    dancing_time: "19:30",
    end_time: "22:30",
  };
  // The read run 33 had from the cache: each night titled by its date alone, so not an event.
  const datesOnly = model([
    { title: "Oct 1", listing_type: "social", local_date: "2026-10-01", lesson_time: "19:30" },
    { title: "Oct 8", listing_type: "social", local_date: "2026-10-08", lesson_time: "19:30" },
  ]);

  it.each([
    ["a read that lists no event", datesOnly],
    ["no read at all", down],
  ])(
    "lists a stored night with no time where its part of the page writes none of its times, after %s (S2)",
    async (_, client) => {
      const ffj = await source(FRIM_FRAM_URL);
      await storedBefore(ffj, [[stale, "2026-10-01"]]);
      const line = await ingest(ffj, htmlOf(FRIM_FRAM), client);
      expect(
        line.notes.some((n) =>
          /1 stored listing\(s\) at a time their part of the page does not write were listed with no time: Frim Fram Jam on 2026-10-01/.test(
            n,
          ),
        ),
      ).toBe(true);
      expect(await rows()).toEqual([
        "active 2026-10-01 Frim Fram Jam | - - - -",
        "removed 2026-10-01 Frim Fram Jam | 19:00 - 19:30 22:30",
      ]);
      // The untimed listing carries the night and nothing the stale row made up.
      const [untimed] = (await db.select().from(events)).filter((r) => r.status === "active");
      expect([untimed!.ageMin, untimed!.dressCode, untimed!.level, untimed!.prices]).toEqual([
        null,
        null,
        null,
        [],
      ]);
      // And the next run leaves it as it is.
      await ingest(ffj, htmlOf(FRIM_FRAM), client);
      expect(await rows()).toEqual([
        "active 2026-10-01 Frim Fram Jam | - - - -",
        "removed 2026-10-01 Frim Fram Jam | 19:00 - 19:30 22:30",
      ]);
    },
  );

  it("keeps a stored night whose every time its part of the page writes (S2)", async () => {
    const c = await source("https://club.example/kept");
    await storedBefore(c, [
      [
        { title: "Swing Night", listing_type: "social", dancing_time: "21:00", end_time: "23:30" },
        "2026-10-03",
      ],
      [blues, "2026-10-04"],
    ]);
    const before = await rows();
    const line = await ingest(c, club("Social dancing 9pm to 11:30pm."), down);
    expect(line.notes.some((n) => /listed with no time/.test(n))).toBe(false);
    expect(await rows()).toEqual(before);
  });

  it("lists a stored night with no time whose end its part of the page does not write (S2)", async () => {
    const c = await source("https://club.example/end");
    await storedBefore(c, [
      [
        { title: "Swing Night", listing_type: "social", dancing_time: "21:00", end_time: "02:00" },
        "2026-10-03",
      ],
      [blues, "2026-10-04"],
    ]);
    await ingest(c, club("Social dancing 9pm to 11:30pm."), down);
    expect((await rows()).filter((r) => r.includes("Swing Night"))).toEqual([
      "active 2026-10-03 Swing Night | - - - -",
      "removed 2026-10-03 Swing Night | - - 21:00 02:00",
    ]);
  });

  it("checks a stored time a read's no-time listing gave way to (S2)", async () => {
    // The read lists October 1 with no time, so D-060 keeps the timed row: that is no check of the
    // page, and the page does not write its times.
    const ffj = await source(FRIM_FRAM_URL);
    await storedBefore(ffj, [[stale, "2026-10-01"]]);
    await ingest(
      ffj,
      htmlOf(FRIM_FRAM),
      model([{ title: "Frim Fram Jam", listing_type: "social", local_date: "2026-10-01" }]),
    );
    expect(await rows()).toEqual([
      "active 2026-10-01 Frim Fram Jam | - - - -",
      "removed 2026-10-01 Frim Fram Jam | 19:00 - 19:30 22:30",
    ]);
  });

  it("keeps a title-first list's stored times with no read to vote its layout (S2)", async () => {
    const c = await source("https://club.example/list");
    const item = (title: string, when: string) => `<h3>${title}</h3><p>${when}</p>`;
    const html = `<html><body><main>${item("Salsa Social", "Thu, Oct 1, 8:00 PM · Club X")}${item("Bachata Night", "Fri, Oct 2, 9:00 PM · Club Y")}${item("Kizomba Night", "Sat, Oct 3, 10:00 PM · Club Z")}</main></body></html>`;
    await storedBefore(c, [
      [{ title: "Salsa Social", listing_type: "social", dancing_time: "20:00" }, "2026-10-01"],
      [{ title: "Bachata Night", listing_type: "social", dancing_time: "21:00" }, "2026-10-02"],
      [{ title: "Kizomba Night", listing_type: "social", dancing_time: "22:00" }, "2026-10-03"],
    ]);
    const before = await rows();
    const line = await ingest(c, html, down);
    expect(line.notes.some((n) => /listed with no time/.test(n))).toBe(false);
    expect(await rows()).toEqual(before);
  });

  it("keeps a rule's stored times where the page also names its nights with no time (S2)", async () => {
    const c = await source("https://club.example/rule");
    const html = `<html><body><main><h1>Salsa Social</h1><p>Every Friday, 9pm to 2am. Beginner lesson at 8pm.</p><p>${"All levels welcome, no partner needed, great music all night. ".repeat(8)}</p><p>Upcoming dates: Fri Oct 2: Salsa Social with DJ Mike</p></main></body></html>`;
    await ingest(
      c,
      html,
      model([
        {
          title: "Salsa Social",
          listing_type: "social",
          recurrence_text: "Every Friday",
          lesson_time: "20:00",
          dancing_time: "21:00",
          end_time: "02:00",
        },
      ]),
    );
    const before = await rows();
    expect(before).toContain("active 2026-10-02 Salsa Social | - 20:00 21:00 02:00");
    const line = await ingest(c, html.replace("great music", "the best music"), down);
    expect(line.notes.some((n) => /listed with no time/.test(n))).toBe(false);
    expect(await rows()).toEqual(before);
  });

  it("gives the night with no time the stored row's own venue, not another at its point (S2)", async () => {
    // Another tenant of the building, placed first at the same point.
    await resolveVenue(db, metro, {
      name: "Pineapple Dance Studio",
      address: venue.address,
      url: null,
      location: AT,
    });
    const ffj = await source(FRIM_FRAM_URL);
    await storedBefore(ffj, [[stale, "2026-10-01"]]);
    await ingest(ffj, htmlOf(FRIM_FRAM), down);
    const all = await db.select().from(events);
    const active = all.find((r) => r.status === "active")!;
    const removed = all.find((r) => r.status === "removed")!;
    expect(active.startsAt).toBeNull();
    expect(active.venueId).toBe(removed.venueId);
  });

  it("leaves a stored night another source lists too, whose times may be that source's (S2)", async () => {
    const ffj = await source(FRIM_FRAM_URL);
    const twis = await source("https://thisweekinswingnyc.com/");
    await storedBefore(ffj, [[stale, "2026-10-01"]]);
    await storedBefore(twis, [[stale, "2026-10-01"]]);
    const all = await db.select().from(events);
    const ours = all.find((r) => r.canonicalUrl?.includes("frimframjam"))!;
    const theirs = all.find((r) => r.id !== ours.id)!;
    await mergeInto(db, ours.id, theirs.id);
    const before = await rows();
    const line = await ingest(ffj, htmlOf(FRIM_FRAM), down);
    expect(line.notes.some((n) => /listed with no time/.test(n))).toBe(false);
    expect(await rows()).toEqual(before);
  });
});
