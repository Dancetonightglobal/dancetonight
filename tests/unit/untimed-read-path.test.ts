// The read path for listings whose source gives a night and no time (D-060, points 2 to 4 and
// the data half of 14): the schema, the mapper, the night rule, filters, order, counts and the
// mock repository. Untimed listings are built here from records through the mapper, so these
// tests do not depend on what the seed carries.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countDays,
  isOnPickedNight,
  selectNight,
  sortListings,
  timedOf,
  toListing,
  toListingSafe,
  withQueryContext,
  type EventRecord,
  type ListingRows,
  type VenueRecord,
} from "@/src/data/listing-mapper";
import { MockListingsRepository } from "@/src/data/mock-repository";
import type { ListingSort, Point } from "@/src/data/repository";
import { seedNyc, type NycSeed } from "@/src/db/seed/nyc";
import { listingSchema, type Listing } from "@/src/domain/listing";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate, dayPicker, isInProgress, liveStatus } from "@/src/domain/tonight";
import { expectDistanceOrder, expectStartOrder } from "./listing-order";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York (DESIGN.md section 6). */
const NOW = new Date("2026-09-20T23:42:00Z");
const TONIGHT = "2026-09-20";
const CENTER: Point = { lat: 40.7081, lng: -73.9571 };

// Three venues due north of the centre: about 0, 1.3 and 4.7 km away.
const NEAR: VenueRecord = venue("near", { lat: 40.7081, lng: -73.9571 });
const MID: VenueRecord = venue("mid", { lat: 40.72, lng: -73.9571 });
const FAR: VenueRecord = venue("far", { lat: 40.75, lng: -73.9571 });

function venue(id: string, location: Point): VenueRecord {
  return {
    id: `venue-${id}`,
    name: `Venue ${id}`,
    location,
    address: null,
    neighborhood: null,
    kind: "dance_hall",
    danceFloor: "yes",
    hours: null,
  };
}

function event(slug: string, overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: `event-${slug}`,
    slug,
    title: slug,
    listingType: "social",
    styles: ["salsa"],
    doorsAt: null,
    lessonAt: null,
    dancingAt: null,
    endsAt: null,
    nightDate: TONIGHT,
    tz: NY,
    prices: [],
    isFree: null,
    ticketUrl: null,
    level: null,
    partnerRequired: null,
    ageMin: null,
    dressCode: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    crowdSizeHint: null,
    summary: null,
    confirmation: "confirmed_today",
    confidence: null,
    status: "active",
    canonicalUrl: null,
    venueId: null,
    organizerId: null,
    seriesId: null,
    ...overrides,
  };
}

function rows(e: EventRecord, v: VenueRecord): ListingRows {
  return {
    event: { ...e, venueId: v.id },
    venue: v,
    organizer: null,
    series: null,
    sources: [
      {
        url: "https://example.org/nights",
        role: "primary",
        lastSeenAt: NOW,
        trustTier: "first_party",
        eventUrl: null,
      },
    ],
  };
}

/** A listing whose source lists its night and no time. */
function untimed(slug: string, v: VenueRecord, overrides: Partial<EventRecord> = {}): Listing {
  return toListing(rows(event(slug, overrides), v));
}

/** A timed listing: dancing starts at the given instant, the night follows from it. */
function timed(slug: string, v: VenueRecord, dancingIso: string, night = TONIGHT): Listing {
  return toListing(rows(event(slug, { dancingAt: new Date(dancingIso), nightDate: night }), v));
}

// Sunday night's bill: two timed listings and five untimed ones, plus neighbours on other nights.
const early = timed("timed-8pm-far", FAR, "2026-09-21T00:00:00Z"); // 8pm EDT
const late = timed("timed-10pm-near", NEAR, "2026-09-21T02:00:00Z"); // 10pm EDT
const sameStartFar = timed("timed-10pm-far", FAR, "2026-09-21T02:00:00Z");
const untimedNear = untimed("untimed-near", NEAR);
const untimedMid = untimed("untimed-mid-until-2am", MID, {
  endsAt: new Date("2026-09-21T06:00:00Z"), // 2am EDT
});
const untimedFar = untimed("untimed-far", FAR);
const untimedNearB = untimed("untimed-near-b", NEAR);
const cancelled = untimed("untimed-cancelled", MID, {
  status: "cancelled",
  confirmation: "cancelled",
});
const lastNight = untimed("untimed-last-night", NEAR, { nightDate: "2026-09-19" });
const tomorrow = untimed("untimed-tomorrow", NEAR, { nightDate: "2026-09-21" });

