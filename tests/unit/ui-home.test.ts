// The home screen's pure helpers.
//
// @testing-library/react is NOT a dependency of this repo and this phase adds none, so the
// screen is not driven here. Instead every rule a reviewer checks on the home page was
// extracted into a pure function and is tested as one: hour bucketing, empty-hour generation,
// now-rule placement, the distance-sort collapse, the rail's meridiem rule and the URL state.
// Where a rule lives in the markup (the "Time not listed" card and section head, D-060) the card
// and the bill are rendered to static markup with react-dom/server, as the detail tests do.
//
// The file is .ts rather than .tsx because vitest.config.ts collects `tests/unit/**/*.test.ts`
// only, and vitest.config.ts is not in this agent's file list. See the report notes.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FAMILY_KEYS } from "@/config/styles";
import { LISTING_TYPE_KEYS } from "@/src/domain/listing-types";
import { listingsFromSeed } from "@/src/data/mock-repository";
import { selectNight } from "@/src/data/listing-mapper";
import { seedNyc } from "@/src/db/seed/nyc";
import { HOUR_MS, MINUTE_MS, formatTime, localInstant } from "@/src/domain/time";
import type { Listing, ListingSource } from "@/src/domain/listing";
import type { LiveStatus } from "@/src/domain/tonight";
import { t } from "@/src/i18n";
import { Card } from "@/src/ui/home/Card";
import { Timeline as TimelineList } from "@/src/ui/home/Timeline";
import { toMapPlaces } from "@/src/ui/map/types";

import {
  DEFAULT_CENTER,
  DEFAULT_RADIUS_KM,
  SEGMENTS,
  SEGMENT_TYPES,
  activeFilterCount,
  carriedParams,
  hrefWith,
  parseCenter,
  parseHomeParams,
  parseList,
  toggleFamilyHref,
} from "@/src/ui/home/params";
import {
  UNTIMED_SECTION_KEY,
  buildTimeline,
  hasStart,
  hourStart,
  hourStarts,
  isAfternoon,
  latestEnd,
  meridiemReference,
  placeNowRule,
  railStamp,
  type Timeline,
  type TimelineInput,
  type TimelineRow,
} from "@/src/ui/home/timeline-rows";
import {
  cardWarning,
  confirmationLine,
  formatDistance,
  formatMoney,
  formatRadius,
  venueLine,
} from "@/src/ui/home/format";

import { describeInProcessZones } from "./processZone";

const ZONE = "America/New_York";
const LOCALE = "en-US";

/** A night of listings from the real seed, which is what the page renders in mock mode (D-011). */
function seedNight(now: Date): { listings: Listing[]; total: number } {
  const listings = listingsFromSeed(seedNyc(now));
  const { listings: chosen, counts } = selectNight(listings, {
    center: DEFAULT_CENTER,
    radiusKm: DEFAULT_RADIUS_KM,
    nightDate: "2026-09-20",
    now,
    sort: "start",
    // The page's own rule at the metro's radius: listings with no location are in reach (D-082).
    unplaced: true,
  });
  return { listings: chosen, total: counts.total };
}

/** A hand-built listing, so a timeline test states exactly the times it is about. */
function fakeListing(
  id: string,
  startsAt: Date | null,
  endsAt: Date | null,
  overrides: Partial<Listing> = {},
): Listing {
  return {
    id,
    slug: id,
    title: id,
    listingType: "social",
    styles: ["salsa"],
    families: ["salsa"],
    doorsAt: null,
    lessonAt: null,
    dancingAt: startsAt,
    endsAt,
    startsAt,
    nightDate: "2026-09-20",
    tz: ZONE,
    venue: {
      id: `${id}-venue`,
      name: "A hall",
      location: { lat: 40.7128, lng: -74.006 },
      address: null,
      neighborhood: "SoHo",
      googlePlaceId: null,
      kind: "dance_hall",
      danceFloor: "yes",
    },
    organizer: null,
    prices: [{ label: "Door", amount: 15, currency: "USD", includes: null }],
    isFree: false,
    ticketUrl: null,
    level: null,
    partnerRequired: null,
    ageMin: null,
    dressCode: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    crowdSizeHint: null,
    recurrenceText: null,
    confirmation: "confirmed_today",
    confidence: null,
    summary: null,
    // The organiser's own page, so a dated listing reads "On the organizer's page" (D-061, D-072).
    sources: [
      {
        url: "https://organiser.example/nights",
        label: "organiser.example",
        checkedAt: new Date(RENDER_NOW.getTime() - 2 * 3_600_000),
        byOrganiser: true,
        tier: "organizer",
        eventUrl: null,
      },
    ],
    status: "active",
    canonicalUrl: null,
    distanceKm: 1.2,
    liveStatus: null,
    ...overrides,
  };
}

/** The domain's status for a listing whose time is not listed (settled S4), built from en.ts. */
function untimedStatus(endsAt: Date | null): LiveStatus {
  return {
    kind: "time_not_listed",
    text:
      endsAt === null
        ? t("card.status.timeNotListed")
        : t("card.status.timeNotListedUntil", { until: formatTime(endsAt, ZONE, LOCALE) }),
    endNotListed: endsAt === null,
  };
}

/**
 * A listing whose source gave its night and no time (D-060): every start-ish time is null, the
 * night is a fact of its own, and the live status is the domain's "time_not_listed".
 */
function fakeUntimed(
  id: string,
  options: {
    distanceKm?: number | null;
    endsAt?: Date | null;
    nightDate?: string;
    overrides?: Partial<Listing>;
  } = {},
): Listing {
  const endsAt = options.endsAt ?? null;
  return fakeListing(id, null, endsAt, {
    dancingAt: null,
    nightDate: options.nightDate ?? "2026-09-20",
    distanceKm: options.distanceKm === undefined ? 2.5 : options.distanceKm,
    confirmation: "recurring_unconfirmed",
    liveStatus: untimedStatus(endsAt),
    ...options.overrides,
  });
}

const at = (hour: number, minute = 0, day = "2026-09-20") => localInstant(day, ZONE, hour, minute);

/** buildTimeline with the test defaults: New York, en-US, start sort, tonight. */
function bill(listings: Listing[], now: Date, options: Partial<TimelineInput> = {}): Timeline {
  return buildTimeline({
    listings,
    now,
    zone: ZONE,
    locale: LOCALE,
    sort: "start",
    showNow: true,
    ...options,
  });
}

/** The ids of the card rows, in bill order. */
const cardIds = (rows: readonly TimelineRow[]): string[] =>
  rows.flatMap((row) => (row.kind === "card" ? [row.listing.id] : []));

