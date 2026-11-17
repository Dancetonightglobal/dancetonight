// D-123: a venue's own calendar (a source with `venue_id`, as discovery writes it) places a listing
// that names no place, or names the venue itself, at that venue; a listing naming somewhere else
// is placed as any other listing is.
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import type { Db } from "@/src/db/client";
import { events, metros, sources, venues } from "@/src/db/schema";
import { rawListingSchema } from "@/src/domain/listing";
import { EMPTY_BLOCKLIST } from "@/src/pipeline/blocklist";
import { normalizeListing } from "@/src/pipeline/normalize";
import {
  atSourceVenue,
  loadMetro,
  placeSeedSources,
  upsertSource,
  writeEvents,
  type VenueInput,
} from "@/src/pipeline/store";
import { closeTestDb, describeDb, resetDb, testDb } from "@/tests/unit/db-harness";

const NOW = new Date("2026-10-05T16:00:00Z");
const COPA = "00000000-0000-4000-8000-0000000000c1";
const ELSEWHERE = "00000000-0000-4000-8000-0000000000e1";
const AT = { lat: 40.7651, lng: -73.9958 };
const none: VenueInput = { name: null, address: null, url: null, location: null };

describe("atSourceVenue", () => {
  const own = { nameNormalized: "copacabana" };
  it("takes a listing that names no place", () => {
    expect(atSourceVenue(none, own)).toBe(true);
  });
  it("takes a listing that names the venue itself", () => {
    expect(atSourceVenue({ ...none, name: "Copacabana" }, own)).toBe(true);
    // As thecopanyc.com's feed writes it on 2026-10-05.
    expect(atSourceVenue({ ...none, name: "The Copacabana", address: "625 w 51 st" }, own)).toBe(
      true,
    );
  });
  it("leaves a listing that names another place, or gives only an address", () => {
    expect(atSourceVenue({ ...none, name: "Webster Hall" }, own)).toBe(false);
    expect(atSourceVenue({ ...none, address: "125 E 11th St" }, own)).toBe(false);
  });
});

let db: Db;
let metro: Metro;

describeDb("a venue's own calendar writes its rows at sources.venue_id (D-123)", () => {
  beforeAll(async () => {
    db = await testDb("source_venue");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    const place = (id: string, name: string) => ({
      id,
      name,
      nameNormalized: name.toLowerCase(),
      location: AT,
      tz: "America/New_York",
      kind: "night_club" as const,
      danceFloor: "yes" as const,
      websiteUrl: null,
      metroId: metro.id,
    });
    await db.insert(venues).values([place(COPA, "Copacabana"), place(ELSEWHERE, "Elsewhere Hall")]);
  });

  const listing = (title: string, venueName: string | null) => {
    const out = normalizeListing(
      {
        listing: rawListingSchema.parse({
          title,
          listing_type: "social",
          styles: ["salsa"],
          local_date: "2026-10-09",
          doors_time: "22:00",
          venue: venueName ? { name: venueName } : {},
          organizer: {},
        }),
        externalId: `uid:${title}`,
        tz: "America/New_York",
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://thecopanyc.com/events.ics",
          fetchedAt: NOW,
          method: "feed",
        },
      },
      { metro, source: { styles: [] }, now: NOW },
    );
    if (!out.ok) throw new Error(out.reason);
    return out.event;
  };

  it("places the venue's own nights there without asking placeVenue, and others as usual", async () => {
    const created = await upsertSource(db, metro.id, {
      url: "https://thecopanyc.com/events.ics",
      kind: "feed_ics",
      trustTier: "first_party",
      discoveredBy: "venue_websites",
    });
    await db.update(sources).set({ venueId: COPA }).where(eq(sources.id, created.id));
    const [row] = await db.select().from(sources).where(eq(sources.id, created.id));
    const source = { ...created, venueId: row!.venueId };

    const asked: (string | null)[] = [];
    const result = await writeEvents(db, {
      metro,
      source,
      events: [
        listing("Salsa Friday", null),
        listing("Salsa at the Copa", "Copacabana"),
        listing("Copa on tour", "Elsewhere Hall"),
      ],
      blocklist: EMPTY_BLOCKLIST,
      placeVenue: async (input) => {
        asked.push(input.name);
        return input.name === "Elsewhere Hall"
          ? { venueId: ELSEWHERE, location: AT, created: false, method: "name_only" }
          : null;
      },
    });
    expect(result.unplaced).toBe(0);
    expect(asked).toEqual(["Elsewhere Hall"]);
    // Sorted here, not by the database, whose collation differs between CI and a local cluster.
    const rows = (
      await db.select({ title: events.title, venueId: events.venueId }).from(events)
    ).sort((a, b) => (a.title < b.title ? -1 : 1));
    expect(rows).toEqual([
      { title: "Copa on tour", venueId: ELSEWHERE },
      { title: "Salsa Friday", venueId: COPA },
      { title: "Salsa at the Copa", venueId: COPA },
    ]);
  });
});

