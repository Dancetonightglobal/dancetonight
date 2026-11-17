// The organizer link against Postgres (D-090), on run 33's real duplicate pairs: CDNY on
// Eventbrite and cdny.org (F4, F5), Frim Fram Jam (F6), Swing Remix (D-082) and NYLX, plus every
// gate the critic asked for. Each test fails when the rule it names is removed.

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HarvestedListing, Metro, Source } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { eventSources, events, mergeDecisions, metros, organizers } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import {
  dedupeMetro,
  formatDedupeReport,
  recordDecision,
  refillMergedFacts,
  unmergePair,
} from "@/src/pipeline/dedupe";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  loadMetro,
  mergeInto,
  pipelineId,
  resolveOrganizer,
  retireOutsideMetro,
  resolveVenue,
  upsertSource,
  writeEvents,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, requireDbInCi, resetDb, testDb } from "@/tests/unit/db-harness";

requireDbInCi();

const NOW = new Date("2026-09-28T16:00:00Z");
const NIGHTS = ["2026-09-29", "2026-10-03", "2026-10-06", "2026-10-08", "2026-10-09", "2026-10-10"];
const CHURCH = { lat: 40.7381373, lng: -74.0003114 };
const YSBD = { lat: 40.744505, lng: -73.9904434 };
const DANZNIK = { lat: 40.753519, lng: -73.99099 };
const WEBSTER = { lat: 40.731602, lng: -73.989098 };
const NEWARK = { lat: 40.7357, lng: -74.1724 };

let db: Db;
let metro: Metro;
const src: Record<string, Source> = {};

const SOURCES = {
  eventbrite: {
    url: "https://www.eventbrite.com/o/cdny-115478120751",
    kind: "ticketing_api",
    trustTier: "ticketing",
  },
  cdny: { url: "https://cdny.org/", kind: "html", trustTier: "first_party" },
  twis: { url: "https://thisweekinswingnyc.com/", kind: "html", trustTier: "directory" },
  frimfram: { url: "https://frimframjam.com/", kind: "html", trustTier: "first_party" },
  remix: { url: "https://swingremixnyc.com/", kind: "html", trustTier: "first_party" },
  nylindy: { url: "https://www.nylindy.com/dances-2026", kind: "html", trustTier: "first_party" },
  nycswings: { url: "https://nycswings.net/", kind: "html", trustTier: "first_party" },
  sobs: { url: "https://sobs.com/calendar", kind: "html", trustTier: "first_party" },
  ticketmaster: {
    url: "https://app.ticketmaster.com/",
    kind: "ticketing_api",
    trustTier: "ticketing",
  },
} as const;
type Key = keyof typeof SOURCES;

function listing(
  key: Key,
  id: string,
  fields: Record<string, unknown>,
  at: { lat: number; lng: number } | null,
) {
  const source = src[key]!;
  const harvested: HarvestedListing = {
    listing: rawListingSchema.parse({
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      ...fields,
    }),
    externalId: `${key}:${id}`,
    tz: null,
    venueLocation: at,
    recurrence: null,
    provenance: {
      sourceUrl: `${source.url}#${id}`,
      fetchedAt: NOW,
      method: key === "eventbrite" ? "api" : "feed",
    },
  };
  const outcome = normalizeListing(harvested, { metro, source, now: NOW });
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.event;
}

async function write(key: Key, list: ReturnType<typeof listing>[]) {
  return writeEvents(db, {
    metro,
    source: src[key]!,
    events: list,
    blocklist: EMPTY_BLOCKLIST,
    placeVenue: (input) => resolveVenue(db, metro, input),
  });
}

/** The night's listed rows by title, in code-point order: the database's collation varies (CI's
 * en_US.utf8 skips punctuation, a local C collation does not). */