describeInProcessZones("home timeline", () => {
  describe("hour markers", () => {
    it("runs an hour for every hour from the earliest start to the latest end", () => {
      const hours = hourStarts(at(18, 30), at(1, 0, "2026-09-21"), ZONE);
      expect(hours).toHaveLength(8);
      expect(hours[0]?.getTime()).toBe(at(18).getTime());
      expect(hours.at(-1)?.getTime()).toBe(at(1, 0, "2026-09-21").getTime());
    });

    it("snaps an instant to the start of its local hour", () => {
      expect(hourStart(at(20, 47), ZONE).getTime()).toBe(at(20).getTime());
    });

    it("reads the local clock, not the process clock, for the side of noon", () => {
      expect(isAfternoon(at(11, 59), ZONE)).toBe(false);
      expect(isAfternoon(at(12, 0), ZONE)).toBe(true);
      expect(isAfternoon(at(0, 30, "2026-09-21"), ZONE)).toBe(false);
    });

    it("takes the latest EFFECTIVE end, so an unlisted end still extends the bill", () => {
      const listings = [fakeListing("a", at(20), null), fakeListing("b", at(21), at(22))];
      // A social with no listed end runs four hours by default (D-004): 20:00 + 4h.
      expect(latestEnd(listings)?.getTime()).toBe(at(0, 0, "2026-09-21").getTime());
    });
  });

  describe("hour markers (no empty hours)", () => {
    it("draws no row for an hour with nothing starting in it (D-147)", () => {
      const listings = [fakeListing("a", at(18, 30), at(20)), fakeListing("b", at(20), at(21))];
      const { rows } = buildTimeline({
        listings,
        now: at(18),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: false,
      });
      // The bill runs to the last START (20:00): an hour after it holds nothing to go to, and
      // the owner read a run of trailing empty rows as a broken page (2026-09-28).
      const shape = rows.map((row) => row.kind);
      expect(shape).toEqual(["hour", "card", "hour", "card"]);
      // No empty row at 19:00.
      expect(rows.map((r) => r.at)).toEqual([
        at(18).getTime(),
        at(18, 30).getTime(),
        at(20).getTime(),
        at(20).getTime(),
      ]);
    });

    it("gives a one-listing night its hour and no trailing empty hours", () => {
      const listings = [fakeListing("a", at(22), at(1, 0, "2026-09-21"))];
      const { rows } = buildTimeline({
        listings,
        now: at(22),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: false,
      });
      expect(rows.map((r) => r.kind)).toEqual(["hour", "card"]);
    });

    it("a bill with cards at 19:00 and 21:00 has row kinds hour, card, hour, card (no 20:00 row)", () => {
      const listings = [fakeListing("a", at(19), at(20)), fakeListing("b", at(21), at(22))];
      const { rows } = buildTimeline({
        listings,
        now: at(18),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: false,
      });
      expect(rows.map((r) => r.kind)).toEqual(["hour", "card", "hour", "card"]);
      // The hour markers are at 19:00 and 21:00
      // The cards are at 19:00 and 21:00
      expect(rows.map((r) => r.at)).toEqual([
        at(19).getTime(),
        at(19).getTime(),
        at(21).getTime(),
        at(21).getTime(),
      ]);
    });

    it("with now at 20:15 the now rule lands after the 19:00 card and before the 21:00 hour row", () => {
      const listings = [fakeListing("a", at(19), at(20)), fakeListing("b", at(21), at(22))];
      const { rows } = buildTimeline({
        listings,
        now: at(20, 15),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: true,
      });
      const kinds = rows.map((r) => r.kind);
      const nowIndex = kinds.indexOf("now");
      expect(nowIndex).toBeGreaterThan(-1);
      // With cards at 19:00 and 21:00, and no empty hour at 20:00:
      // hour(19), card(19), now, hour(21), card(21)
      expect(kinds).toEqual(["hour", "card", "now", "hour", "card"]);
      expect(rows[nowIndex - 1]?.kind).toBe("card");
      expect(rows[nowIndex + 1]?.kind).toBe("hour");
    });
  });

  describe("the now rule", () => {
    const rows = (): TimelineRow[] => [
      { kind: "hour", at: at(18).getTime(), key: "h18", label: "6pm" },
      {
        kind: "card",
        at: at(18, 30).getTime(),
        key: "c1",
        listing: fakeListing("c1", at(18, 30), at(23)),
        position: 1,
      },
      { kind: "hour", at: at(20).getTime(), key: "h20", label: "8pm" },
    ];

    it("sits between the last listing that has started and the first that has not", () => {
      // 19:42: after the 18:30 card, before the 20:00 hour
      expect(placeNowRule(rows(), at(19, 42).getTime())).toBe(2);
    });

    it("sits at the top of the bill when nothing has started yet", () => {
      expect(placeNowRule(rows(), at(17, 0).getTime())).toBe(0);
    });

    it("sits at the end when everything has started", () => {
      expect(placeNowRule(rows(), at(23, 0).getTime())).toBe(3);
    });

    it("inserts the now rule without removing any empty hour (none exist)", () => {
      const listings = [fakeListing("a", at(18, 30), at(23)), fakeListing("b", at(20), at(23))];
      const {
        rows: built,
        cardsAboveNow,
        nowLabel,
      } = buildTimeline({
        listings,
        now: at(19, 42),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: true,
      });
      // With no empty hours, the bill is: hour(18), card(18:30), hour(20), card(20)
      // Now at 19:42 goes between card(18:30) and hour(20)
      expect(built.map((r) => r.kind)).toEqual(["hour", "card", "now", "hour", "card"]);
      expect(cardsAboveNow).toBe(1);
      expect(nowLabel).toBe("7:42pm");
    });

    it("is not drawn at all on a future night, because there is no now on a future night", () => {
      const { rows: built, nowLabel } = buildTimeline({
        listings: [fakeListing("a", at(20), at(23))],
        now: at(19, 42),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: false,
      });
      expect(built.some((r) => r.kind === "now")).toBe(false);
      expect(nowLabel).toBeNull();
    });

    it("reports no cards above it when nothing has started, so first paint stays at the top", () => {
      const { cardsAboveNow } = buildTimeline({
        listings: [fakeListing("a", at(20), at(23))],
        now: at(19, 42),
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: true,
      });
      expect(cardsAboveNow).toBe(0);
    });
  });

  describe("the distance-sort collapse", () => {
    it("removes the rail, the markers and the now rule and leaves a plain list", () => {
      const listings = [fakeListing("a", at(18, 30), at(23)), fakeListing("b", at(21), at(23))];
      const { rows, nowLabel, cardsAboveNow } = buildTimeline({
        listings,
        now: at(19, 42),
        zone: ZONE,
        locale: LOCALE,
        sort: "distance",
        showNow: true,
      });
      expect(rows.every((r) => r.kind === "card")).toBe(true);
      expect(rows).toHaveLength(2);
      expect(nowLabel).toBeNull();
      expect(cardsAboveNow).toBe(0);
      // The positions are the list order, which is what a map pin's number prints.
      expect(rows.map((r) => (r.kind === "card" ? r.position : 0))).toEqual([1, 2]);
    });
  });

  describe("the rail's one time rule", () => {
    it("never prints the meridiem in the rail, where the hour marker above already says it", () => {
      expect(railStamp(at(22), ZONE, LOCALE, at(19, 42))).toBe("10:00");
      expect(railStamp(at(18, 30), ZONE, LOCALE, at(19, 42))).toBe("6:30");
      // After midnight the card sits under "12AM", so the 58px rail reads "12:30", not "12:30am".
      expect(railStamp(at(0, 30, "2026-09-21"), ZONE, LOCALE, at(19, 42))).toBe("12:30");
      expect(railStamp(at(1, 0, "2026-09-21"), ZONE, LOCALE, at(19, 42))).toBe("1:00");
    });

    it("off the rail, carries the meridiem across noon or midnight and always keeps the minutes", () => {
      const off = (instant: Date) => railStamp(instant, ZONE, LOCALE, at(19, 42), false);
      expect(off(at(22))).toBe("10:00");
      expect(off(at(0, 30, "2026-09-21"))).toBe("12:30am");
      // Never "9:00" beside "6pm" in one column (review, 2026-09-28).
      expect(off(at(1, 0, "2026-09-21"))).toBe("1:00am");
      expect(railStamp(at(9), ZONE, LOCALE, at(9), false)).toBe("9:00");
      expect(railStamp(at(18), ZONE, LOCALE, at(9), false)).toBe("6:00pm");
    });

    it("renders 19:42 in a 24-hour locale, meridiem rule or not", () => {
      expect(railStamp(at(19, 42), ZONE, "en-GB", at(19, 42))).toBe("19:42");
      expect(railStamp(at(0, 30, "2026-09-21"), ZONE, "de-DE", at(19, 42))).toBe("00:30");
    });
  });

  describe("on the New York seed, which is what mock mode serves", () => {
    const now = localInstant("2026-09-20", ZONE, 19, 42);

    it("builds a bill whose markers cover every hour between the first start and the last start", () => {
      const { listings } = seedNight(now);
      expect(listings.length).toBeGreaterThan(0);
      const { rows } = buildTimeline({
        listings,
        now,
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: true,
      });
      const hours = rows.filter((r) => r.kind === "hour");
      // The markers run over the timed listings only (D-060): from the first TIMED start.
      // But note: hours with no cards starting in them are not drawn (D-147)
      // So we need to count only hours that have cards starting in them
      const starts = listings.filter(hasStart).map((l) => l.startsAt.getTime());
      const first = new Date(Math.min(...starts));
      const last = new Date(Math.max(...starts));
      // Get all hour starts between first and last
      const allHourStarts = hourStarts(first, last, ZONE);
      // Filter to only those hours that have at least one card starting in them
      const byHour = new Map<number, number>();
      for (const listing of listings.filter(hasStart)) {
        const key = hourStart(listing.startsAt, ZONE).getTime();
        byHour.set(key, (byHour.get(key) || 0) + 1);
      }
      const hoursWithCards = allHourStarts.filter((hour) => byHour.has(hour.getTime()));
      expect(hours).toHaveLength(hoursWithCards.length);
      // Every card is on the bill; coverage is the product.
      expect(rows.filter((r) => r.kind === "card")).toHaveLength(listings.length);
    });

    it("puts every card above the now rule in the past and every one below it in the future", () => {
      const { listings } = seedNight(now);
      const { rows } = buildTimeline({
        listings,
        now,
        zone: ZONE,
        locale: LOCALE,
        sort: "start",
        showNow: true,
      });
      const ruleAt = rows.findIndex((r) => r.kind === "now");
      expect(ruleAt).toBeGreaterThanOrEqual(0);
      for (const [index, row] of rows.entries()) {
        if (row.kind !== "card") continue;
        const start = row.listing.startsAt;
        // A card whose time is not listed has no side of now; it sits under its heading, below.
        if (start === null) {
          expect(index).toBeGreaterThan(ruleAt);
          continue;
        }
        if (index < ruleAt) expect(start.getTime()).toBeLessThanOrEqual(now.getTime());
        else expect(start.getTime()).toBeGreaterThan(now.getTime());
      }
    });

    it("puts any untimed listing under the heading after the last hour, numbered on", () => {
      const { listings } = seedNight(now);
      const { rows } = bill(listings, now);
      const section = rows.findIndex((r) => r.kind === "section");
      const untimed = listings.filter((l) => l.startsAt === null);
      // Holds whether or not the seed carries an untimed listing tonight: when it does, every one
      // of them is under the heading, in the repository's order, and nothing timed is.
      if (untimed.length === 0) {
        expect(section).toBe(-1);
        return;
      }
      expect(section).toBeGreaterThan(rows.findLastIndex((r) => r.kind === "hour"));
      expect(section).toBeGreaterThan(rows.findIndex((r) => r.kind === "now"));
      expect(cardIds(rows.slice(section + 1))).toEqual(untimed.map((l) => l.id));
      const places = toMapPlaces(listings);
      for (const row of rows) {
        if (row.kind !== "card") continue;
        expect(places.find((p) => p.id === row.listing.id)?.number).toBe(row.position);
      }
    });
  });
});

