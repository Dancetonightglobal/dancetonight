import { afterEach, describe, expect, it, vi } from "vitest";

import { familyOf } from "@/config/styles";
import { createRepository } from "@/src/data";
import { cheapestAmount, haversineKm, timedOf } from "@/src/data/listing-mapper";
import { MockListingsRepository } from "@/src/data/mock-repository";
import { parseEnv } from "@/src/config/env";
import { seedNyc, type NycSeed } from "@/src/db/seed/nyc";
import { NYC_METRO } from "@/src/db/seed/nyc-data";
import { isConfirmedByOrganiser } from "@/src/domain/listing";
import { currentNightDate, dayPicker, isInProgress, liveStatus } from "@/src/domain/tonight";
import { confirmationLine } from "@/src/ui/home/format";
import { expectDistanceOrder, expectStartOrder } from "./listing-order";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York (DESIGN.md section 6). */
const NOW = new Date("2026-09-20T23:42:00Z");
const WILLIAMSBURG = { lat: 40.7081, lng: -73.9571 };
const BOSTON = { lat: 42.3601, lng: -71.0589 };
const TONIGHT = currentNightDate(NOW, NY);

/** The seed with one event per predicate rewritten; the rewrite gets the row and must return it. */
function seedWith(
  rewrites: ((event: NycSeed["events"][number], seed: NycSeed) => boolean)[],
): (now: Date) => NycSeed {
  return (now) => {
    const seed = seedNyc(now);
    for (const rewrite of rewrites) {
      const target = seed.events.find((e) => rewrite(e, seed));
      if (!target) throw new Error("seedWith: no event matched a rewrite");
    }
    return seed;
  };
}