describeDb("a starting page that is a venue's own site takes that venue (D-087)", () => {
  const LPR = "00000000-0000-4000-8000-0000000000a1";
  const TWIN_A = "00000000-0000-4000-8000-0000000000a2";
  const TWIN_B = "00000000-0000-4000-8000-0000000000a3";
  beforeAll(async () => {
    db = await testDb("source_venue_seed");
  });
  afterAll(closeTestDb);
  beforeEach(async () => {
    await resetDb();
    await db.insert(metros).values({
      slug: "nyc",
      name: "New York",
      countryCode: "US",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 40,
      tz: "America/New_York",
      languages: ["en"],
    });
    metro = (await loadMetro(db, "nyc"))!;
    const place = (id: string, name: string, websiteUrl: string) => ({
      id,
      name,
      nameNormalized: name.toLowerCase(),
      location: AT,
      tz: "America/New_York",
      kind: "night_club" as const,
      danceFloor: "yes" as const,
      websiteUrl,
      metroId: metro.id,
    });
    await db
      .insert(venues)
      .values([
        place(LPR, "Le Poisson Rouge", "http://www.lpr.com/"),
        place(TWIN_A, "Twin Room A", "https://twins.example/"),
        place(TWIN_B, "Twin Room B", "https://www.twins.example/events"),
      ]);
  });

  const seed = (url: string) =>
    upsertSource(db, metro.id, {
      url,
      kind: "html",
      trustTier: "first_party",
      discoveredBy: "seed_list",
    });
  const venueOf = async (url: string) =>
    (await db.select({ venueId: sources.venueId }).from(sources).where(eq(sources.url, url)))[0]
      ?.venueId;

  it("places a page whose host one venue lists, by host, www and scheme aside", async () => {
    await seed("https://lpr.com/");
    const lines = await placeSeedSources(db, metro.id, [
      { url: "https://lpr.com/", venuePage: true },
    ]);
    expect(await venueOf("https://lpr.com/")).toBe(LPR);
    expect(lines).toEqual(["https://lpr.com/ is Le Poisson Rouge's own site: placed at it"]);
  });

  it("never guesses between two venues, leaves an unknown host, and keeps a venue already set", async () => {
    await seed("https://twins.example/calendar");
    await seed("https://nobody.example/");
    await seed("https://www.lpr.com/");
    await db
      .update(sources)
      .set({ venueId: TWIN_A })
      .where(eq(sources.url, "https://www.lpr.com/"));
    const lines = await placeSeedSources(db, metro.id, [
      { url: "https://twins.example/calendar", venuePage: true },
      { url: "https://nobody.example/", venuePage: true },
      { url: "https://www.lpr.com/", venuePage: true },
    ]);
    expect(await venueOf("https://twins.example/calendar")).toBeNull();
    expect(await venueOf("https://nobody.example/")).toBeNull();
    expect(await venueOf("https://www.lpr.com/")).toBe(TWIN_A);
    expect(lines).toEqual([
      "https://twins.example/calendar: 2 venues list this website (Twin Room A, Twin Room B); left unplaced",
      "https://nobody.example/: no seeded venue lists this website; left unplaced",
    ]);
  });

  it("never places pages of a ticket site for several venues by its website, and takes back one so placed (D-808)", async () => {
    // mandalatickets.com (Tulum 11-09): Rakata, La Vaquita... each its own seed, one host that a venue lists.
    await seed("https://lpr.com/en/disco/rakata");
    const vaquita = await seed("https://lpr.com/en/disco/la-vaquita");
    await db.update(sources).set({ venueId: LPR }).where(eq(sources.id, vaquita.id));
    const lines = await placeSeedSources(db, metro.id, [
      { url: "https://lpr.com/en/disco/rakata", venuePage: true, label: "Rakata" },
      { url: "https://lpr.com/en/disco/la-vaquita", venuePage: true, label: "La Vaquita" },
    ]);
    expect(await venueOf("https://lpr.com/en/disco/rakata")).toBeNull();
    expect(await venueOf("https://lpr.com/en/disco/la-vaquita")).toBeNull();
    expect(lines).toEqual([
      "https://lpr.com/en/disco/la-vaquita: a ticket site for several venues, not its venue's own site; venue taken off",
    ]);
  });

  it("still places two pages of one venue's own site by host (one label, D-808)", async () => {
    await seed("https://lpr.com/events");
    await seed("https://lpr.com/calendar");
    await placeSeedSources(db, metro.id, [
      { url: "https://lpr.com/events", venuePage: true, label: "Le Poisson Rouge" },
      { url: "https://lpr.com/calendar", venuePage: true, label: "Le Poisson Rouge" },
    ]);
    expect(await venueOf("https://lpr.com/events")).toBe(LPR);
    expect(await venueOf("https://lpr.com/calendar")).toBe(LPR);
  });

  it("does not report a venue page whose seed gives its own address (D-273)", async () => {
    await seed("https://nobody.example/");
    const lines = await placeSeedSources(db, metro.id, [
      { url: "https://nobody.example/", venuePage: true, venueAddress: "1 Main St, Somewhere" },
    ]);
    expect(await venueOf("https://nobody.example/")).toBeNull();
    expect(lines).toEqual([]);
  });

  it("never places an organiser's page, and takes back a venue it was given with its listings there", async () => {
    // Brooklyn Contra's site, which the map data lists for a park (run of 2026-10-05, 1:10pm ET).
    const organiser = await seed("https://twins.example/calendar");
    await db.update(sources).set({ venueId: TWIN_A }).where(eq(sources.id, organiser.id));
    const at = (slug: string, venueId: string | null, sourceIds: string[]) => ({
      slug,
      title: slug,
      titleNormalized: slug,
      listingType: "social" as const,
      styles: ["contra"],
      nightDate: "2026-10-09",
      tz: "America/New_York",
      confirmation: "recurring_unconfirmed" as const,
      venueId,
      geo: venueId ? AT : null,
      sourceIds,
    });
    await db
      .insert(events)
      .values([
        at("placed-by-the-page", TWIN_A, [organiser.id]),
        at("named-its-own-place", TWIN_B, [organiser.id]),
      ]);
    const lines = await placeSeedSources(db, metro.id, [{ url: "https://twins.example/calendar" }]);
    expect(await venueOf("https://twins.example/calendar")).toBeNull();
    const rows = (
      await db.select({ slug: events.slug, venueId: events.venueId, geo: events.geo }).from(events)
    ).sort((a, b) => (a.slug < b.slug ? -1 : 1));
    expect(rows).toEqual([
      { slug: "named-its-own-place", venueId: TWIN_B, geo: AT },
      { slug: "placed-by-the-page", venueId: null, geo: null },
    ]);
    expect(lines).toEqual([
      "https://twins.example/calendar is not a venue's own page: its venue taken off, with 1 of its listings there, to be placed again from the place each names",
    ]);
    // Not marked as a venue page, it is not placed again.
    expect(
      await placeSeedSources(db, metro.id, [{ url: "https://twins.example/calendar" }]),
    ).toEqual([]);
    expect(await venueOf("https://twins.example/calendar")).toBeNull();
  });
});
