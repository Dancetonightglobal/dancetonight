import { describe, expect, it } from "vitest";
import { bandsForDancersAt, screenNoDance, screenStoredRow } from "@/src/domain/listing-screen";
import { typeForSource } from "@/src/pipeline/normalize";

// D-322: Ball & Chain (Little Havana) has salsa bands for dancers every evening, and a noon trio and
// 6pm jazz sets on the same calendar. Its bands count for dancers only from 19:00 on their night.

const TZ = "America/New_York";
const NIGHT = "2026-11-03";
/** A time on Tuesday 2026-11-03 Eastern (EST, UTC-5); hours past 24 are the next morning. */
const at = (hour: number, minute = 0) => new Date(Date.UTC(2026, 10, 3, hour + 5, minute));
const listing = (title: string, hour: number, minute = 0) => ({
  title,
  styles: [] as string[],
  startsAt: at(hour, minute),
  nightDate: NIGHT,
  tz: TZ,
});

const ballAndChain = {
  mixedCalendar: true,
  bandsForDancers: true,
  bandsForDancersFrom: "19:00",
  styles: [] as string[],
};
const allDay = { mixedCalendar: true, bandsForDancers: true, styles: [] as string[] };

describe("bandsForDancersFrom (D-322)", () => {
  it.each([
    ["The Ball & Chain Trio", 12],
    ["Live Jazz with Calixto Oviedo", 18],
    ["Matine Cubana", 16],
  ])("screens %s before the cut-off", (title, hour) => {
    expect(screenNoDance(listing(title, hour), ballAndChain)).not.toBeNull();
  });

  it.each([
    ["La Pachanga", 20, 0],
    ["Sabor Wednesday", 20, 0],
    ["Mambo Mondays", 21, 0],
    ["BachaTuesday", 23, 30],
    ["Little Havana Under the Stars", 19, 0],
    ["Miami Boheme", 25, 0],
  ])("keeps %s from the cut-off on, past midnight included", (title, hour, minute) => {
    expect(screenNoDance(listing(title, hour, minute), ballAndChain)).toBeNull();
  });

  it("changes nothing without a cut-off (D-341 as before)", () => {
    expect(screenNoDance(listing("The Ball & Chain Trio", 12), allDay)).toBeNull();
  });

  it("ignores a malformed cut-off rather than screening more", () => {
    const malformed = { ...ballAndChain, bandsForDancersFrom: "7pm" };
    expect(screenNoDance(listing("The Ball & Chain Trio", 12), malformed)).toBeNull();
  });

  it("bandsForDancersAt: untimed with a cut-off, or no flag, is false", () => {
    expect(bandsForDancersAt(ballAndChain, { startsAt: null, nightDate: NIGHT, tz: TZ })).toBe(
      false,
    );
    expect(
      bandsForDancersAt(
        { bandsForDancersFrom: "19:00" },
        { startsAt: at(20), nightDate: NIGHT, tz: TZ },
      ),
    ).toBe(false);
    expect(bandsForDancersAt(ballAndChain, { startsAt: at(20), nightDate: NIGHT, tz: TZ })).toBe(
      true,
    );
  });

  it("typeForSource: live music with dancing only from the cut-off", () => {
    const when = (hour: number) => ({ startsAt: at(hour), nightDate: NIGHT, tz: TZ });
    expect(typeForSource("La Pachanga", "other", ballAndChain, when(20))).toBe(
      "live_music_with_dancing",
    );
    expect(typeForSource("La Pachanga", "other", ballAndChain, when(12))).toBe("other");
    expect(typeForSource("La Pachanga", "other", ballAndChain)).toBe("other");
    expect(typeForSource("La Pachanga", "other", allDay)).toBe("live_music_with_dancing");
  });

  it("screenStoredRow leaves out a stored noon trio row", () => {
    expect(screenStoredRow(listing("The Ball & Chain Trio", 12), ballAndChain)).not.toBeNull();
  });
});