describeInProcessZones("home timeline, listings whose time is not listed (D-060)", () => {
  // Two timed listings and two untimed ones, in the order the repository gives them under start
  // sort: timed by start, then untimed by distance, then slug (settled S3).
  const timedA = () => fakeListing("a", at(18, 30), at(20));
  const timedB = () => fakeListing("b", at(20), at(22));
  const near = () => fakeUntimed("near", { distanceKm: 0.8 });
  const far = () => fakeUntimed("far", { distanceKm: 4.1 });
  const night = () => [timedA(), timedB(), near(), far()];

  describe("under start sort", () => {
    it("opens a section after the last hour group and lists the untimed cards under it", () => {
      const { rows } = bill(night(), at(17), { showNow: false });
      expect(rows.map((r) => r.kind)).toEqual([
        "hour",
        "card",
        "hour",
        "card",
        "section",
        "card",
        "card",
      ]);
      expect(rows.find((r) => r.kind === "section")).toEqual({
        kind: "section",
        at: null,
        key: UNTIMED_SECTION_KEY,
        label: "Time not listed",
      });
      // In the order given, which is distance order: the repository's, not re-sorted here.
      expect(cardIds(rows)).toEqual(["a", "b", "near", "far"]);
    });

    it("numbers the untimed cards on after the timed ones, so a position is a pin number", () => {
      const listings = night();
      const { rows } = bill(listings, at(19, 42));
      const positions = rows.flatMap((r) =>
        r.kind === "card" ? [[r.listing.id, r.position]] : [],
      );
      expect(positions).toEqual([
        ["a", 1],
        ["b", 2],
        ["near", 3],
        ["far", 4],
      ]);
      const places = toMapPlaces(listings);
      for (const row of rows) {
        if (row.kind !== "card") continue;
        expect(places.find((p) => p.id === row.listing.id)?.number).toBe(row.position);
      }
    });

    it("gives an untimed card no instant, never an assumed hour", () => {
      const { rows } = bill(night(), at(19, 42));
      const untimed = rows.filter((r) => r.kind === "card" && r.listing.startsAt === null);
      expect(untimed).toHaveLength(2);
      for (const row of untimed) expect(row.at).toBeNull();
    });

    it("builds the hour markers from the timed listings only", () => {
      // An untimed listing whose listed end is 4am does not stretch the rail to 4am.
      const late = fakeUntimed("late", { endsAt: at(4, 0, "2026-09-21") });
      const { rows } = bill([timedA(), timedB(), late], at(17), { showNow: false });
      const hours = rows.filter((r) => r.kind === "hour").map((r) => r.at);
      // With cards at 18:30 and 20:00, and no empty hours drawn:
      // Only hours with cards starting in them are drawn: 18:00 and 20:00
      // 19:00 has no card starting in it, so no hour marker
      const expected = hourStarts(at(18, 30), at(20), ZONE)
        .map((h) => h.getTime())
        .filter((time) => {
          // Check if there's a card starting in this hour
          const hourHasCard = [timedA(), timedB()].some(
            (listing) => hourStart(listing.startsAt!, ZONE).getTime() === time,
          );
          return hourHasCard;
        });
      expect(hours).toEqual(expected);
      expect(hours.at(-1)).toBe(at(20).getTime());
    });

    it("sets the now rule among the timed rows, above the heading", () => {
      const { rows, cardsAboveNow, nowLabel } = bill(night(), at(19, 42));
      const ruleAt = rows.findIndex((r) => r.kind === "now");
      const section = rows.findIndex((r) => r.kind === "section");
      expect(ruleAt).toBeGreaterThan(0);
      expect(ruleAt).toBeLessThan(section);
      expect(cardsAboveNow).toBe(1);
      expect(nowLabel).toBe("7:42pm");
    });

    it("sits at the foot of the timed bill, never below the heading, once all has started", () => {
      const { rows, cardsAboveNow } = bill(night(), at(23, 30));
      const section = rows.findIndex((r) => r.kind === "section");
      expect(rows[section - 1]?.kind).toBe("now");
      expect(rows.slice(section).some((r) => r.kind === "now")).toBe(false);
      // Only timed cards count as above the rule: the first-paint scroll reads this number.
      expect(cardsAboveNow).toBe(2);
    });

    it("sits at the top of the bill when nothing timed has started yet", () => {
      const { rows, cardsAboveNow } = bill(night(), at(17));
      expect(rows[0]?.kind).toBe("now");
      expect(cardsAboveNow).toBe(0);
    });

    it("draws the timed part exactly as it would be drawn without the group", () => {
      for (const now of [at(17), at(19, 42), at(21, 15), at(23, 30)]) {
        const withGroup = bill(night(), now);
        const without = bill([timedA(), timedB()], now);
        const section = withGroup.rows.findIndex((r) => r.kind === "section");
        expect(withGroup.rows.slice(0, section).map((r) => r.key)).toEqual(
          without.rows.map((r) => r.key),
        );
        expect(withGroup.cardsAboveNow).toBe(without.cardsAboveNow);
        expect(withGroup.nowLabel).toBe(without.nowLabel);
      }
    });

    it("keeps a cancelled untimed listing in the group", () => {
      const cancelled = fakeUntimed("gone", {
        overrides: {
          confirmation: "cancelled",
          liveStatus: { kind: "cancelled", text: t("card.status.cancelled"), endNotListed: true },
        },
      });
      const { rows } = bill([timedA(), cancelled], at(19, 42));
      const section = rows.findIndex((r) => r.kind === "section");
      expect(cardIds(rows.slice(section + 1))).toEqual(["gone"]);
    });

    it("draws a night of untimed listings only as the heading and its cards: no hours, no now", () => {
      for (const showNow of [true, false]) {
        const { rows, nowLabel, cardsAboveNow } = bill([near(), far()], at(19, 42), { showNow });
        expect(rows.map((r) => r.kind)).toEqual(["section", "card", "card"]);
        expect(nowLabel).toBeNull();
        expect(cardsAboveNow).toBe(0);
        expect(rows.flatMap((r) => (r.kind === "card" ? [r.position] : []))).toEqual([1, 2]);
      }
    });

    it("draws nothing at all for an empty night", () => {
      expect(bill([], at(19, 42))).toEqual({ rows: [], cardsAboveNow: 0, nowLabel: null });
    });

    it("follows the doubled hour of a DST night with the group", () => {
      // 1 November 2026, New York: 2am EDT falls back to 1am EST, so the night of 31 October has
      // two 1am hours. The rail walks the wall clock (hourStarts), so 1am is one marker; what is
      // under test is that the untimed listing changes none of it and follows it.
      const day = "2026-10-31";
      const start = localInstant(day, ZONE, 22);
      const end = new Date("2026-11-01T06:30:00Z"); // 1:30am EST, the second 1am
      const timed = fakeListing("late", start, end, { nightDate: day });
      // An untimed listing with a listed end past midnight, inside the first 1am.
      const untimed = fakeUntimed("undated-hour", {
        nightDate: day,
        endsAt: new Date("2026-11-01T05:30:00Z"),
      });
      const before = localInstant(day, ZONE, 21);
      const { rows } = bill([timed, untimed], before, { showNow: false });
      const alone = bill([timed], before, { showNow: false }).rows;
      const labels = rows.flatMap((r) => (r.kind === "hour" ? [r.label] : []));
      // The markers stop at the last start (10pm); the untimed listing's late end adds none.
      expect(labels).toEqual(["10pm"]);
      expect(rows.slice(0, alone.length)).toEqual(alone);
      expect(rows.slice(alone.length).map((r) => r.kind)).toEqual(["section", "card"]);
      expect(rows.at(-1)?.key).toBe("undated-hour");
      // After the fall-back, with the whole timed bill behind now, the rule still stops above.
      const late = bill([timed, untimed], new Date("2026-11-01T06:45:00Z"));
      expect(late.nowLabel).toBe("1:45am");
      expect(late.rows.at(-3)?.kind).toBe("now");
      expect(late.cardsAboveNow).toBe(1);
    });

    it("treats the section head as the end of the range placeNowRule may use", () => {
      const rows: TimelineRow[] = [
        { kind: "hour", at: at(20).getTime(), key: "h20", label: "8pm" },
        { kind: "card", at: at(20).getTime(), key: "c1", listing: timedB(), position: 1 },
        { kind: "section", at: null, key: UNTIMED_SECTION_KEY, label: "Time not listed" },
        { kind: "card", at: null, key: "u1", listing: near(), position: 2 },
      ];
      expect(placeNowRule(rows, at(19).getTime())).toBe(0);
      expect(placeNowRule(rows, at(21).getTime())).toBe(2);
    });
  });

  describe("under distance sort", () => {
    it("keeps untimed cards in their distance place, with no section and no instant", () => {
      const listings = [near(), timedA(), far(), timedB()];
      const { rows, nowLabel } = bill(listings, at(19, 42), { sort: "distance" });
      expect(rows.every((r) => r.kind === "card")).toBe(true);
      expect(cardIds(rows)).toEqual(["near", "a", "far", "b"]);
      expect(rows.map((r) => r.at)).toEqual([null, at(18, 30).getTime(), null, at(20).getTime()]);
      expect(rows.map((r) => (r.kind === "card" ? r.position : 0))).toEqual([1, 2, 3, 4]);
      expect(nowLabel).toBeNull();
    });
  });

  describe("the rail's references", () => {
    it("reads the meridiem against now tonight and 8pm on any other night, whatever is listed", () => {
      expect(meridiemReference("2026-09-20", ZONE, at(19, 42), true).getTime()).toBe(
        at(19, 42).getTime(),
      );
      expect(meridiemReference("2026-09-20", ZONE, at(19, 42), false).getTime()).toBe(
        at(20).getTime(),
      );
    });

    it("leaves untimed listings out of the latest end, listed end or not", () => {
      const lateEnd = fakeUntimed("x", { endsAt: at(4, 0, "2026-09-21") });
      expect(latestEnd([near(), lateEnd])).toBeNull();
      expect(latestEnd([timedA(), lateEnd])).toEqual(at(20));
    });

    it("tells a timed listing from an untimed one by its start alone", () => {
      expect(hasStart(timedA())).toBe(true);
      expect(hasStart(near())).toBe(false);
    });
  });
});

