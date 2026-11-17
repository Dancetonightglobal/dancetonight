import { expect, it } from "vitest";

import {
  FAMILY_KEYS,
  LISTING_TYPE_KEYS,
  familyOf,
  isStyleKey,
  normalizeForMatch,
} from "@/config/styles";
import { haversineKm } from "@/src/data/listing-mapper";
import { NYC_METRO, ONE_OFFS, SERIES, VENUES } from "@/src/db/seed/nyc-data";
import {
  MATERIALIZE_DAYS,
  NYC_METRO_ID,
  isoWeekday,
  ruleToRrule,
  seedNyc,
} from "@/src/db/seed/nyc";
import { TZDate } from "@date-fns/tz";
import { recurrenceText } from "@/src/domain/recurrence";
import { HOUR_MS, addCalendarDays, localInstant } from "@/src/domain/time";
import {
  currentNightDate,
  isTonight,
  nightDate,
  nightWindow,
  startsAt,
} from "@/src/domain/tonight";
import { describeInProcessZones } from "./processZone";

const NY = "America/New_York";
/** Sunday 20 September 2026, 7:42pm in New York. */
const SUNDAY_EVENING = new Date("2026-09-20T23:42:00Z");
/** The point the mock repository tests query from, at their 25 km radius. */
const WILLIAMSBURG = { lat: 40.7081, lng: -73.9571 };

type SeedEvent = ReturnType<typeof seedNyc>["events"][number];

/** A row whose source gives its night and no time (D-060): doors, lesson and dancing all null. */
const isUntimed = (e: SeedEvent): boolean => startsAt(e) === null;

/** The tonight rule's facts for a row with a start. Rows with no time are checked by night date. */
const timed = (e: SeedEvent) => {
  const start = startsAt(e);
  if (start === null) throw new Error(`${e.slug} has no start time; pass timed rows only`);
  return {
    startsAt: start,
    endsAt: e.endsAt,
    listingType: e.listingType,
    cancelled: e.confirmation === "cancelled",
  };
};

/** The seed's one-offs whose source gives the night and no time. */
const UNTIMED_ONE_OFFS = ONE_OFFS.filter((d) => d.time === null);

/** Provenance fields that would state a start; a row with no time has none of them. */
const START_FIELDS = ["doorsAt", "lessonAt", "dancingAt", "startsAt"];

/** The event a one-off definition built, found by its slug (the slug is `<def slug>-<night>`). */
function eventOf(seed: ReturnType<typeof seedNyc>, defSlug: string): SeedEvent {
  const event = seed.events.find(
    (e) => e.slug === `${defSlug}-${e.nightDate}` && e.seriesId === null,
  );
  if (!event) throw new Error(`no seed event for one-off ${defSlug}`);
  return event;
}

/** The definition slug of a seed row: its slug without the "-YYYY-MM-DD" night suffix. */
const defSlugOf = (e: SeedEvent): string => e.slug.slice(0, -"-YYYY-MM-DD".length);

