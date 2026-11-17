import { describe, expect, it } from "vitest";
import { screenNoDance, screenStoredRow, screenTalkOrWorkshop } from "@/src/domain/listing-screen";

// NYC 11-04 (D-590): SAGE's senior-centre calendar listed health and nutrition workshops as dances: on a mixed
// calendar a kind word ("Class", "Workshop", "Social") kept any title. Talks and workshops on any calendar too.
const tz = "America/New_York";
const at1pm = (title: string) => ({
  title,
  styles: [] as string[],
  startsAt: new Date("2026-11-04T18:00:00Z"),
  nightDate: "2026-11-04",
  tz,
});

describe("mixed calendar of a source with no dance styles: a kind word alone is not a dance (D-590)", () => {
  const venue = { mixedCalendar: true, styles: [] as string[] };
  it.each([
    "“Keep On Track” Blood Pressure Workshop",
    "Health Workshop with Dr O",
    "Nutrition Class: Digest This With Mia",
    "Creative Writing Class",
    "Afternoon Game Social",
    "Adult Cooking Class",
    "Dungeon and Dragons Social",
  ])("screens %s", (title) => {
    expect(screenNoDance(at1pm(title), venue)).not.toBeNull();
    expect(screenStoredRow(at1pm(title), venue)).not.toBeNull();
  });

  it.each([
    "Line Dance",
    "Line Dancing",
    "Calpulli Adults 50+ Dance Workshop",
    "Adult Tap Dance Class",
    "Bachata Class",
    "Baile do Rabisca 06/11",
  ])("keeps %s", (title) => {
    expect(screenNoDance(at1pm(title), venue)).toBeNull();
  });

  it.each(["Social de Luxe - La Previa", "Buenos Aires Social Club", "Beginner Class"])(
    "keeps %s from a dance organiser's mixed calendar (source styles)",
    (title) => {
      expect(
        screenNoDance(at1pm(title), { mixedCalendar: true, styles: ["salsa", "bachata"] }),
      ).toBeNull();
    },
  );
});

describe("screenTalkOrWorkshop: talks and workshops naming no dance, any calendar (D-590)", () => {
  it.each([
    ["Entangled Talks & Workshops", ["dj_night"]],
    ["Hair Braiding Workshop", []],
    ["Bloody Mary Charm making workshop", []],
    ["Gratitude Journaling Workshop with Neysa King", []],
    ["Lecture: The History of Jazz", []],
  ])("screens %s (source styles %j)", (title, styles) => {
    const r = screenTalkOrWorkshop(title, styles);
    expect(r?.reason).toContain("D-590");
  });

  it.each([
    ["Bachata Workshop", []],
    ["Dance Workshop: Footwork", []],
    ["Special Workshop w/ Hailey Toro @ The Loft", ["blues"]],
    ["Gotham Workshops - Jen Deluca", ["west_coast_swing"]],
    ["Tango Talk & Practica", []],
    ["Small Talk Social Dance", []],
    ["Techno Night", ["dj_night"]],
    ["Talk That Talk: A Riri Anniversary", []],
    ["Talk It Up: a drag tribute", ["dj_night"]],
  ])("keeps %s (source styles %j)", (title, styles) => {
    expect(screenTalkOrWorkshop(title, styles)).toBeNull();
  });
});