/** Visible text of static markup: tags dropped (aria-label with them), text runs joined by " / ". */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "|")
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" / ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&");
}

const RENDER_NOW = localInstant("2026-09-20", ZONE, 19, 42);

/**
 * The card's own link, the whole-card <a> to its page: the event line after it is a second link
 * and is not part of the card's text (DESIGN section 5, D-073).
 */
function cardLink(html: string): string {
  return /^<a href="\/e\/[^"]*"[^>]*>.*?<\/a>/.exec(html)?.[0] ?? "";
}

function renderCard(listing: Listing, railed = listing.startsAt !== null): string {
  return renderToStaticMarkup(
    createElement(Card, {
      listing,
      // The same stamp app/page.tsx gives a card.
      stamp:
        listing.startsAt === null
          ? t("card.stamp.timeNotListed")
          : railStamp(listing.startsAt, ZONE, LOCALE, RENDER_NOW),
      formatClock: (instant: Date) => formatTime(instant, ZONE, LOCALE),
      now: RENDER_NOW,
      locale: LOCALE,
      railed,
    }),
  );
}

describe("the card of a listing whose time is not listed (D-060)", () => {
  const untimed = () =>
    fakeUntimed("brooklyn-social", {
      overrides: { title: "Brooklyn Social", confirmation: "confirmed_today" },
    });

  it("stamps the phrase as its first inline element, small, with no rail", () => {
    const html = renderCard(untimed(), false);
    // The family line sits between the stamp and the name (D-147).
    expect(visibleText(html).startsWith("Time not listed / ")).toBe(true);
    expect(visibleText(html)).toContain("Brooklyn Social");
    expect(html).toContain('<span class="type-stamp-sm">Time not listed</span>');
    expect(html).not.toContain("grid-cols-rail");
  });

  it("refuses the rail even when a caller asks for one, since the phrase cannot fit the rail", () => {
    const html = renderCard(untimed(), true);
    expect(html).not.toContain("grid-cols-rail");
    expect(html).toContain('<span class="type-stamp-sm">Time not listed</span>');
  });

  it("carries no status line, because the stamp already says it", () => {
    const text = visibleText(renderCard(untimed(), false));
    expect(text.split("Time not listed")).toHaveLength(2);
    const withEnd = fakeUntimed("until", { endsAt: localInstant("2026-09-21", ZONE, 2) });
    expect(visibleText(renderCard(withEnd, false))).not.toContain("until 2am");
  });

  it("is named by its stamp and its name, with no dangling comma", () => {
    expect(renderCard(untimed(), false)).toContain('aria-label="Time not listed, Brooklyn Social"');
  });

  it("never names a confirming page; it says Check before you go", () => {
    // Read from the card's own link: its event line follows it, outside it (D-073).
    const text = visibleText(cardLink(renderCard(untimed(), false)));
    expect(text).not.toContain("On the organizer's page");
    expect(text).not.toContain("On the ticket page");
    expect(text.endsWith("Check before you go")).toBe(true);
    for (const confirmation of [
      "confirmed_today",
      "recurring_unconfirmed",
      "conflicting",
      "cancelled",
    ] as const) {
      expect(confirmationLine({ ...untimed(), confirmation }, RENDER_NOW, LOCALE)).toBe(
        "Check before you go",
      );
    }
  });

  it("still says Cancelled tonight when cancelled, and strikes nothing through", () => {
    const cancelled = fakeUntimed("gone", {
      overrides: {
        title: "Gone Tonight",
        confirmation: "cancelled",
        liveStatus: { kind: "cancelled", text: t("card.status.cancelled"), endNotListed: true },
      },
    });
    const html = renderCard(cancelled, false);
    expect(visibleText(html)).toContain("Cancelled tonight");
    expect(html).not.toContain("line-through");
    expect(html).toContain('aria-label="Time not listed, Gone Tonight, cancelled"');
  });

  it("shows no Ended line: Cancelled tonight is the only status an untimed card carries (D-060)", () => {
    const ended = fakeUntimed("done", {
      overrides: {
        liveStatus: { kind: "ended", text: t("card.status.ended"), endNotListed: true },
      },
    });
    const html = renderCard(ended, false);
    expect(visibleText(html)).not.toContain("Ended");
    expect(html).toContain('aria-label="Time not listed, done"');
  });

  it("leaves a timed card as it was: railed, named with its status, struck when cancelled", () => {
    const timed = fakeListing("salsa", at(20), at(23), {
      liveStatus: { kind: "upcoming", text: "Starts in 18 min, until 11pm", endNotListed: false },
    });
    const html = renderCard(timed);
    expect(html).toContain("grid-cols-rail");
    expect(html).toContain('aria-label="8:00, salsa, Starts in 18 min, until 11pm"');
    // Checked lines live on the event page now, not the card (D-147).
    expect(visibleText(html)).not.toContain("On the organizer's page, checked 2h ago");
    expect(renderCard({ ...timed, confirmation: "cancelled" })).toContain("line-through");
    // A timed card with no status line is named without a dangling comma too.
    expect(renderCard({ ...timed, liveStatus: null })).toContain('aria-label="8:00, salsa"');
  });

  it("rendering Card with repeatStamp: true and railed: true gives invisible and aria-hidden around the stamp", () => {
    const timed = fakeListing("salsa", at(20), at(23));
    const html = renderToStaticMarkup(
      createElement(Card, {
        listing: timed,
        stamp: "8:00",
        formatClock: (instant: Date) => formatTime(instant, ZONE, LOCALE),
        now: RENDER_NOW,
        locale: LOCALE,
        railed: true,
        repeatStamp: true,
      }),
    );
    expect(html).toContain('<span class="invisible" aria-hidden="true">');
    // The StampedTime component renders as <span class="type-stamp">8:00</span>
    // So we should check for that instead
    expect(html).toContain('<span class="type-stamp">8:00</span>');
  });
});