const ALL = [
  untimedFar,
  lastNight,
  late,
  untimedMid,
  cancelled,
  tomorrow,
  untimedNearB,
  early,
  untimedNear,
  sameStartFar,
];

function night(nightDate: string, now: Date, sort: ListingSort = "start", filters = {}) {
  return selectNight(ALL, {
    center: CENTER,
    radiusKm: 25,
    nightDate,
    now,
    filters,
    sort,
    unplaced: false,
  });
}

const slugs = (listings: readonly Listing[]) => listings.map((l) => l.slug);

describe("listingSchema: a nullable start that is always coalesce(dancing, lesson, doors)", () => {
  const base = untimedNear;

  it("accepts startsAt null when no time is listed, keeping the night date", () => {
    const parsed = listingSchema.parse(base);
    expect(parsed.startsAt).toBeNull();
    expect(parsed.nightDate).toBe(TONIGHT);
  });

  it("rejects a start when no time is listed: that would invent one", () => {
    const result = listingSchema.safeParse({ ...base, startsAt: new Date("2026-09-21T00:00:00Z") });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["startsAt"]);
  });

  it("rejects a null start when a time is listed, and a start that is not the coalesce", () => {
    const doors = new Date("2026-09-20T23:00:00Z");
    const dancing = new Date("2026-09-21T00:00:00Z");
    expect(listingSchema.safeParse({ ...base, doorsAt: doors }).success).toBe(false);
    expect(
      listingSchema.safeParse({ ...base, doorsAt: doors, dancingAt: dancing, startsAt: doors })
        .success,
    ).toBe(false);
    expect(
      listingSchema.safeParse({ ...base, doorsAt: doors, dancingAt: dancing, startsAt: dancing })
        .success,
    ).toBe(true);
    expect(listingSchema.safeParse({ ...base, doorsAt: doors, startsAt: doors }).success).toBe(
      true,
    );
  });
});

describe("the mapper keeps a row with no time", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("toListing builds it with a null start, all three times null, and its stored night", () => {
    expect(untimedNear.startsAt).toBeNull();
    expect([untimedNear.doorsAt, untimedNear.lessonAt, untimedNear.dancingAt]).toEqual([
      null,
      null,
      null,
    ]);
    expect(lastNight.nightDate).toBe("2026-09-19");
    expect(untimedNear.liveStatus).toBeNull();
    expect(untimedNear.distanceKm).toBeNull();
  });

  it("toListingSafe keeps it without a warning; a malformed row is still dropped", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = toListingSafe(rows(event("untimed-safe"), NEAR));
    expect(kept?.startsAt).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    expect(toListingSafe(rows(event("bad-zone", { tz: "Mars/Olympus" }), NEAR))).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toMatch(/^Dropped listing bad-zone \(tz: /);
  });

  it("timedOf carries the stored night and zone, for timed and untimed listings alike", () => {
    expect(timedOf(untimedMid)).toEqual({
      startsAt: null,
      endsAt: new Date("2026-09-21T06:00:00Z"),
      listingType: "social",
      cancelled: false,
      nightDate: TONIGHT,
      tz: NY,
    });
    expect(timedOf(late)).toMatchObject({ startsAt: late.startsAt, nightDate: TONIGHT, tz: NY });
    expect(timedOf(cancelled).cancelled).toBe(true);
  });

  it("withQueryContext gives it the Time not listed status and a distance", () => {
    const withContext = withQueryContext(untimedMid, CENTER, NOW);
    expect(withContext.liveStatus).toEqual({
      kind: "time_not_listed",
      text: "Time not listed, until 2am",
      endNotListed: false,
    });
    expect(withContext.distanceKm).toBeGreaterThan(1);
    expect(withQueryContext(untimedNear, null, NOW).liveStatus?.text).toBe("Time not listed");
  });
});