async function listed(night: string) {
  const rows = await db
    .select()
    .from(events)
    .where(sql`${events.nightDate} = ${night} and ${events.status} in ('active', 'cancelled')`);
  return rows.sort((a, b) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

const CDNY_SITE = { name: "Country Dance New York", url: "https://cdny.org/" };
const CDNY_ON_EVENTBRITE = { name: "CDNY", url: "https://cdny.org/" };

const ebEnglish = (night: string) =>
  listing(
    "eventbrite",
    `english-${night}`,
    {
      title: "English Country Dancing @ The Church of The Village",
      listing_type: "other",
      styles: ["english_country"],
      local_date: night,
      doors_time: "19:00",
      end_time: "22:00",
      venue: { name: "The Church of the Village" },
      organizer: CDNY_ON_EVENTBRITE,
      ticket_url: `https://www.eventbrite.com/e/english-${night}`,
    },
    CHURCH,
  );
const cdnyEnglish = (night: string, extra: Record<string, unknown> = {}) =>
  listing(
    "cdny",
    `english-${night}`,
    {
      title: "English - Tuesdays",
      listing_type: "class",
      styles: ["english_country"],
      local_date: night,
      venue: { name: "The Church of the Village" },
      organizer: CDNY_SITE,
      ...extra,
    },
    CHURCH,
  );

describeDb("the organizer link, against Postgres", () => {
  beforeAll(async () => {
    db = await testDb("dedupe_link");
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
    for (const [key, s] of Object.entries(SOURCES)) {
      src[key] = await upsertSource(db, metro.id, {
        url: s.url,
        kind: s.kind,
        trustTier: s.trustTier,
        discoveredBy: "seed_list",
      });
    }
  });

  describe("F4: CDNY's Tuesday dance on Eventbrite and on cdny.org", () => {
    it("merges each Tuesday into cdny.org's listing, which takes Eventbrite's times and ticket link", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29"), ebEnglish("2026-10-06")]);
      await write("cdny", [cdnyEnglish("2026-09-29"), cdnyEnglish("2026-10-06")]);

      const report = await dedupeMetro(db, metro, NIGHTS);
      expect(report).toMatchObject({ merged: 2, linked: 2, conflicting: 0 });
      for (const night of ["2026-09-29", "2026-10-06"]) {
        const rows = await listed(night);
        expect(rows.map((r) => r.title)).toEqual(["English - Tuesdays"]);
        expect(rows[0]?.doorsAt?.toISOString()).toBe(`${night}T23:00:00.000Z`);
        expect(rows[0]?.ticketUrl).toBe(`https://www.eventbrite.com/e/english-${night}`);
        expect(rows[0]?.sourceIds).toHaveLength(2);
      }
      expect(formatDedupeReport(report)).toContain(
        "Merged: 2026-09-29 English - Tuesdays <- English Country Dancing @ The Church of The Village (same organiser site)",
      );

      // Run again: nothing more.
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
    });

    it("upgrades an organiser stored with its Eventbrite page to its own site, so production's rows pair", async () => {
      // As run 33 stored it: the organiser's Eventbrite page as its website.
      await resolveOrganizer(db, metro, {
        name: "CDNY",
        url: "https://www.eventbrite.com/o/cdny-115478120751",
      });
      await resolveOrganizer(db, metro, { name: "CDNY", url: "https://cdny.org/" });
      const [row] = await db.select().from(organizers).where(eq(organizers.nameNormalized, "cdny"));
      expect(row?.websiteUrl).toBe("https://cdny.org/");
      // One own site never replaces another.
      await resolveOrganizer(db, metro, { name: "CDNY", url: "https://elsewhere.org/" });
      const [again] = await db
        .select()
        .from(organizers)
        .where(eq(organizers.nameNormalized, "cdny"));
      expect(again?.websiteUrl).toBe("https://cdny.org/");
    });

    it("never folds a ticketed dance into the organiser's other, unplaced listing of the night", async () => {
      await write("cdny", [
        listing(
          "cdny",
          "members",
          {
            title: "Members meeting",
            listing_type: "other",
            local_date: "2026-09-29",
            organizer: CDNY_SITE,
          },
          null,
        ),
      ]);
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect(await listed("2026-09-29")).toHaveLength(2);
    });

    it("flags a Tuesday whose sources give starts 90 minutes apart as conflicting, both times shown (A4)", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [
        cdnyEnglish("2026-09-29", { listing_type: "social", dancing_time: "20:30" }),
      ]);
      expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, conflicting: 1 });
      expect((await listed("2026-09-29"))[0]?.confirmation).toBe("conflicting");
    });
  });

  describe("F5: CDNY's Saturday double dance", () => {
    const special = () =>
      listing(
        "cdny",
        "special",
        {
          title: "Special Double Contra Dance",
          listing_type: "class",
          styles: ["contra"],
          local_date: "2026-10-10",
          venue: { name: "The Church of the Village" },
          organizer: CDNY_SITE,
        },
        CHURCH,
      );
    const contraSat = () =>
      listing(
        "cdny",
        "contra-sat",
        {
          title: "CONTRA - SATURDAYS",
          listing_type: "class",
          styles: ["contra"],
          local_date: "2026-10-10",
          venue: { name: "The Church of the Village" },
          organizer: CDNY_SITE,
        },
        CHURCH,
      );
    const fling = () =>
      listing(
        "eventbrite",
        "fling",
        {
          title: "Fall Fling Double Dance",
          listing_type: "other",
          styles: ["contra"],
          local_date: "2026-10-10",
          doors_time: "15:15",
          end_time: "22:30",
          venue: { name: "The Church of the Village" },
          organizer: CDNY_ON_EVENTBRITE,
        },
        CHURCH,
      );

    it("merges the double dance into cdny.org's listing whose title it is closer to", async () => {
      await write("cdny", [special(), contraSat()]);
      await write("eventbrite", [fling()]);
      expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, linked: 1 });
      const rows = await listed("2026-10-10");
      expect(rows.map((r) => r.title)).toEqual([
        "CONTRA - SATURDAYS",
        "Special Double Contra Dance",
      ]);
      expect(rows.find((r) => r.title.startsWith("Special"))?.doorsAt?.toISOString()).toBe(
        "2026-10-10T19:15:00.000Z",
      );
    });

    it("prefers the organiser's dated night over one its weekly rule projected", async () => {
      await write("cdny", [special(), contraSat()]);
      await write("eventbrite", [fling()]);
      // The Saturday rule's night, with the closer title, is projected; the dated one wins.
      await db
        .update(events)
        .set({
          confirmation: "recurring_unconfirmed",
          title: "Fall Fling Saturdays",
          titleNormalized: "fall fling saturdays",
        })
        .where(eq(events.title, "CONTRA - SATURDAYS"));
      await dedupeMetro(db, metro, NIGHTS);
      const rows = await listed("2026-10-10");
      expect(rows.map((r) => r.title)).toEqual([
        "Fall Fling Saturdays",
        "Special Double Contra Dance",
      ]);
    });
  });

  it("F6: merges Frim Fram Jam on This Week in Swing into frimframjam.com's night, a lesson and a start being one evening", async () => {
    await write("twis", [
      listing(
        "twis",
        "ffj",
        {
          title: "Frim Fram Jam",
          local_date: "2026-10-08",
          lesson_time: "20:30",
          styles: ["lindy_hop"],
          venue: { name: "YSBD" },
        },
        YSBD,
      ),
    ]);
    await write("frimfram", [
      listing(
        "frimfram",
        "warmup",
        {
          title: "NYLX Warmup w/ DJs TJ Savino & Claire Lorman",
          local_date: "2026-10-08",
          dancing_time: "21:00",
          styles: ["lindy_hop"],
          venue: { name: "37 W 26th St, 2nd floor, NYC" },
          organizer: { name: "Frim Fram Jam", url: "https://frimframjam.com/" },
        },
        YSBD,
      ),
    ]);
    expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({
      merged: 1,
      linked: 1,
      conflicting: 0,
    });
    expect((await listed("2026-10-08")).map((r) => r.title)).toEqual([
      "NYLX Warmup w/ DJs TJ Savino & Claire Lorman",
    ]);
  });

  describe("D-082: Swing Remix, neither listing placed", () => {
    const twisRemix = () =>
      listing(
        "twis",
        "remix",
        {
          title: "Swing Remix",
          local_date: "2026-10-03",
          doors_time: "19:45",
          lesson_time: "20:00",
          dancing_time: "20:30",
          end_time: "23:30",
          styles: ["lindy_hop"],
          prices: [{ label: "Door", amount: 30, currency: "USD" }],
        },
        null,
      );

    it("merges This Week in Swing's Swing Remix into swingremixnyc.com's night, which keeps the swing styles", async () => {
      await write("twis", [twisRemix()]);
      await write("remix", [
        listing(
          "remix",
          "brooks",
          { title: "The Brooks Prumo Orchestra", local_date: "2026-10-03", styles: ["tango"] },
          null,
        ),
      ]);
      expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, linked: 1 });
      const rows = await listed("2026-10-03");
      expect(rows.map((r) => r.title)).toEqual(["The Brooks Prumo Orchestra"]);
      expect(rows[0]?.styles).toEqual(expect.arrayContaining(["tango", "lindy_hop"]));
      expect(rows[0]?.dancingAt?.toISOString()).toBe("2026-10-04T00:30:00.000Z");
    });

    it("keeps two bands of one night apart when the directory's night could be either", async () => {
      await write("twis", [twisRemix()]);
      await write("remix", [
        listing(
          "remix",
          "band-1",
          { title: "The Brooks Prumo Orchestra", local_date: "2026-10-03" },
          null,
        ),
        listing("remix", "band-2", { title: "Gordon Webster", local_date: "2026-10-03" }, null),
      ]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect(await listed("2026-10-03")).toHaveLength(3);
    });
  });

  describe("NYLX on Friday 10/9", () => {
    const twisNylx = () =>
      listing(
        "twis",
        "nylx",
        { title: "NYLX", local_date: "2026-10-09", styles: ["lindy_hop"], venue: { name: "YSBD" } },
        YSBD,
      );

    it("keeps the exchange's stub, typed a class, apart from the Friday social (the class gate)", async () => {
      await write("twis", [twisNylx()]);
      await write("nylindy", [
        listing(
          "nylindy",
          "nylx",
          {
            title: "New York Lindy Exchange 2026 (NYLX)",
            listing_type: "class",
            local_date: "2026-10-09",
          },
          null,
        ),
      ]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect(await listed("2026-10-09")).toHaveLength(2);
    });

    it("merges them by the NYLX alias once the stub is a social, and the stub takes the venue", async () => {
      await write("twis", [twisNylx()]);
      await write("nylindy", [
        listing(
          "nylindy",
          "nylx",
          { title: "New York Lindy Exchange 2026 (NYLX)", local_date: "2026-10-09" },
          null,
        ),
      ]);
      expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, linked: 1 });
      const rows = await listed("2026-10-09");
      expect(rows.map((r) => r.title)).toEqual(["New York Lindy Exchange 2026 (NYLX)"]);
      expect(rows[0]?.venueId).not.toBeNull();
    });
  });

  it("never merges a class into a social a directory titles by the class's organiser (A5)", async () => {
    await write("twis", [
      listing(
        "twis",
        "midtown",
        {
          title: "Midtown Swings",
          local_date: "2026-09-29",
          lesson_time: "21:00",
          venue: { name: "Danznik Studios" },
        },
        DANZNIK,
      ),
    ]);
    await write("nycswings", [
      listing(
        "nycswings",
        "intro",
        {
          title: "Intro to Lindy Hop: Beginner Class at Midtown Swings",
          listing_type: "class",
          local_date: "2026-09-29",
          lesson_time: "21:00",
          venue: { name: "Danznik Studios" },
          organizer: { name: "Midtown Swings" },
        },
        DANZNIK,
      ),
    ]);
    expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
    expect(await listed("2026-09-29")).toHaveLength(2);
  });

  it("never pairs two nights through a hub's domain (A6)", async () => {
    await write("eventbrite", [
      listing(
        "eventbrite",
        "hub",
        {
          title: "Friday Fusion",
          local_date: "2026-10-09",
          doors_time: "20:00",
          venue: { name: "Danznik Studios" },
          organizer: { name: "Fusion People", url: "https://nycswings.net/" },
        },
        DANZNIK,
      ),
    ]);
    await write("nycswings", [
      listing(
        "nycswings",
        "social",
        {
          title: "Social Dance Flow Fridays",
          local_date: "2026-10-09",
          dancing_time: "20:30",
          venue: { name: "Danznik Studios" },
          organizer: { name: "NYC Swings", url: "https://nycswings.net/" },
        },
        DANZNIK,
      ),
    ]);
    expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
    expect(await listed("2026-10-09")).toHaveLength(2);
  });

  describe("decisions and undo", () => {
    async function mergeEnglish() {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(1);
    }
    const ebId = () => pipelineId("event", `${src.eventbrite!.id}:eventbrite:english-2026-09-29`);

    it("undoes a merge: both listed again, the survivor gives back what it took, and no run merges them again", async () => {
      await mergeEnglish();
      const result = await unmergePair(db, ebId());
      expect(result?.restored).toEqual(expect.arrayContaining(["times", "ticket link", "sources"]));
      const rows = await listed("2026-09-29");
      expect(rows).toHaveLength(2);
      const own = rows.find((r) => r.title === "English - Tuesdays")!;
      expect(own.doorsAt).toBeNull();
      expect(own.ticketUrl).toBeNull();
      expect(own.sourceIds).toEqual([src.cdny!.id]);
      const links = await db.select().from(eventSources).where(eq(eventSources.eventId, own.id));
      expect(links.map((l) => l.role)).toEqual(["primary"]);
      const decisions = await db.select().from(mergeDecisions);
      expect(decisions.map((d) => d.decision)).toEqual(["manual_distinct"]);

      // The next run re-reads both and merges nothing; the decision stands.
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect((await db.select().from(mergeDecisions)).map((d) => d.decision)).toEqual([
        "manual_distinct",
      ]);
      expect(await listed("2026-09-29")).toHaveLength(2);
    });

    it("never overwrites a model's distinct, and never merges across it", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      const [a, b] = [
        ebId(),
        pipelineId("event", `${src.cdny!.id}:cdny:english-2026-09-29`),
      ].sort();
      await db
        .insert(mergeDecisions)
        .values({ eventA: a!, eventB: b!, score: 0, decision: "llm_distinct" });
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect((await db.select().from(mergeDecisions)).map((d) => d.decision)).toEqual([
        "llm_distinct",
      ]);
    });

    it("keeps a linked merge's decision when the same pair also scores in the queued band", async () => {
      await write("eventbrite", [
        listing(
          "eventbrite",
          "close",
          {
            title: "English - Tuesdays at the Church",
            listing_type: "other",
            local_date: "2026-09-29",
            doors_time: "19:00",
            venue: { name: "The Church of the Village" },
            organizer: { name: "CDNY", url: "https://cdny.org/" },
          },
          CHURCH,
        ),
      ]);
      await write("cdny", [
        cdnyEnglish("2026-09-29", { organizer: { name: "CDNY", url: "https://cdny.org/" } }),
      ]);
      const report = await dedupeMetro(db, metro, NIGHTS);
      expect(report).toMatchObject({ merged: 1, linked: 1, queued: 0 });
      const [decision] = await db.select().from(mergeDecisions);
      expect(decision?.decision).toBe("auto_merge");
      expect(decision?.score).toBeGreaterThanOrEqual(0.5);
    });

    it("never merges by score across a person's distinct", async () => {
      // Same title, venue and organiser, no own site: the D-006 score alone would merge them.
      const fields = {
        title: "Swing Social",
        local_date: "2026-10-06",
        dancing_time: "20:00",
        venue: { name: "YSBD" },
        organizer: { name: "Swing People" },
      };
      await write("twis", [listing("twis", "social", fields, YSBD)]);
      await write("eventbrite", [listing("eventbrite", "social", fields, YSBD)]);
      const ids = (await listed("2026-10-06")).map((r) => r.id).sort();
      await db
        .insert(mergeDecisions)
        .values({ eventA: ids[0]!, eventB: ids[1]!, score: 0, decision: "manual_distinct" });
      expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 0, linked: 0 });
      await db.delete(mergeDecisions);
      expect(await dedupeMetro(db, metro, NIGHTS)).toMatchObject({ merged: 1, linked: 0 });
    });

    it("never lets a run's decision overwrite a person's distinct", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      const [a, b] = [ebId(), pipelineId("event", `${src.cdny!.id}:cdny:english-2026-09-29`)];
      await recordDecision(db, a!, b!, 0, "queued", "{}");
      await db.update(mergeDecisions).set({ decision: "manual_distinct" });
      await recordDecision(db, a!, b!, 0.9, "auto_merge", "{}");
      const [row] = await db.select().from(mergeDecisions);
      expect(row).toMatchObject({ decision: "manual_distinct", score: 0 });
    });

    it("gives a survivor back the styles and ticket link its own re-harvest wrote over", async () => {
      await mergeEnglish();
      await write("cdny", [cdnyEnglish("2026-09-29", { styles: [] })]);
      const before = (await listed("2026-09-29"))[0]!;
      expect(before.ticketUrl).toBeNull();
      await refillMergedFacts(db, [before.id]);
      const after = (await listed("2026-09-29"))[0]!;
      expect(after.ticketUrl).toBe("https://www.eventbrite.com/e/english-2026-09-29");
      expect(after.styles).toContain("english_country");
    });
  });

  describe("the reviews' attacks", () => {
    it("never folds another of the organiser's events that day into its untimed dance (A3)", async () => {
      await write("cdny", [
        listing(
          "cdny",
          "contra-1003",
          {
            title: "CONTRA - SATURDAYS",
            listing_type: "class",
            local_date: "2026-10-03",
            venue: { name: "The Church of the Village" },
            organizer: CDNY_SITE,
          },
          CHURCH,
        ),
      ]);
      await write("eventbrite", [
        listing(
          "eventbrite",
          "workshop",
          {
            title: "Dorothy Cummings: English Dance Afternoon",
            listing_type: "other",
            local_date: "2026-10-03",
            doors_time: "14:00",
            end_time: "17:00",
            venue: { name: "The Church of the Village" },
            organizer: CDNY_ON_EVENTBRITE,
          },
          CHURCH,
        ),
      ]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect(await listed("2026-10-03")).toHaveLength(2);
    });

    it("keeps a second event of the source apart on the next run, once the first is merged", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(1);
      await write("eventbrite", [
        listing(
          "eventbrite",
          "playford",
          {
            title: "English - Tuesdays Playford",
            listing_type: "other",
            local_date: "2026-09-29",
            doors_time: "20:00",
            venue: { name: "The Church of the Village" },
            organizer: CDNY_ON_EVENTBRITE,
          },
          CHURCH,
        ),
      ]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect(await listed("2026-09-29")).toHaveLength(2);
    });

    it("never lends a hub listing's third-party organiser name to a ticket listing elsewhere", async () => {
      await write("sobs", [
        listing(
          "sobs",
          "desi",
          {
            title: "Sounds of Bollywood: Desi Saturdays",
            listing_type: "club_night",
            local_date: "2026-10-03",
            dancing_time: "23:00",
            organizer: { name: "Sounds of Bollywood" },
          },
          null,
        ),
      ]);
      await write("ticketmaster", [
        listing(
          "ticketmaster",
          "sob",
          {
            title: "Sounds of Bollywood",
            listing_type: "club_night",
            local_date: "2026-10-03",
            doors_time: "22:00",
            venue: { name: "Webster Hall" },
          },
          WEBSTER,
        ),
      ]);
      expect((await dedupeMetro(db, metro, NIGHTS)).merged).toBe(0);
      expect(await listed("2026-10-03")).toHaveLength(2);
    });

    it("lists a merged night again when the listing it was merged into leaves the metro", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      await dedupeMetro(db, metro, NIGHTS);
      const survivor = (await listed("2026-09-29"))[0]!;
      await db.execute(
        sql`update events set geo = ST_SetSRID(ST_MakePoint(${NEWARK.lng}, ${NEWARK.lat}), 4326)::geography where id = ${survivor.id}`,
      );
      await retireOutsideMetro(db, { metro, nights: NIGHTS });
      expect((await listed("2026-09-29")).map((r) => r.title)).toEqual([
        "English Country Dancing @ The Church of The Village",
      ]);
    });

    it("undoes a merge when the merged listing's source cancels it, so both show", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      await dedupeMetro(db, metro, NIGHTS);
      const cancelled = listing(
        "eventbrite",
        "english-2026-09-29",
        {
          title: "English Country Dancing @ The Church of The Village",
          listing_type: "other",
          local_date: "2026-09-29",
          doors_time: "19:00",
          cancelled: true,
          venue: { name: "The Church of the Village" },
          organizer: CDNY_ON_EVENTBRITE,
        },
        CHURCH,
      );
      await write("eventbrite", [cancelled]);
      const report = await dedupeMetro(db, metro, NIGHTS);
      expect(report.released).toEqual([
        "2026-09-29 English Country Dancing @ The Church of The Village",
      ]);
      expect(formatDedupeReport(report).some((l) => l.startsWith("Unmerged: 2026-09-29"))).toBe(
        true,
      );
      const rows = await listed("2026-09-29");
      expect(rows.map((r) => [r.title, r.status])).toEqual([
        ["English - Tuesdays", "active"],
        ["English Country Dancing @ The Church of The Village", "cancelled"],
      ]);
    });

    it("keeps a time the survivor's own source gave after the merge when the merge is undone", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      await dedupeMetro(db, metro, NIGHTS);
      await write("cdny", [cdnyEnglish("2026-09-29", { dancing_time: "19:30" })]);
      await unmergePair(
        db,
        pipelineId("event", `${src.eventbrite!.id}:eventbrite:english-2026-09-29`),
      );
      const own = (await listed("2026-09-29")).find((r) => r.title === "English - Tuesdays")!;
      expect(own.dancingAt?.toISOString()).toBe("2026-09-29T23:30:00.000Z");
    });

    it("undoes one of two merges from one source without touching the other's link", async () => {
      await write("eventbrite", [ebEnglish("2026-09-29")]);
      await write("cdny", [cdnyEnglish("2026-09-29")]);
      await dedupeMetro(db, metro, NIGHTS);
      const survivor = (await listed("2026-09-29"))[0]!;
      await write("eventbrite", [
        listing(
          "eventbrite",
          "second",
          {
            title: "English Country Dancing (second listing)",
            listing_type: "other",
            local_date: "2026-09-29",
            doors_time: "19:00",
            venue: { name: "The Church of the Village" },
            organizer: CDNY_ON_EVENTBRITE,
          },
          CHURCH,
        ),
      ]);
      const secondId = pipelineId("event", `${src.eventbrite!.id}:eventbrite:second`);
      await db.transaction((tx) => mergeInto(tx, survivor.id, secondId));
      await unmergePair(
        db,
        pipelineId("event", `${src.eventbrite!.id}:eventbrite:english-2026-09-29`),
      );
      const [after] = await db.select().from(events).where(eq(events.id, survivor.id));
      expect(after?.sourceIds.sort()).toEqual([src.cdny!.id, src.eventbrite!.id].sort());
      const links = await db
        .select()
        .from(eventSources)
        .where(eq(eventSources.eventId, survivor.id));
      expect(links.filter((l) => l.role === "secondary").map((l) => l.sourceUrl)).toEqual([
        `${src.eventbrite!.url}#second`,
      ]);
      // The ticket link came from the listing that left; the one still merged gives none.
      expect(after?.ticketUrl).toBeNull();
    });
  });
});