describe("the card's event line: one link out, after the card's link (D-073)", () => {
  const listed: ListingSource = {
    url: "https://steppingoutstudios.com/social-events1",
    label: "steppingoutstudios.com/social-events1",
    checkedAt: new Date(RENDER_NOW.getTime() - 3_600_000),
    byOrganiser: true,
    tier: "organizer",
    eventUrl: null,
  };
  const ronda: ListingSource = {
    url: "https://www.theronda.us/nyc",
    label: "theronda.us/nyc",
    checkedAt: new Date(RENDER_NOW.getTime() - 3_600_000),
    byOrganiser: false,
    tier: "listing",
    eventUrl: "https://www.theronda.us/event/tango-cafe-2026-09-30-ac9076",
  };
  const timed = (overrides: Partial<Listing>) =>
    fakeListing("tango-cafe", at(20), at(23), { title: "Tango Cafe", ...overrides });

  /** Everything after the card's own link: the event line's wrapper, or nothing. */
  const afterCard = (html: string) => html.slice(cardLink(html).length);

  it("follows the card's link as its sibling, in a <div>, never inside it", () => {
    const html = renderCard(timed({ sources: [ronda] }));
    expect(cardLink(html)).not.toContain('target="_blank"');
    expect(cardLink(html)).not.toContain("Event page at");
    const rest = afterCard(html);
    expect(rest.startsWith("<div")).toBe(true);
    expect(rest.match(/<a /g)).toHaveLength(1);
    expect(rest).toContain('href="https://www.theronda.us/event/tango-cafe-2026-09-30-ac9076"');
    expect(rest).toContain('target="_blank"');
    expect(rest).toContain('rel="noreferrer"');
    expect(visibleText(rest)).toBe("Event page at theronda.us");
  });

  it("is named for the night it is about and the new tab it opens (WCAG 2.4.4, 3.2.5)", () => {
    const html = renderCard(timed({ sources: [ronda] }));
    expect(afterCard(html)).toContain(
      'aria-label="Event page at theronda.us, Tango Cafe, opens in a new tab"',
    );
  });

  it("says Tickets for a page selling the night, and Listed on for a page that only lists it", () => {
    const selling = renderCard(
      timed({
        ticketUrl: "https://www.eventbrite.com/e/tango-cafe-tickets-123",
        sources: [listed],
      }),
    );
    expect(visibleText(afterCard(selling))).toBe("Tickets at eventbrite.com");
    const onlyListed = afterCard(renderCard(timed({ sources: [listed] })));
    expect(visibleText(onlyListed)).toBe("Listed on steppingoutstudios.com");
    expect(onlyListed).toContain(
      'href="https://steppingoutstudios.com/social-events1#:~:text=Tango%20Cafe"',
    );
  });

  it("sits in the name's column: on the rail from 20rem, in the one column off it", () => {
    const railed = afterCard(renderCard(timed({ sources: [ronda] })));
    expect(railed).toContain("min-[20rem]:grid-cols-rail");
    expect(railed).toContain("min-[20rem]:col-start-2");
    const offRail = afterCard(
      renderCard(fakeUntimed("u", { overrides: { sources: [ronda] } }), false),
    );
    expect(offRail).not.toContain("col-start-2");
    expect(offRail).not.toContain("grid-cols-rail");
  });

  it("is toner, a 44px target, and wraps a long host rather than overflowing", () => {
    const line = afterCard(renderCard(timed({ sources: [ronda] })));
    expect(line).toContain("text-toner");
    expect(line).not.toContain("text-spot");
    expect(line).toContain("min-h-11");
    expect(line).toContain("wrap-anywhere");
    expect(line).toContain("type-secondary");
  });

  it("draws nothing for a listing with no source, and the card keeps its full padding", () => {
    const html = renderCard(timed({ sources: [] }));
    expect(afterCard(html)).toBe("");
    expect(cardLink(html)).toContain("pb-3");
    expect(cardLink(renderCard(timed({ sources: [ronda] })))).toContain("pb-1");
  });

  it("says Event page, never Tickets, for a cancelled night's ticket page", () => {
    const html = renderCard(
      timed({
        confirmation: "cancelled",
        ticketUrl: "https://www.eventbrite.com/e/tango-cafe-tickets-123",
        sources: [listed],
      }),
    );
    expect(visibleText(afterCard(html))).toBe("Event page at eventbrite.com");
  });
});