describeInProcessZones("tonight's list with untimed listings", () => {
  it("shows every untimed listing of tonight, and none from last night or tomorrow", () => {
    const { listings, counts } = night(TONIGHT, NOW);
    const shown = new Set(slugs(listings));
    for (const l of [untimedNear, untimedNearB, untimedMid, untimedFar, cancelled]) {
      expect(shown.has(l.slug), l.slug).toBe(true);
    }
    expect(shown.has(lastNight.slug)).toBe(false);
    expect(shown.has(tomorrow.slug)).toBe(false);
    expect(counts.total).toBe(listings.length);
    expect(counts.total).toBe(8);
    expect(counts.byFamily.salsa).toBe(8);
  });

  it("gives each its status: Time not listed, the listed end, or Cancelled tonight", () => {
    const { listings } = night(TONIGHT, NOW);
    const bySlug = new Map(listings.map((l) => [l.slug, l]));
    expect(bySlug.get(untimedNear.slug)?.liveStatus).toEqual({
      kind: "time_not_listed",
      text: "Time not listed",
      endNotListed: true,
    });
    expect(bySlug.get(untimedMid.slug)?.liveStatus?.text).toBe("Time not listed, until 2am");
    expect(bySlug.get(cancelled.slug)?.liveStatus).toEqual({
      kind: "cancelled",
      text: "Cancelled tonight",
      endNotListed: true,
    });
    for (const l of listings) {
      expect(l.liveStatus).toEqual(liveStatus(timedOf(l), NOW, l.tz));
    }
  });

  it("keeps them on until 05:59 and drops them at 06:00; the listed 2am end drops earlier", () => {
    const at559 = selectNight(ALL, {
      center: CENTER,
      radiusKm: 25,
      nightDate: TONIGHT,
      now: new Date("2026-09-21T09:59:00Z"), // Mon 05:59 EDT: still Sunday night
      sort: "start",
      unplaced: false,
    });
    const shown = slugs(at559.listings);
    expect(shown).toContain(untimedNear.slug);
    expect(shown).toContain(cancelled.slug);
    expect(shown).not.toContain(untimedMid.slug); // until 2am, and it is 5:59
    expect(shown).not.toContain(late.slug); // 10pm with a 4 h default: ended at 2am

    const at600 = selectNight(ALL, {
      center: CENTER,
      radiusKm: 25,
      nightDate: "2026-09-21",
      now: new Date("2026-09-21T10:00:00Z"), // Mon 06:00 EDT: Monday night now
      sort: "start",
      unplaced: false,
    });
    expect(slugs(at600.listings)).toEqual([tomorrow.slug]);
  });

  it("never matches the On now filter, which keeps only what is in progress", () => {
    const at1030 = new Date("2026-09-21T02:30:00Z"); // 10:30pm: both timed socials are on
    const onNow = night(TONIGHT, at1030, "start", { onNow: true });
    expect(slugs(onNow.listings).sort()).toEqual([early.slug, late.slug, sameStartFar.slug].sort());
    for (const l of onNow.listings) expect(isInProgress(timedOf(l), at1030)).toBe(true);
    // Counts are taken after the fact filters: On now's count leaves them out too.
    expect(onNow.counts.total).toBe(3);
    expect(night(TONIGHT, at1030).listings.some((l) => l.startsAt === null)).toBe(true);
  });

  it("sorts them after every timed listing under start sort, by distance then slug", () => {
    const { listings } = night(TONIGHT, NOW, "start");
    expectStartOrder(listings);
    expect(slugs(listings)).toEqual([
      early.slug, // 8pm
      late.slug, // 10pm, 0 km
      sameStartFar.slug, // 10pm, 4.7 km
      untimedNear.slug, // no time, 0 km
      untimedNearB.slug, // no time, 0 km: slug breaks the tie
      cancelled.slug, // no time, 1.3 km ("untimed-cancelled" < "untimed-mid-...")
      untimedMid.slug,
      untimedFar.slug, // no time, 4.7 km
    ]);
  });

  it("sorts them among the rest by distance under distance sort, no time after a time", () => {
    const { listings } = night(TONIGHT, NOW, "distance");
    expectDistanceOrder(listings);
    expect(slugs(listings)).toEqual([
      late.slug, // 0 km, 10pm
      untimedNear.slug, // 0 km, no time
      untimedNearB.slug,
      cancelled.slug, // 1.3 km
      untimedMid.slug,
      early.slug, // 4.7 km, 8pm
      sameStartFar.slug, // 4.7 km, 10pm
      untimedFar.slug, // 4.7 km, no time
    ]);
  });

  it("sorts an unknown distance after every known one, whatever the sort", () => {
    const noDistance = { ...untimedNear, slug: "a-no-distance", distanceKm: null };
    const withDistance = night(TONIGHT, NOW).listings;
    for (const sort of ["start", "distance"] as const) {
      const sorted = sortListings([noDistance, ...withDistance], sort);
      expect(sorted.at(-1)?.slug, sort).toBe("a-no-distance");
    }
  });

  it("lists a night of untimed listings only, in distance order", () => {
    const onlyUntimed = [untimedFar, untimedMid, untimedNear].map((l) => ({
      ...l,
      nightDate: "2026-09-22",
    }));
    const { listings, counts } = selectNight(onlyUntimed, {
      center: CENTER,
      radiusKm: 25,
      nightDate: "2026-09-22",
      now: NOW,
      sort: "start",
      unplaced: false,
    });
    expect(slugs(listings)).toEqual([untimedNear.slug, untimedMid.slug, untimedFar.slug]);
    expect(counts.total).toBe(3);
    expect(listings.every((l) => l.liveStatus?.kind === "time_not_listed")).toBe(true);
    const days = countDays(onlyUntimed, dayPicker(NOW, NY), NOW);
    // 2026-10-17: a Sunday's picker runs through next Sunday, 8 nights.
    expect(days.map((d) => d.count)).toEqual([0, 0, 3, 0, 0, 0, 0, 0]);
  });

  it("shows an untimed listing on its future night, reading Time not listed", () => {
    const { listings } = night("2026-09-21", NOW);
    expect(slugs(listings)).toEqual([tomorrow.slug]);
    expect(listings[0]?.liveStatus?.text).toBe("Time not listed");
  });
});