describeInProcessZones("seedNyc: shape and invariants", () => {
  const seed = seedNyc(SUNDAY_EVENING);

  it("is one metro with about 30 real venues, organizers and sources", () => {
    expect(seed.metro.slug).toBe("nyc");
    expect(seed.metro.id).toBe(NYC_METRO_ID);
    expect(seed.metro.tz).toBe(NY);
    expect(seed.metro.languages).toEqual(["en", "es"]);
    expect(seed.venues.length).toBeGreaterThanOrEqual(30);
    expect(seed.organizers.length).toBeGreaterThanOrEqual(20);
    expect(seed.sources.length).toBeGreaterThanOrEqual(20);
    expect(seed.series.length).toBeGreaterThanOrEqual(30);
    expect(seed.events.length).toBeGreaterThanOrEqual(45);
  });

  it("puts every venue inside the metro radius", () => {
    for (const venue of seed.venues) {
      const distance = haversineKm(NYC_METRO.center, {
        lat: venue.location.lat,
        lng: venue.location.lng,
      });
      expect(distance, venue.name).toBeLessThanOrEqual(NYC_METRO.radiusKm);
      expect(venue.tz).toBe(NY);
      expect(venue.metroId).toBe(NYC_METRO_ID);
    }
    const localities = new Set(VENUES.map((v) => v.locality));
    expect(localities).toContain("Hoboken");
    expect(localities).toContain("Jersey City");
    expect(localities).toContain("Brooklyn");
    expect(localities).toContain("Queens");
  });

  it("uses one shared venue row for 239 W 14th St (blues on Fridays, tango on Thursdays)", () => {
    const rows = seed.venues.filter((v) => v.address?.line1 === "239 W 14th St");
    expect(rows).toHaveLength(1);
    const venueId = rows[0]?.id;
    const organizersThere = new Set(
      seed.events.filter((e) => e.venueId === venueId).map((e) => e.organizerId),
    );
    expect(organizersThere.size).toBeGreaterThanOrEqual(2);
  });

  it("stores only valid taxonomy keys in styles[] everywhere", () => {
    const styleLists = [
      ...seed.events.map((e) => e.styles),
      ...seed.series.map((s) => s.styles),
      ...seed.organizers.map((o) => o.styles),
      ...seed.sources.map((s) => s.styles ?? []),
    ];
    for (const styles of styleLists) {
      for (const style of styles) expect(isStyleKey(style), style).toBe(true);
    }
    for (const event of seed.events) expect(event.styles.length).toBeGreaterThan(0);
  });

  it("covers at least 10 of the 13 families and at least 6 listing types", () => {
    const families = new Set<string>();
    const types = new Set<string>();
    for (const event of seed.events) {
      for (const style of event.styles) if (isStyleKey(style)) families.add(familyOf(style));
      types.add(event.listingType);
    }
    expect(families.size).toBeGreaterThanOrEqual(10);
    for (const family of families) expect(FAMILY_KEYS).toContain(family);
    expect(types.size).toBeGreaterThanOrEqual(6);
    for (const type of types) expect(LISTING_TYPE_KEYS).toContain(type);
  });

  it("has deterministic ids, unique slugs, normalised titles and no generated column", () => {
    const again = seedNyc(SUNDAY_EVENING);
    expect(again.events.map((e) => e.id)).toEqual(seed.events.map((e) => e.id));
    expect(again.venues.map((v) => v.id)).toEqual(seed.venues.map((v) => v.id));
    expect(new Set(seed.events.map((e) => e.id)).size).toBe(seed.events.length);
    expect(new Set(seed.events.map((e) => e.slug)).size).toBe(seed.events.length);
    for (const event of seed.events) {
      expect(event.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(event.titleNormalized).toBe(normalizeForMatch(event.title));
      expect("startsAt" in event).toBe(false);
    }
    // Only the one-offs defined with no time have no start (D-060); every other row has one.
    const untimedSlugs = seed.events.filter(isUntimed).map(defSlugOf).sort();
    expect(untimedSlugs).toEqual(UNTIMED_ONE_OFFS.map((d) => d.slug).sort());
    // A different day keeps series ids and slugs stable per night.
    const later = seedNyc(new Date(SUNDAY_EVENING.getTime() + 24 * HOUR_MS));
    const laterIds = new Set(later.events.map((e) => e.id));
    const overlap = seed.events.filter((e) => laterIds.has(e.id));
    expect(overlap.length).toBeGreaterThan(seed.events.length / 2);
  });

  it("writes night_date through tonight.ts for every timed event, and as listed for one with no time", () => {
    for (const event of seed.events) {
      const start = startsAt(event);
      if (start === null) {
        const def = UNTIMED_ONE_OFFS.find((d) => d.slug === defSlugOf(event));
        if (!def) throw new Error(`${event.slug} has no start and no one-off defined without one`);
        expect(event.nightDate).toBe(addCalendarDays(seed.tonight, def.daysFromNow));
      } else {
        expect(event.nightDate).toBe(nightDate(start, NY));
      }
      expect(event.tz).toBe(NY);
      // A listing whose source names no place has no point and no venue (D-082); every other has both.
      expect(event.geo === null, event.slug).toBe(event.venueId === null);
      expect(event.metroId).toBe(NYC_METRO_ID);
    }
    const nights = new Set(seed.events.map((e) => e.nightDate));
    expect(nights.size).toBe(MATERIALIZE_DAYS);
    expect([...nights].sort()[0]).toBe(seed.tonight);
  });

  it("materialises the monthly series on the right Saturdays", () => {
    const monthly = SERIES.filter((s) => s.rule.kind === "monthly");
    expect(monthly.map((s) => s.slug).sort()).toEqual([
      "big-apple-ranch",
      "millennium-hustle",
      "milonga-barrilito",
    ]);
    // Six weeks of seeds catch every ordinal at least once.
    for (let week = 0; week < 6; week++) {
      const now = new Date(SUNDAY_EVENING.getTime() + week * 7 * 24 * HOUR_MS);
      const s = seedNyc(now);
      for (const def of monthly) {
        if (def.rule.kind !== "monthly") continue;
        for (const event of s.events.filter((e) => e.slug.startsWith(`${def.slug}-`))) {
          expect(isoWeekday(event.nightDate)).toBe(6);
          const day = Number(event.nightDate.slice(8, 10));
          expect(Math.ceil(day / 7)).toBe(def.rule.ordinal);
        }
      }
    }
    expect(
      recurrenceText(ruleToRrule({ kind: "monthly", weekday: "SA", ordinal: 4, time: "21:00" })),
    ).toBe("Every 4th Saturday");
    expect(recurrenceText(ruleToRrule({ kind: "weekly", weekday: "TH", time: "21:00" }))).toBe(
      "Every Thursday",
    );
  });

  it("has the required special cases", () => {
    const byType = (t: string) => seed.events.filter((e) => e.listingType === t);
    expect(byType("venue_open_night").length).toBeGreaterThanOrEqual(2);
    const openTonight = byType("venue_open_night").filter((e) => e.nightDate === seed.tonight);
    expect(openTonight.length).toBeGreaterThanOrEqual(2);

    const cancelled = seed.events.filter((e) => e.confirmation === "cancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    expect(cancelled.every((e) => e.nightDate === seed.tonight)).toBe(true);
    expect(cancelled.every((e) => e.status === "active")).toBe(true);
    // Both kinds of cancelled night stay covered: one with a start (the open night) and one with
    // no time (the one-off, D-060).
    expect(cancelled.some((e) => !isUntimed(e))).toBe(true);
    expect(cancelled.some(isUntimed)).toBe(true);

    const conflicting = seed.events.filter((e) => e.confirmation === "conflicting");
    expect(conflicting.length).toBeGreaterThanOrEqual(1);
    const first = conflicting[0];
    if (!first) throw new Error("no conflicting event");
    const ends = seed.provenance.filter((p) => p.entityId === first.id && p.field === "endsAt");
    expect(ends.length).toBe(2);
    expect(new Set(ends.map((p) => String(p.value))).size).toBe(2);
    expect(ends.some((p) => p.conflictsWith !== null)).toBe(true);
    expect(seed.eventSources.filter((s) => s.eventId === first.id)).toHaveLength(2);

    expect(
      seed.events.filter((e) => e.confirmation === "recurring_unconfirmed").length,
    ).toBeGreaterThan(5);
    const confirmedTonight = seed.events.filter(
      (e) => e.confirmation === "confirmed_today" && e.nightDate === seed.tonight,
    );
    expect(confirmedTonight.length).toBeGreaterThanOrEqual(3);

    expect(seed.events.filter((e) => e.isFree === true).length).toBeGreaterThanOrEqual(2);
    const tiered = seed.events.filter((e) =>
      e.prices.some((p) => /lesson plus social/i.test(p.label)),
    );
    expect(tiered.length).toBeGreaterThanOrEqual(3);
    expect(tiered.every((e) => e.lessonAt !== null && e.dancingAt !== null)).toBe(true);

    const afterHours = seed.events.filter((e) => {
      const start = startsAt(e);
      if (start === null) return false;
      const local = new TZDate(start, NY);
      return local.getHours() === 1 && local.getMinutes() === 0;
    });
    expect(afterHours.length).toBeGreaterThanOrEqual(1);
    for (const e of afterHours) {
      // A 1am start belongs to the night before (D-004): its night date is the previous calendar day.
      const local = new TZDate(startsAt(e) as Date, NY);
      const calendarDate = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
      expect(e.nightDate).toBe(addCalendarDays(calendarDate, -1));
    }

    expect(
      seed.events.filter((e) => e.listingType === "club_night" && e.ageMin === 21).length,
    ).toBeGreaterThanOrEqual(1);
    expect(seed.events.some((e) => e.organizerId === null)).toBe(true);
    // One night whose source names no place: "Location not listed", no pin (D-082).
    expect(seed.events.filter((e) => e.venueId === null).map((e) => e.slug)).toEqual([
      `cumbia-pop-up-${addCalendarDays(seed.tonight, 2)}`,
    ]);
  });

  it("says whether the music is live on every row that lists music", () => {
    const withMusic = seed.events.filter((e) => e.music !== null);
    expect(withMusic.length).toBeGreaterThan(10);
    for (const event of withMusic) {
      expect(event.music?.liveMusic, event.slug).not.toBeUndefined();
      // "Live band and caller" is live; "DJ swing, occasional live band" is not known per night.
      if (/^live (band|musicians|orchestra|music)/i.test(event.music?.genreMix ?? "")) {
        expect(event.music?.liveMusic, event.slug).toBe(true);
      }
    }
    const contra = seed.events.find((e) => e.slug.startsWith("cdny-saturday-contra-"));
    expect(contra?.music?.liveMusic).toBe(true);
    expect(seed.events.some((e) => e.music?.liveMusic === false)).toBe(true);
    // No $0 "watch only" tier anywhere: watching is out of scope, so every price is for dancing.
    for (const event of seed.events) {
      for (const price of event.prices) expect(price.label, event.slug).not.toMatch(/watch/i);
    }
  });

  it("keeps the summer outdoor series to its season", () => {
    const summer = seedNyc(new Date("2026-07-01T23:00:00Z"));
    const autumn = seed;
    const inSummer = summer.events.filter((e) => e.slug.startsWith("midsummer-night-swing-"));
    const inAutumn = autumn.events.filter((e) => e.slug.startsWith("midsummer-night-swing-"));
    expect(inSummer.length).toBeGreaterThan(0);
    expect(inSummer.every((e) => e.listingType === "outdoor_public")).toBe(true);
    expect(inAutumn).toHaveLength(0);
    expect(SERIES.find((s) => s.slug === "midsummer-night-swing")?.rule.kind).toBe("seasonal");
  });

  it("gives every event a primary source, provenance rows and a canonical URL", () => {
    const sourcesByEvent = new Map<string, number>();
    for (const es of seed.eventSources) {
      sourcesByEvent.set(es.eventId, (sourcesByEvent.get(es.eventId) ?? 0) + 1);
    }
    const provenanceByEvent = new Set(seed.provenance.map((p) => p.entityId));
    for (const event of seed.events) {
      expect(sourcesByEvent.get(event.id), event.slug).toBeGreaterThanOrEqual(1);
      expect(provenanceByEvent.has(event.id), event.slug).toBe(true);
      expect(event.canonicalUrl).toMatch(/^https?:\/\//);
      expect(event.sourceIds.length).toBeGreaterThanOrEqual(1);
    }
    for (const row of seed.provenance) {
      expect((row.evidence ?? "").length).toBeLessThanOrEqual(300);
      expect(row.method).toBe("manual");
    }
    expect(seed.eventSources.filter((s) => s.role === "primary").length).toBe(seed.events.length);
  });

  it("dates one-offs relative to tonight, small hours on the same night", () => {
    for (const def of ONE_OFFS) {
      const event = seed.events.find((e) => e.slug.startsWith(`${def.slug}-`));
      expect(event, def.slug).toBeDefined();
      expect(event?.nightDate).toBe(addCalendarDays(seed.tonight, def.daysFromNow));
      expect(event?.seriesId).toBeNull();
    }
  });
});

describeInProcessZones("seedNyc: listings with a date and no time (D-060)", () => {
  const seed = seedNyc(SUNDAY_EVENING);
  const tonightDefs = UNTIMED_ONE_OFFS.filter((d) => d.daysFromNow === 0);

  it("defines them tonight (one with a listed end, one cancelled) and on a night 2 or 3 days out", () => {
    expect(
      tonightDefs.some((d) => d.endTime !== null && d.confirmation !== "cancelled"),
      "tonight, not cancelled, with a listed end",
    ).toBe(true);
    expect(
      tonightDefs.some((d) => d.confirmation === "cancelled"),
      "tonight, cancelled",
    ).toBe(true);
    expect(
      UNTIMED_ONE_OFFS.some((d) => d.daysFromNow === 2 || d.daysFromNow === 3),
      "a later night",
    ).toBe(true);
    // Nothing is measured from a start that is not listed.
    for (const def of UNTIMED_ONE_OFFS) {
      expect(def.durationMin, def.slug).toBeNull();
      expect(def.lessonOffsetMin ?? null, def.slug).toBeNull();
      expect(def.doorsOffsetMin ?? null, def.slug).toBeNull();
    }
    // Cancelled marks tonight only, as it does for an open night.
    for (const def of ONE_OFFS.filter((d) => d.confirmation === "cancelled")) {
      expect(def.daysFromNow, def.slug).toBe(0);
    }
  });

  it("stores all three times as null and the night as listed, with no start provenance", () => {
    for (const def of UNTIMED_ONE_OFFS) {
      const event = eventOf(seed, def.slug);
      expect(event.doorsAt, def.slug).toBeNull();
      expect(event.lessonAt, def.slug).toBeNull();
      expect(event.dancingAt, def.slug).toBeNull();
      expect(startsAt(event), def.slug).toBeNull();
      expect(event.nightDate, def.slug).toBe(addCalendarDays(seed.tonight, def.daysFromNow));
      expect(event.slug).toBe(`${def.slug}-${event.nightDate}`);
      expect(event.status).toBe("active");

      const rows = seed.provenance.filter((p) => p.entityId === event.id);
      expect(
        rows.filter((p) => START_FIELDS.includes(p.field)),
        `${def.slug} start provenance`,
      ).toEqual([]);
      const nights = rows.filter((p) => p.field === "nightDate");
      expect(nights, `${def.slug} night provenance`).toHaveLength(1);
      expect(nights[0]?.value).toBe(event.nightDate);
      expect(nights[0]?.sourceId).toBe(event.sourceIds[0]);
      expect(nights[0]?.evidence).toBe(def.evidence?.nightDate);
      expect(rows.some((p) => p.field === "title")).toBe(true);
    }
  });

  it("stores a listed end on its own, in the small hours of the night when it is before 6am", () => {
    for (const def of UNTIMED_ONE_OFFS) {
      const event = eventOf(seed, def.slug);
      const ends = seed.provenance.filter((p) => p.entityId === event.id && p.field === "endsAt");
      if (def.endTime === null) {
        expect(event.endsAt, def.slug).toBeNull();
        expect(ends, def.slug).toEqual([]);
        continue;
      }
      const [hours, minutes] = def.endTime.split(":").map(Number) as [number, number];
      const calendarDate = hours < 6 ? addCalendarDays(event.nightDate, 1) : event.nightDate;
      const expected = localInstant(calendarDate, NY, hours, minutes);
      expect(event.endsAt?.toISOString(), def.slug).toBe(expected.toISOString());
      const window = nightWindow(event.nightDate, NY);
      expect(event.endsAt?.getTime()).toBeGreaterThan(window.start.getTime());
      expect(event.endsAt?.getTime()).toBeLessThanOrEqual(window.end.getTime());
      expect(ends, def.slug).toHaveLength(1);
      expect(ends[0]?.value).toBe(expected.toISOString());
      expect(ends[0]?.conflictsWith).toBeNull();
    }
    // Both kinds of listed end are in the data: one in the evening, one past midnight.
    const endHours = UNTIMED_ONE_OFFS.flatMap((d) =>
      d.endTime === null ? [] : [Number(d.endTime.slice(0, 2))],
    );
    expect(endHours.some((h) => h >= 6)).toBe(true);
    expect(endHours.some((h) => h < 6)).toBe(true);
    // The 11:30pm end tonight, stated as an instant rather than recomputed.
    const withEvening = tonightDefs.find((d) => d.endTime === "23:30");
    expect(withEvening).toBeDefined();
    expect(eventOf(seed, withEvening?.slug ?? "").endsAt?.toISOString()).toBe(
      "2026-09-21T03:30:00.000Z",
    );
  });

  it("keeps a cancelled listing with no time on tonight's bill, marked the same way", () => {
    const cancelled = tonightDefs.filter((d) => d.confirmation === "cancelled");
    expect(cancelled.length).toBeGreaterThanOrEqual(1);
    for (const def of cancelled) {
      const event = eventOf(seed, def.slug);
      expect(event.confirmation).toBe("cancelled");
      expect(event.status).toBe("active");
      expect(event.nightDate).toBe(seed.tonight);
      expect(startsAt(event)).toBeNull();
    }
  });

  it("puts tonight's at placed venues inside the default radius and near Williamsburg", () => {
    for (const def of tonightDefs) {
      const event = eventOf(seed, def.slug);
      const venue = seed.venues.find((v) => v.id === event.venueId);
      if (!venue) throw new Error(`${def.slug} has no venue row`);
      expect(event.geo).toEqual(venue.location);
      // The home page's default circle (NYC_METRO, src/ui/home/params.ts) and the 25 km circle
      // around Williamsburg that tests/unit/mock-repository.test.ts reads tonight from.
      expect(haversineKm(NYC_METRO.center, venue.location)).toBeLessThanOrEqual(NYC_METRO.radiusKm);
      expect(haversineKm(WILLIAMSBURG, venue.location), def.slug).toBeLessThanOrEqual(25);
    }
  });

  it("gives every event one night provenance row, and every timed event its start row", () => {
    for (const event of seed.events) {
      const rows = seed.provenance.filter((p) => p.entityId === event.id);
      const nights = rows.filter((p) => p.field === "nightDate");
      expect(nights, event.slug).toHaveLength(1);
      expect(nights[0]?.value).toBe(event.nightDate);
      expect(nights[0]?.sourceId).toBe(event.sourceIds[0]);
      const start = startsAt(event);
      const starts = rows.filter((p) => START_FIELDS.includes(p.field));
      if (start === null) {
        expect(starts, event.slug).toEqual([]);
      } else {
        expect(starts, event.slug).toHaveLength(1);
        expect(starts[0]?.value).toBe(start.toISOString());
      }
    }
  });

  it("orders the rows by night, then start, with each night's untimed rows after its timed ones", () => {
    for (let i = 1; i < seed.events.length; i++) {
      const a = seed.events[i - 1];
      const b = seed.events[i];
      if (!a || !b) throw new Error("unreachable");
      expect(a.nightDate <= b.nightDate, `${a.slug} before ${b.slug}`).toBe(true);
      if (a.nightDate !== b.nightDate) continue;
      const sa = startsAt(a);
      const sb = startsAt(b);
      if (sa === null) {
        expect(sb, `${b.slug} (timed) after ${a.slug} (untimed)`).toBeNull();
        expect(a.slug.localeCompare(b.slug)).toBeLessThan(0);
      } else if (sb !== null) {
        expect(sa.getTime(), `${a.slug} before ${b.slug}`).toBeLessThanOrEqual(sb.getTime());
      }
    }
    // The timed rows keep the start order they had before rows with no time existed.
    const timedStarts = seed.events.filter((e) => !isUntimed(e)).map((e) => timed(e).startsAt);
    const sorted = [...timedStarts].sort((x, y) => x.getTime() - y.getTime());
    expect(timedStarts).toEqual(sorted);
  });

  it("dates them across both DST changes without inventing a start", () => {
    // Thursday 29 October 2026, 7:42pm EDT: the later night is Saturday the 31st, whose small
    // hours fall back from EDT to EST at 2am, so the night window is 25 hours long.
    const autumn = seedNyc(new Date("2026-10-29T23:42:00Z"));
    // Thursday 11 March 2027, 7:42pm EST: the later night is Saturday the 13th, whose small hours
    // skip 2am to 3am, so the window is 23 hours long and a listed 2am end does not exist as such.
    const spring = seedNyc(new Date("2027-03-12T00:42:00Z"));
    for (const [seedAt, tonight, hours] of [
      [autumn, "2026-10-29", 25],
      [spring, "2027-03-11", 23],
    ] as const) {
      expect(seedAt.tonight).toBe(tonight);
      for (const def of UNTIMED_ONE_OFFS) {
        const event = eventOf(seedAt, def.slug);
        const night = addCalendarDays(tonight, def.daysFromNow);
        expect(event.nightDate, def.slug).toBe(night);
        expect(startsAt(event), def.slug).toBeNull();
        if (event.endsAt === null) continue;
        const window = nightWindow(night, NY);
        expect(event.endsAt.getTime()).toBeGreaterThan(window.start.getTime());
        expect(event.endsAt.getTime()).toBeLessThanOrEqual(window.end.getTime());
        if (def.daysFromNow === 2) {
          expect(Math.round((window.end.getTime() + 1 - window.start.getTime()) / HOUR_MS)).toBe(
            hours,
          );
        }
      }
    }
    // After the autumn change a 2am end is 2am EST, 07:00 UTC.
    const lateEnd = UNTIMED_ONE_OFFS.find((d) => d.daysFromNow === 2 && d.endTime === "02:00");
    expect(lateEnd).toBeDefined();
    expect(eventOf(autumn, lateEnd?.slug ?? "").endsAt?.toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });
});

describeInProcessZones("seedNyc: coverage over 14 consecutive nights", () => {
  // Coverage is counted over timed rows only, as it was before rows with no time existed
  // (D-060), so the one-offs with no time never make up for a night that lost its timed ones.
  it("gives every night at least 4 timed listings and tonight at least 8 at 7:42pm, for any weekday", () => {
    for (let day = 0; day < 14; day++) {
      const now = new Date(SUNDAY_EVENING.getTime() + day * 24 * HOUR_MS);
      const seed = seedNyc(now);
      const tonight = currentNightDate(now, NY);
      expect(seed.tonight).toBe(tonight);
      const timedRows = seed.events.filter((e) => !isUntimed(e));
      const perNight = new Map<string, number>();
      for (const event of timedRows) {
        perNight.set(event.nightDate, (perNight.get(event.nightDate) ?? 0) + 1);
      }
      for (let i = 0; i < MATERIALIZE_DAYS; i++) {
        const night = addCalendarDays(tonight, i);
        expect(
          perNight.get(night) ?? 0,
          `${night} from ${now.toISOString()}`,
        ).toBeGreaterThanOrEqual(4);
      }
      const tonightRows = timedRows.filter((e) => isTonight(timed(e), now, NY));
      expect(tonightRows.length, `tonight ${tonight}`).toBeGreaterThanOrEqual(8);
      expect(
        seed.events.some((e) => e.confirmation === "cancelled" && e.nightDate === tonight),
      ).toBe(true);
      // Tonight's rows with no time are on tonight whatever the weekday.
      const untimedTonight = seed.events.filter((e) => isUntimed(e) && e.nightDate === tonight);
      expect(untimedTonight.map(defSlugOf).sort()).toEqual(
        UNTIMED_ONE_OFFS.filter((d) => d.daysFromNow === 0)
          .map((d) => d.slug)
          .sort(),
      );
    }
  });

  it("handles a 2am 'now': tonight is still the night that is ending", () => {
    const twoAm = new Date("2026-09-21T06:00:00Z"); // 2:00am Monday in New York
    const seed = seedNyc(twoAm);
    expect(seed.tonight).toBe("2026-09-20");
    const stillOn = seed.events.filter((e) => !isUntimed(e) && isTonight(timed(e), twoAm, NY));
    expect(stillOn.length).toBeGreaterThanOrEqual(2);
    expect(stillOn.every((e) => e.nightDate === "2026-09-20")).toBe(true);
    // Tonight's rows with no time keep the night that is ending as their night, not the new day.
    const untimedTonight = seed.events.filter((e) => isUntimed(e) && e.nightDate === "2026-09-20");
    expect(untimedTonight.map(defSlugOf).sort()).toEqual(
      UNTIMED_ONE_OFFS.filter((d) => d.daysFromNow === 0)
        .map((d) => d.slug)
        .sort(),
    );
  });
});