describe("the confirmation line says where the listing was checked (D-061, D-072)", () => {
  const hoursAgo = (hours: number) => new Date(RENDER_NOW.getTime() - hours * 3_600_000);
  const organizerSource: ListingSource = {
    url: "https://organiser.example/nights",
    label: "organiser.example",
    checkedAt: hoursAgo(2),
    byOrganiser: true,
    tier: "organizer",
    eventUrl: null,
  };
  const ticketSource: ListingSource = {
    url: "https://www.ticketweb.com/event/night",
    label: "ticketweb.com/event/night",
    checkedAt: hoursAgo(3),
    byOrganiser: true,
    tier: "ticketing",
    eventUrl: null,
  };
  const directorySource: ListingSource = {
    url: "https://theronda.us/nyc",
    label: "theronda.us/nyc",
    checkedAt: hoursAgo(1),
    byOrganiser: false,
    tier: "listing",
    eventUrl: null,
  };
  const line = (sources: ListingSource[], overrides: Partial<Listing> = {}) =>
    confirmationLine(
      { ...fakeListing("night", at(20), at(23)), sources, ...overrides },
      RENDER_NOW,
      LOCALE,
    );

  it("names the organizer's own page, with when it was checked", () => {
    expect(line([organizerSource])).toBe("On the organizer's page, checked 2h ago");
  });

  it("names a ticket seller's page as the ticket page, never as the organizer", () => {
    expect(line([ticketSource])).toBe("On the ticket page, checked 3h ago");
  });

  it("says only when a directory's listing was checked, never that a page confirmed it", () => {
    expect(line([directorySource])).toBe("Listing checked 1h ago");
  });

  it("names the organizer's page before the ticket page, each with its own check", () => {
    expect(line([directorySource, ticketSource, organizerSource])).toBe(
      "On the organizer's page, checked 2h ago",
    );
    expect(line([directorySource, ticketSource])).toBe("On the ticket page, checked 3h ago");
  });

  it("keeps the other rules: untimed, conflicting and never-seen lines are unchanged", () => {
    expect(line([organizerSource], { startsAt: null, dancingAt: null })).toBe(
      "Check before you go",
    );
    expect(line([directorySource], { confirmation: "conflicting" })).toBe(
      "Sources disagree on the times",
    );
    expect(line([], { confirmation: "recurring_unconfirmed" })).toBe("Not confirmed for tonight");
    // Not confirmed for tonight: the organizer's page was read, but it did not confirm the night.
    expect(line([organizerSource], { confirmation: "recurring_unconfirmed" })).toBe(
      "Listing checked 2h ago",
    );
  });

  it("reads the phrases from en.ts", () => {
    expect(t("card.flags.onOrganizerPage", { ago: "2h ago" })).toBe(
      "On the organizer's page, checked 2h ago",
    );
    expect(t("card.flags.onTicketPage", { ago: "2h ago" })).toBe(
      "On the ticket page, checked 2h ago",
    );
    expect(t("card.flags.listingChecked", { ago: "2h ago" })).toBe("Listing checked 2h ago");
  });
});