describeInProcessZones("day picker counts", () => {
  it("count each untimed listing on its stored night, by the rule listNight uses", () => {
    const listed = ALL.map((l) => withQueryContext(l, CENTER, NOW));
    const days = countDays(listed, dayPicker(NOW, NY), NOW);
    expect(days.map((d) => d.nightDate)).toEqual(dayPicker(NOW, NY).map((d) => d.nightDate));
    expect(days[0]).toEqual({ nightDate: TONIGHT, label: "Tonight", count: 8 });
    expect(days[1]).toEqual({ nightDate: "2026-09-21", label: "Tomorrow", count: 1 });
    for (const day of days) {
      expect(day.count, day.nightDate).toBe(night(day.nightDate, NOW).listings.length);
    }
  });

  it("share one per-night predicate with listNight: listed status and the night rule", () => {
    const merged = { ...untimedNear, slug: "merged-row", status: "merged" as const };
    expect(isOnPickedNight(untimedNear, TONIGHT, NOW)).toBe(true);
    expect(isOnPickedNight(merged, TONIGHT, NOW)).toBe(false);
    expect(isOnPickedNight(cancelled, TONIGHT, NOW)).toBe(true);
    expect(isOnPickedNight(lastNight, TONIGHT, NOW)).toBe(false);
    expect(isOnPickedNight(lastNight, "2026-09-19", NOW)).toBe(true);
    expect(countDays([merged], dayPicker(NOW, NY), NOW)[0]?.count).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The mock repository, over the seed plus untimed rows added here (the seed's own rows are
// whatever it carries; every expectation below is relative to the plain seed).

type SeedEvent = NycSeed["events"][number];

/** An untimed copy of a seed event (its venue, organizer and prices), on the given night. */
function untimedCopy(from: SeedEvent, key: string, nightDate: string): SeedEvent {
  return {
    ...from,
    id: `untimed-${key}`,
    slug: `untimed-${key}-${nightDate}`,
    title: `Untimed ${key}`,
    seriesId: null,
    doorsAt: null,
    lessonAt: null,
    dancingAt: null,
    endsAt: null,
    nightDate,
    status: "active",
    confirmation: "recurring_unconfirmed",
  };
}

function seedWithUntimed(now: Date): NycSeed {
  const seed = seedNyc(now);
  const tonight = currentNightDate(now, NY);
  const sobs = seed.events.find((e) => e.title === "Salsa Sundays at SOB's");
  const mister = seed.events.find((e) => e.title === "Mister Sunday");
  if (!sobs || !mister) throw new Error("seed changed: SOB's or Mister Sunday missing");
  seed.events.push(
    untimedCopy(sobs, "tonight-a", tonight),
    untimedCopy(mister, "tonight-b", tonight),
    untimedCopy(sobs, "last-night", addCalendarDays(tonight, -1)),
    untimedCopy(sobs, "tomorrow", addCalendarDays(tonight, 1)),
  );
  return seed;
}

describeInProcessZones("MockListingsRepository with untimed rows", () => {
  const plain = new MockListingsRepository();
  const repo = new MockListingsRepository(seedWithUntimed);
  const WILLIAMSBURG = CENTER;
  const list = (
    r: MockListingsRepository,
    nightDate: string,
    sort: ListingSort = "start",
    filters = {},
  ) => r.listNight({ center: WILLIAMSBURG, radiusKm: 25, nightDate, now: NOW, filters, sort });

  it("lists tonight's untimed rows, reading Time not listed, and not last night's", async () => {
    const { listings, counts } = await list(repo, TONIGHT);
    const base = await list(plain, TONIGHT);
    const added = listings.filter((l) => l.slug.startsWith("untimed-"));
    expect(added.map((l) => l.slug).sort()).toEqual(
      [`untimed-tonight-a-${TONIGHT}`, `untimed-tonight-b-${TONIGHT}`].sort(),
    );
    expect(listings).toHaveLength(base.listings.length + 2);
    expect(counts.total).toBe(base.counts.total + 2);
    for (const l of added) {
      expect(l.startsAt).toBeNull();
      expect(l.liveStatus?.kind).toBe("time_not_listed");
      expect(l.liveStatus?.text).toBe("Time not listed");
    }
  });

  it("puts them after every timed card under start sort, and by distance under distance sort", async () => {
    const byStart = await list(repo, TONIGHT, "start");
    expectStartOrder(byStart.listings);
    const firstUntimed = byStart.listings.findIndex((l) => l.startsAt === null);
    expect(firstUntimed).toBeGreaterThan(0);
    expect(byStart.listings.slice(firstUntimed).every((l) => l.startsAt === null)).toBe(true);
    const byDistance = await list(repo, TONIGHT, "distance");
    expectDistanceOrder(byDistance.listings);
    expect(new Set(slugs(byDistance.listings))).toEqual(new Set(slugs(byStart.listings)));
  });

  it("leaves them out of the On now filter", async () => {
    const onNow = await list(repo, TONIGHT, "start", { onNow: true });
    const base = await list(plain, TONIGHT, "start", { onNow: true });
    expect(slugs(onNow.listings)).toEqual(slugs(base.listings));
    expect(onNow.listings.every((l) => l.startsAt !== null)).toBe(true);
  });

  it("lists tomorrow's untimed row on tomorrow's night", async () => {
    const tomorrowDate = dayPicker(NOW, NY)[1]?.nightDate ?? "";
    const { listings } = await list(repo, tomorrowDate);
    expect(slugs(listings)).toContain(`untimed-tomorrow-${tomorrowDate}`);
    expect(slugs(listings)).not.toContain(`untimed-tonight-a-${TONIGHT}`);
  });

  it("counts them in the day picker on their stored nights, matching listNight", async () => {
    const days = await repo.dayCounts(WILLIAMSBURG, 25, NOW);
    const base = await plain.dayCounts(WILLIAMSBURG, 25, NOW);
    expect(days[0]?.count).toBe((base[0]?.count ?? 0) + 2);
    expect(days[1]?.count).toBe((base[1]?.count ?? 0) + 1);
    for (let i = 2; i < days.length; i++) expect(days[i]?.count).toBe(base[i]?.count);
    for (const day of days) {
      const { listings } = await list(repo, day.nightDate);
      expect(day.count, day.nightDate).toBe(listings.length);
    }
  });

  it("finds one by slug with its status; last night's reads Ended", async () => {
    const found = await repo.getBySlug(`untimed-tonight-a-${TONIGHT}`, NOW);
    expect(found?.startsAt).toBeNull();
    expect(found?.nightDate).toBe(TONIGHT);
    expect(found?.distanceKm).toBeNull();
    expect(found?.liveStatus).toEqual({
      kind: "time_not_listed",
      text: "Time not listed",
      endNotListed: true,
    });
    expect(found?.venue?.name).toBe("SOB's");
    const lastNightSlug = `untimed-last-night-${addCalendarDays(TONIGHT, -1)}`;
    const yesterday = (await repo.getBySlug(lastNightSlug, NOW))?.liveStatus;
    expect(yesterday).toEqual({ kind: "ended", text: "Ended", endNotListed: true });
  });
});