describeInProcessZones("MockListingsRepository", () => {
  const repo = new MockListingsRepository();
  const tonightNear = (radiusKm: number, filters = {}, sort: "start" | "distance" = "start") =>
    repo.listNight({ center: WILLIAMSBURG, radiusKm, nightDate: TONIGHT, now: NOW, filters, sort });

  it("returns tonight's listings for Williamsburg at 7:42pm on a Sunday, each with distance and status", async () => {
    const { listings, counts } = await tonightNear(25);
    expect(listings.length).toBeGreaterThanOrEqual(8);
    expect(counts.total).toBe(listings.length);
    for (const listing of listings) {
      expect(listing.distanceKm).not.toBeNull();
      expect(listing.distanceKm as number).toBeLessThanOrEqual(25);
      expect(listing.liveStatus).not.toBeNull();
      expect(listing.status).toBe("active");
      // Tonight: on the night date, or in progress, never already ended.
      expect(listing.liveStatus?.kind).not.toBe("ended");
      expect(["upcoming", "on_now", "ending", "cancelled", "time_not_listed"]).toContain(
        listing.liveStatus?.kind,
      );
    }
    const titles = listings.map((l) => l.title);
    expect(titles).toContain("Salsa Sundays at SOB's");
    expect(titles).toContain("Mister Sunday");
    const sobs = listings.find((l) => l.title === "Salsa Sundays at SOB's");
    expect(sobs?.liveStatus?.text).toBe("On now until 11pm");
    expect(sobs?.confirmation).toBe("confirmed_today");
    expect(sobs?.recurrenceText).toBe("Every Sunday");
    // The morning class has ended by 7:42pm and is not "tonight".
    expect(titles).not.toContain("5Rhythms Sunday Sweat");
  });

  it("filters by radius: 5 km is a subset of 25 km", async () => {
    const near = await tonightNear(5);
    const wide = await tonightNear(25);
    expect(near.listings.length).toBeGreaterThan(0);
    expect(near.listings.length).toBeLessThan(wide.listings.length);
    const wideSlugs = new Set(wide.listings.map((l) => l.slug));
    for (const listing of near.listings) {
      expect(listing.distanceKm as number).toBeLessThanOrEqual(5);
      expect(wideSlugs.has(listing.slug)).toBe(true);
      expect(listing.distanceKm).toBeCloseTo(haversineKm(WILLIAMSBURG, listing.venue!.location), 6);
    }
    // Manhattan's SOB's is further than 5 km from the Williamsburg point? Check the arithmetic, not a guess.
    const sobsDistance = wide.listings.find((l) => l.venue?.name === "SOB's")?.distanceKm ?? 0;
    expect(sobsDistance).toBeGreaterThan(4);
  });

  it("filters by family and type, with counts computed before those filters", async () => {
    const all = await tonightNear(25);
    const salsa = await tonightNear(25, { families: ["salsa"] });
    expect(salsa.listings.length).toBeGreaterThan(0);
    expect(salsa.listings.every((l) => l.families.includes("salsa"))).toBe(true);
    expect(salsa.listings.every((l) => l.styles.some((s) => familyOf(s) === "salsa"))).toBe(true);
    expect(salsa.counts.byFamily).toEqual(all.counts.byFamily);
    expect(salsa.counts.byFamily.salsa).toBe(salsa.listings.length);

    const clubs = await tonightNear(25, { types: ["club_night"] });
    expect(clubs.listings.length).toBeGreaterThan(0);
    expect(clubs.listings.every((l) => l.listingType === "club_night")).toBe(true);
    expect(all.counts.byType.club_night).toBe(clubs.listings.length);

    const open = await tonightNear(25, { types: ["venue_open_night"] });
    expect(open.listings.length).toBeGreaterThanOrEqual(2);

    const styles = await tonightNear(25, { styles: ["house"] });
    expect(styles.listings.every((l) => l.styles.includes("house"))).toBe(true);
    expect(all.counts.byStyle.house).toBe(styles.listings.length);
  });

  it("filters free, price, lesson, partner, age, live music and confirmed", async () => {
    const free = await tonightNear(25, { free: true });
    expect(free.listings.length).toBeGreaterThanOrEqual(1);
    expect(free.listings.every((l) => l.isFree === true)).toBe(true);

    const cheap = await tonightNear(25, { maxPrice: 15 });
    expect(cheap.listings.length).toBeGreaterThan(0);
    expect(cheap.listings.every((l) => (cheapestAmount(l) ?? Infinity) <= 15)).toBe(true);

    const lesson = await tonightNear(25, { lessonIncluded: true });
    expect(lesson.listings.length).toBeGreaterThan(0);
    expect(lesson.listings.every((l) => l.lessonAt !== null)).toBe(true);

    const noPartner = await tonightNear(25, { noPartnerNeeded: true });
    expect(noPartner.listings.every((l) => l.partnerRequired === false)).toBe(true);

    const allAges = await tonightNear(25, { age: "all" });
    expect(allAges.listings.every((l) => l.ageMin === null || l.ageMin === 0)).toBe(true);
    const eighteen = await tonightNear(25, { age: 18 });
    expect(eighteen.listings.every((l) => l.ageMin === null || l.ageMin <= 18)).toBe(true);
    const twentyOne = await tonightNear(25, { age: 21 });
    expect(twentyOne.listings.length).toBeGreaterThanOrEqual(eighteen.listings.length);

    const confirmed = await tonightNear(25, { confirmedOnly: true });
    expect(confirmed.listings.length).toBeGreaterThan(0);
    // Exactly the listings whose card names the organizer's page or the ticket page (D-061,
    // D-072), and never one whose card says "Check before you go" because its time is not listed.
    expect(confirmed.listings.every(isConfirmedByOrganiser)).toBe(true);
    expect(confirmed.listings.every((l) => l.startsAt !== null)).toBe(true);
    const everything = await tonightNear(25, {});
    expect(confirmed.listings.length).toBe(
      everything.listings.filter(isConfirmedByOrganiser).length,
    );

    const beginner = await tonightNear(25, { beginnerFriendly: true });
    expect(beginner.listings.every((l) => /beginner|all levels|open/i.test(l.level ?? ""))).toBe(
      true,
    );
  });

  it("carries each source's tier, so a ticket seller's night names the ticket page (D-072)", async () => {
    // Tuesday 22 September 2026, 7:42pm: Ecstatic Dance NYC is listed only on Eventbrite.
    const tuesday = new Date("2026-09-22T23:42:00Z");
    const { listings } = await repo.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: currentNightDate(tuesday, NY),
      now: tuesday,
      filters: { confirmedOnly: true },
      sort: "start",
    });
    const ecstatic = listings.find((l) => l.slug.startsWith("ecstatic-dance-nyc-judson"));
    expect(ecstatic?.sources.map((s) => [s.tier, s.byOrganiser])).toEqual([["ticketing", true]]);
    expect(confirmationLine(ecstatic!, tuesday, "en-US")).toMatch(
      /^On the ticket page, checked \d+h ago$/,
    );
    // An organiser's own page on the same night is named as the organizer's page.
    const own = listings.find((l) => l.sources.some((s) => s.tier === "organizer"));
    expect(confirmationLine(own!, tuesday, "en-US")).toMatch(/^On the organizer's page, checked /);
  });

  it("finds live music from the listing's own liveMusic flag, not only bands or the listing type", async () => {
    const saturday = "2026-09-26";
    const { listings } = await repo.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: saturday,
      now: NOW,
      filters: { liveMusic: true },
      sort: "start",
    });
    const contra = listings.find((l) => l.title === "Saturday contra dance");
    expect(contra).toBeDefined();
    expect(contra?.listingType).toBe("social");
    expect(contra?.music?.bands).toEqual([]);
    expect(contra?.music?.liveMusic).toBe(true);
    for (const listing of listings) {
      expect(
        listing.listingType === "live_music_with_dancing" ||
          listing.music?.liveMusic === true ||
          (listing.music?.bands.length ?? 0) > 0,
        listing.slug,
      ).toBe(true);
    }
    const all = await repo.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: saturday,
      now: NOW,
      sort: "start",
    });
    expect(all.listings.some((l) => l.music?.liveMusic === false)).toBe(true);
    expect(listings.length).toBeLessThan(all.listings.length);
  });

  it("filters onNow to listings in progress at 7:42pm", async () => {
    const { listings } = await tonightNear(25, { onNow: true });
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      expect(isInProgress(timedOf(listing), NOW)).toBe(true);
      expect(["on_now", "ending", "cancelled"]).toContain(listing.liveStatus?.kind);
    }
    expect(listings.map((l) => l.title)).toContain("Salsa Sundays at SOB's");
  });

  it("sorts by start time (ties by distance, no time last) or by distance", async () => {
    const byStart = await tonightNear(25, {}, "start");
    expect(byStart.listings.length).toBeGreaterThan(1);
    expectStartOrder(byStart.listings);
    const byDistance = await tonightNear(25, {}, "distance");
    expectDistanceOrder(byDistance.listings);
    expect(new Set(byDistance.listings.map((l) => l.slug))).toEqual(
      new Set(byStart.listings.map((l) => l.slug)),
    );
  });

  it("lists a future night by its night date", async () => {
    const tomorrow = dayPicker(NOW, NY)[1]?.nightDate;
    if (!tomorrow) throw new Error("no tomorrow");
    const { listings } = await repo.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: tomorrow,
      now: NOW,
      sort: "start",
    });
    expect(listings.length).toBeGreaterThanOrEqual(4);
    expect(listings.every((l) => l.nightDate === tomorrow)).toBe(true);
    // A future night has not begun: a timed listing is upcoming, one with no time says so.
    for (const l of listings) {
      expect(l.liveStatus?.kind, l.slug).toBe(l.startsAt === null ? "time_not_listed" : "upcoming");
    }
    expect(listings.map((l) => l.title)).toContain("Salsa Mondays at Taj Lounge");
  });

  it("builds the day picker in the zone at the point when no metro is near: Boston at 3am", async () => {
    // 2026-09-21T07:00Z is 3:00am in Boston, where the night of the 20th is still on.
    const threeAm = new Date("2026-09-21T07:00:00Z");
    const days = await repo.dayCounts(BOSTON, 25, threeAm);
    expect(days[0]?.label).toBe("Last night"); // D-518: early-hours labels follow the calendar
    expect(days[0]?.nightDate).toBe("2026-09-20");
    expect(days.map((d) => d.nightDate)).toEqual(dayPicker(threeAm, NY).map((d) => d.nightDate));
    for (const day of days) expect(day.count).toBe(0);
  });

  it("gives day picker counts through the next full weekend", async () => {
    const days = await repo.dayCounts(WILLIAMSBURG, 25, NOW);
    // 2026-10-17: a Sunday's picker runs through next Sunday, 8 nights.
    expect(days).toHaveLength(8);
    expect(days[0]?.label).toBe("Tonight");
    expect(days[1]?.label).toBe("Tomorrow");
    expect(days[2]?.label).toBe("Tue, Sep 22");
    expect(days.map((d) => d.nightDate)).toEqual(dayPicker(NOW, NY).map((d) => d.nightDate));
    for (const day of days) expect(day.count).toBeGreaterThanOrEqual(4);
    const tonight = await tonightNear(25);
    expect(days[0]?.count).toBe(tonight.listings.length);
  });

  it("finds a listing by slug with live status, and null for unknown slugs", async () => {
    const { listings } = await tonightNear(25);
    const target = listings.find((l) => l.title === "Mister Sunday");
    if (!target) throw new Error("Mister Sunday missing");
    const found = await repo.getBySlug(target.slug, NOW);
    expect(found?.id).toBe(target.id);
    expect(found?.distanceKm).toBeNull();
    expect(found?.liveStatus?.text).toBe("Starts in 2h 18m, until 4am");
    expect(found?.ageMin).toBe(21);
    expect(found?.venue?.neighborhood).toBe("Ridgewood");
    expect(found?.organizer?.name).toBe("Mister Saturday Night");
    expect(found?.sources.length).toBeGreaterThanOrEqual(1);
    expect(await repo.getBySlug("no-such-night-2026-09-20", NOW)).toBeNull();
  });

  it("matches liveStatus text on returned listings to src/domain/tonight.ts", async () => {
    const { listings } = await tonightNear(40);
    expect(listings.length).toBeGreaterThan(0);
    for (const listing of listings) {
      expect(listing.liveStatus).toEqual(liveStatus(timedOf(listing), NOW, listing.tz));
    }
    const cancelled = listings.find((l) => l.confirmation === "cancelled");
    expect(cancelled?.liveStatus?.text).toBe("Cancelled tonight");
  });

  it("shows both values when two sources disagree on the end time", async () => {
    const friday = "2026-09-25";
    const { listings } = await repo.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: friday,
      now: NOW,
      sort: "start",
    });
    const milonga = listings.find((l) => l.title === "Milonga Gallo Ciego");
    if (!milonga) throw new Error("Milonga Gallo Ciego missing");
    expect(milonga.confirmation).toBe("conflicting");
    expect(milonga.sources).toHaveLength(2);
    const ends = milonga.sources.map((s) => s.values?.endsAt);
    expect(ends).toEqual(["2am", "1am"]);
    expect(milonga.sources[0]?.label).toBe("milongagallociego.wordpress.com");
  });

  it("resolves the metro for a point within 50 km and none for Boston", async () => {
    const metro = await repo.metroFor(WILLIAMSBURG);
    expect(metro?.slug).toBe("nyc");
    expect(metro?.tz).toBe(NYC_METRO.tz);
    expect(metro?.distanceKm).toBeLessThan(10);
    expect(await repo.metroFor({ lat: 42.3601, lng: -71.0589 })).toBeNull();
  });

  it("keeps a cancelled row visible tonight, marked cancelled, and hides a merged one", async () => {
    const withStatuses = new MockListingsRepository(
      seedWith([
        (e) => {
          if (e.nightDate !== TONIGHT || e.title !== "Salsa Sundays at SOB's") return false;
          e.status = "cancelled";
          return true;
        },
        (e) => {
          if (e.nightDate !== TONIGHT || e.title !== "Mister Sunday") return false;
          e.status = "merged";
          return true;
        },
      ]),
    );
    const { listings } = await withStatuses.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start",
    });
    const sobs = listings.find((l) => l.title === "Salsa Sundays at SOB's");
    expect(sobs?.status).toBe("cancelled");
    expect(sobs?.liveStatus?.kind).toBe("cancelled");
    expect(sobs?.liveStatus?.text).toBe("Cancelled tonight");
    expect(listings.map((l) => l.title)).not.toContain("Mister Sunday");
    expect(await withStatuses.getBySlug(sobs?.slug ?? "", NOW)).not.toBeNull();
    const merged = seedNyc(NOW).events.find(
      (e) => e.title === "Mister Sunday" && e.nightDate === TONIGHT,
    );
    expect(await withStatuses.getBySlug(merged?.slug ?? "", NOW)).toBeNull();
    const days = await withStatuses.dayCounts(WILLIAMSBURG, 25, NOW);
    const plain = await repo.dayCounts(WILLIAMSBURG, 25, NOW);
    expect(days[0]?.count).toBe((plain[0]?.count ?? 0) - 1);
  });

  it("drops one malformed row with a warning and keeps the rest", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const withBadZone = new MockListingsRepository(
      seedWith([
        (e) => {
          if (e.nightDate !== TONIGHT || e.title !== "Salsa Sundays at SOB's") return false;
          e.tz = "Mars/Olympus";
          return true;
        },
      ]),
    );
    const { listings } = await withBadZone.listNight({
      center: WILLIAMSBURG,
      radiusKm: 25,
      nightDate: TONIGHT,
      now: NOW,
      sort: "start",
    });
    const plain = await tonightNear(25);
    expect(listings.map((l) => l.title)).not.toContain("Salsa Sundays at SOB's");
    expect(listings).toHaveLength(plain.listings.length - 1);
    expect(warn).toHaveBeenCalledTimes(1);
    const dropped = seedNyc(NOW).events.find(
      (e) => e.title === "Salsa Sundays at SOB's" && e.nightDate === TONIGHT,
    );
    const line = String(warn.mock.calls[0]?.[0]);
    expect(line.startsWith(`Dropped listing ${dropped?.slug} (tz: `)).toBe(true);
    expect(line.split("\n")).toHaveLength(1);
  });

  it("rebuilds the seed when the night date changes", async () => {
    const fresh = new MockListingsRepository();
    const first = fresh.snapshotFor(NOW);
    expect(fresh.snapshotFor(new Date(NOW.getTime() + 60_000))).toBe(first);
    const nextDay = fresh.snapshotFor(new Date(NOW.getTime() + 24 * 3_600_000));
    expect(nextDay).not.toBe(first);
    expect(nextDay.tonight).toBe("2026-09-21");
  });
});