describe("the bill with a Time not listed group, rendered (D-060)", () => {
  function render(sort: "start" | "distance"): string {
    const listings = [
      fakeListing("a", at(18, 30), at(20)),
      fakeListing("b", at(20), at(22)),
      fakeUntimed("near", { distanceKm: 0.8 }),
    ];
    const { rows } = bill(listings, RENDER_NOW, { sort });
    const reference = meridiemReference("2026-09-20", ZONE, RENDER_NOW, true);
    return renderToStaticMarkup(
      createElement(TimelineList, {
        rows,
        stampFor: (listing: Listing) =>
          listing.startsAt === null
            ? t("card.stamp.timeNotListed")
            : railStamp(listing.startsAt, ZONE, LOCALE, reference),
        formatClock: (instant: Date) => formatTime(instant, ZONE, LOCALE),
        now: RENDER_NOW,
        locale: LOCALE,
        railed: sort === "start",
      }),
    );
  }

  it("heads the group with an h2 whose visible text is its accessible text, after the hours", () => {
    const headings = [...render("start").matchAll(/<h2[^>]*>(.*?)<\/h2>/g)].map((m) => m[1] ?? "");
    const last = headings.at(-1) ?? "";
    expect(visibleText(last)).toBe("Time not listed");
    // No aria-hidden label and no screen-reader-only twin: what is seen is what is heard.
    expect(last).not.toContain("sr-only");
    expect(last).toContain('<span class="type-marker text-toner">Time not listed</span>');
    // Every earlier h2 is an hour marker, named by the hour it shows and nothing else: "Starting
    // at 8pm" over an hour where nothing started was untrue (review, 2026-09-28).
    expect(headings.length).toBeGreaterThan(1);
    for (const heading of headings.slice(0, -1)) {
      expect(heading).toMatch(/<span class="type-marker text-toner">\d{1,2}(am|pm)<\/span>/);
      expect(heading).not.toContain("sr-only");
      expect(heading).not.toContain("Starting at");
    }
  });

  it("puts the now rule above the heading and draws the untimed card without a rail", () => {
    const html = render("start");
    const rule = html.indexOf('role="separator"');
    const heading = html.lastIndexOf("<h2");
    expect(rule).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(heading);
    const below = html.slice(heading);
    expect(below).toContain('href="/e/near"');
    expect(below).not.toContain("grid-cols-rail");
    // The heading already says it: the grouped card does not print the phrase a second time,
    // and keeps it in its accessible name (the owner saw it twice, 2026-09-28).
    expect(visibleText(below).split("Time not listed")).toHaveLength(2);
    expect(below).not.toContain('<span class="type-stamp-sm">Time not listed</span>');
    expect(below).toContain('aria-label="Time not listed, near"');
    // The timed cards above it keep the rail.
    expect(html.slice(0, heading)).toContain("grid-cols-rail");
  });

  it("draws no heading under distance sort, just the phrase in the card's stamp slot", () => {
    const html = render("distance");
    expect(html).not.toContain("<h2");
    expect(html).toContain('<span class="type-stamp-sm">Time not listed</span>');
  });
});

