import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { matchStyles } from "@/config/styles";

const TZ = "America/Chicago";
const NIGHT = "2026-11-06";
/** 8pm, 6pm or 9pm Central on Friday 2026-11-06 (CST, UTC-6). */
const at = (hour: number) => new Date(Date.UTC(2026, 10, 7, hour - 18));
const listing = (title: string, hour = 20) => ({
  title,
  styles: matchStyles(title).styles as string[],
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});

const mixedOnly = { mixedCalendar: true, styles: [] as string[] };
const flagged = { mixedCalendar: true, bandsForDancers: true, styles: [] as string[] };

describe("music jam screening on mixed calendars", () => {
  it.each([
    "Open Jam",
    "Blues-N-Such-Jam",
    "Cafe Negril Jam Session",
    "Sunday Jams",
    "Jam Session with Live Band",
  ])("screens music jam %s", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toMatchObject({
      kind: "not_dance_scope",
    });
    expect(screenNoDance(listing(title), flagged)).toMatchObject({
      kind: "not_dance_scope",
    });
  });

  it.each([
    "Salsa Jam",
    "Contact Jam",
    "Hip Hop Cypher",
    "Jam & Dance Party",
    "Swing Jam Social",
    "Open Floor Jam",
    "Freestyle Session",
    "Freestyle Jam",
  ])("keeps dance jam %s", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toBeNull();
    expect(screenNoDance(listing(title), flagged)).toBeNull();
  });

  it("keeps jam with dance hint token", () => {
    expect(screenNoDance(listing("Jam & Dance Party"), mixedOnly)).toBeNull();
    expect(screenNoDance(listing("Jam Night Social"), mixedOnly)).toBeNull();
  });

  it("keeps jam with dance style", () => {
    expect(screenNoDance(listing("Salsa Jam"), mixedOnly)).toBeNull();
  });
});

describe("fitness class screening on mixed calendars", () => {
  it.each([
    "Free Mat Pilates Class by Baptist Health",
    "Sunset Yoga",
    "Barre Class",
    "HIIT Bootcamp",
    "Boot Camp at the Park",
    "Spin Class",
    "Aula de Ioga",
    "Pilates Mat Class",
    "HIIT Workout",
    "Bootcamp Challenge",
    "Spinning Session",
    "CrossFit WOD",
    "Techno Yoga 4/11",
    "House Music Yoga",
    "Techno Pilates",
  ])("screens fitness class %s", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toMatchObject({
      kind: "not_dance_scope",
    });
    expect(screenNoDance(listing(title), flagged)).toMatchObject({
      kind: "not_dance_scope",
    });
  });

  it.each([
    "Zumba Night",
    "Silent Yoga Disco",
    "Yoga & Dance Flow",
    "Dance Fitness Class",
    "Salsa Fitness",
    "Bachata Bootcamp",
  ])("keeps fitness with dance style or dance word %s", (title) => {
    expect(screenNoDance(listing(title), mixedOnly)).toBeNull();
    expect(screenNoDance(listing(title), flagged)).toBeNull();
  });
});

describe("non-mixed calendars ignore jam/fitness checks", () => {
  it("returns null for music jam on non-mixed source", () => {
    expect(screenNoDance(listing("Open Jam"), { mixedCalendar: false })).toBeNull();
  });
  it("returns null for fitness class on non-mixed source", () => {
    expect(screenNoDance(listing("Sunset Yoga"), { mixedCalendar: false })).toBeNull();
  });
});