describe("createRepository", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("picks the mock repository in mock mode", () => {
    expect(createRepository(parseEnv({}))).toBeInstanceOf(MockListingsRepository);
    expect(createRepository(parseEnv({ DANCETONIGHT_MODE: "mock" }))).toBeInstanceOf(
      MockListingsRepository,
    );
  });

  it("picks the database repository when a database is configured", () => {
    const repo = createRepository(
      parseEnv({ DANCETONIGHT_MODE: "preview", DATABASE_URL: "postgres://u:p@localhost/db" }),
    );
    expect(repo).not.toBeInstanceOf(MockListingsRepository);
    expect(typeof repo.listNight).toBe("function");
  });

  it("refuses to serve the seed when production has no usable DATABASE_URL", () => {
    const rejected = parseEnv({ DANCETONIGHT_MODE: "production", DATABASE_URL: "mysql://nope" });
    expect(rejected.problems.map((p) => p.variable)).toContain("DATABASE_URL");
    expect(() => createRepository(rejected)).toThrow(/production/);
    expect(() => createRepository(rejected)).toThrow(/DATABASE_URL was rejected/);
    expect(() => createRepository(parseEnv({ DANCETONIGHT_MODE: "production" }))).toThrow(
      /DATABASE_URL is not set/,
    );
    expect(createRepository(parseEnv({ DANCETONIGHT_MODE: "preview" }))).toBeInstanceOf(
      MockListingsRepository,
    );
  });
});