describe("home URL state", () => {
  const now = localInstant("2026-09-20", ZONE, 19, 42);

  it("defaults to tonight, all kinds, start-time order and the list", () => {
    const query = parseHomeParams({}, now, ZONE);
    expect(query.nightDate).toBe("2026-09-20");
    expect(query.isTonight).toBe(true);
    expect(query.segment).toBe("all");
    expect(query.sort).toBe("start");
    expect(query.view).toBe("list");
    expect(query.sheetOpen).toBe(false);
    expect(query.filters).toEqual({});
  });

  it("reads every filter the repository's ListingFilters names", () => {
    const query = parseHomeParams(
      {
        t: "clubs",
        f: "salsa,swing",
        price: "20",
        lvl: "1",
        lesson: "1",
        np: "1",
        age: "21",
        live: "1",
        now: "1",
        conf: "1",
        r: "10",
        sort: "distance",
        view: "map",
        filters: "1",
      },
      now,
      ZONE,
    );
    expect(query.filters).toEqual({
      types: ["club_night"],
      families: ["salsa", "swing"],
      maxPrice: 20,
      beginnerFriendly: true,
      lessonIncluded: true,
      noPartnerNeeded: true,
      age: 21,
      liveMusic: true,
      onNow: true,
      confirmedOnly: true,
    });
    expect(query.radiusKm).toBe(10);
    expect(query.sort).toBe("distance");
    expect(query.view).toBe("map");
    expect(query.sheetOpen).toBe(true);
    expect(activeFilterCount(query)).toBe(9);
  });

  it("treats price=free as the free filter, not as a ceiling of zero", () => {
    const query = parseHomeParams({ price: "free" }, now, ZONE);
    expect(query.filters.free).toBe(true);
    expect(query.filters.maxPrice).toBeUndefined();
  });

  it("marks a future night as not tonight, which is what drops the now rule", () => {
    const query = parseHomeParams({ day: "2026-09-22" }, now, ZONE);
    expect(query.nightDate).toBe("2026-09-22");
    expect(query.isTonight).toBe(false);
  });

  it("ignores nonsense rather than throwing, because a URL is a hostile input", () => {
    const query = parseHomeParams(
      { day: "yesterday", t: "disco", f: "salsa,nope", r: "-3", lat: "999", sort: "random" },
      now,
      ZONE,
    );
    expect(query.nightDate).toBe("2026-09-20");
    expect(query.segment).toBe("all");
    expect(query.filters.families).toEqual(["salsa"]);
    expect(query.radiusKm).toBe(DEFAULT_RADIUS_KM);
    expect(query.centerFromUrl).toBe(false);
    expect(query.sort).toBe("start");
  });

  it("reads a centre from the URL only when both halves of it are sane", () => {
    expect(parseCenter({ lat: "40.7", lng: "-74.0" })).toEqual({ lat: 40.7, lng: -74 });
    expect(parseCenter({ lat: "40.7" })).toBeNull();
    expect(parseCenter({ lat: "91", lng: "0" })).toBeNull();
  });

  it("keeps params it does not know about, so a link never drops someone else's state", () => {
    expect(hrefWith({ day: "2026-09-21", ref: "poster" }, { sort: "distance" })).toBe(
      "/?day=2026-09-21&ref=poster&sort=distance",
    );
    expect(hrefWith({ sort: "distance" }, { sort: null })).toBe("/");
  });

  it("toggles a family chip on and off", () => {
    expect(toggleFamilyHref({}, [], "salsa")).toBe("/?f=salsa");
    expect(toggleFamilyHref({ f: "salsa" }, ["salsa"], "swing")).toBe("/?f=salsa%2Cswing");
    expect(toggleFamilyHref({ f: "salsa,swing" }, ["salsa", "swing"], "salsa")).toBe("/?f=swing");
  });

  it("carries the params a form does not own as hidden inputs", () => {
    expect(carriedParams({ day: "2026-09-21", price: "20" }, ["price"])).toEqual([
      ["day", "2026-09-21"],
    ]);
  });

  it("keeps only known keys out of a comma list", () => {
    expect(parseList("salsa,,swing,salsa,nope", FAMILY_KEYS)).toEqual(["salsa", "swing"]);
    expect(parseList(null, FAMILY_KEYS)).toEqual([]);
  });

  it("partitions every listing type across the segmented control exactly once", () => {
    const covered = SEGMENTS.filter((s) => s !== "all").flatMap((s) => [...SEGMENT_TYPES[s]]);
    expect([...covered].sort()).toEqual([...LISTING_TYPE_KEYS].sort());
    expect(new Set(covered).size).toBe(covered.length);
  });
});

describe("home values", () => {
  it("formats distance in the locale's own unit", () => {
    expect(formatDistance(1.93, "en-US")).toBe("1.2 mi");
    expect(formatDistance(1.93, "de-DE")).toBe("1,9 km");
  });

  it("rounds a radius choice to whole units, so it reads as a choice not a measurement", () => {
    expect(formatRadius(5, "en-US")).toBe("3 mi");
    expect(formatRadius(40, "en-US")).toBe("25 mi");
    expect(formatRadius(40, "de-DE")).toBe("40 km");
  });

  it("formats money without inventing cents", () => {
    expect(formatMoney(15, "USD", "en-US")).toBe("$15");
    expect(formatMoney(12.5, "USD", "en-US")).toBe("$12.50");
  });

  it("prints the venue with its neighbourhood, and without when none is listed", () => {
    const listing = fakeListing("a", at(20), at(23));
    expect(venueLine(listing)).toBe("A hall, SoHo");
    expect(venueLine({ ...listing, venue: { ...listing.venue!, neighborhood: null } })).toBe(
      "A hall",
    );
  });
});

describe("timing constants", () => {
  it("uses the domain's own minute and hour, not its own copies", () => {
    expect(MINUTE_MS).toBe(60_000);
    expect(HOUR_MS).toBe(3_600_000);
  });
});

describe("the look-C card (D-147)", () => {
  const timed = () => fakeListing("salsa", at(20), at(23));

  it("prints the family line before the name, beside a bar in the family's colour", () => {
    const html = renderCard(timed());
    const family = html.indexOf("text-stock-salsa");
    expect(family).toBeGreaterThan(-1);
    expect(family).toBeLessThan(html.indexOf("type-card-name"));
    expect(html).toContain("border-s-3");
    expect(html).toContain("border-stock-salsa");
  });

  it("joins venue, distance and price in one toner line, and shows no checked line", () => {
    const html = renderCard(timed());
    expect(html).toMatch(/<p class="type-secondary text-toner mt-0\.5">.*·.*<\/p>/);
    expect(visibleText(html)).not.toMatch(/checked/);
  });

  it("warns only when a dancer must check before going", () => {
    expect(cardWarning(timed())).toBeNull();
    expect(cardWarning({ ...timed(), confirmation: "conflicting" })).toBe(
      t("card.flags.sourcesDisagree"),
    );
    expect(cardWarning(fakeUntimed("x", {}))).toBe(t("card.flags.checkBeforeYouGo"));
  });
});
