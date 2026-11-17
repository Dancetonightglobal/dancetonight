import { describe, expect, it } from "vitest";
import { matchStyles } from "@/config/styles";
import { screenNoDance } from "@/src/domain/listing-screen";

// NYC 11-03 (D-589): concert billings on discovered venue calendars that passed the screen.
describe("concert billings on a venue calendar (D-589)", () => {
  const tz = "America/New_York";
  const nightDate = "2026-11-03";
  const row = (title: string, styles: string[], startsAt: string | null) => ({
    title,
    styles,
    startsAt: startsAt ? new Date(startsAt) : null,
    nightDate,
    tz,
  });
  const mixed = { mixedCalendar: true };

  it.each([
    // untimed: a band name, a "//" double bill, a "Live in <place> <year>" tour title
    ["Silver Arrow Band", [], null],
    ["Cecilia Lopez’s Filter Four // Melissa Almaguer", [], null],
    ["PACHYMAN LIVE IN JAPAN 2026", ["dancehall"], null],
    // 10pm: a band name is a concert at any hour
    ["Doc / Bryan Band", [], "2026-11-04T03:00:00Z"],
    // a style named only as a concert series' theme
    ["Salsa Meets Jazz: Eddie Palmieri", ["salsa"], "2026-11-04T00:00:00Z"],
    ["Breaking Sound Presents: Taylor Hurd / Mardiana / Anne Tello", [], "2026-11-04T00:30:00Z"],
  ])("screens %s", (title, styles, startsAt) => {
    expect(screenNoDance(row(title, styles, startsAt), mixed)).not.toBeNull();
  });

  it.each([
    ["Swing Dance with the Silver Arrow Band", [], null],
    ["Salsa Night with Live Band", ["salsa"], "2026-11-04T00:00:00Z"],
    ["Brass Band Second Line Party", [], "2026-11-04T00:00:00Z"],
    ["Zydeco Band Dance Party", [], null],
    ["Bachata Social // DJ Tony", ["bachata"], "2026-11-04T01:00:00Z"],
    ["Live in Concert: Salsa Social", ["salsa"], "2026-11-04T01:00:00Z"],
    ["Salsa Meets Bachata Social", ["salsa", "bachata"], "2026-11-04T01:00:00Z"],
    ["Spunk Saturday", [], "2026-11-08T03:00:00Z"],
  ])("keeps %s", (title, styles, startsAt) => {
    expect(screenNoDance(row(title, styles, startsAt), mixed)).toBeNull();
  });

  it("keeps a band at a venue whose bands play for dancers", () => {
    expect(
      screenNoDance(row("Silver Arrow Band", [], null), {
        mixedCalendar: true,
        bandsForDancers: true,
      }),
    ).toBeNull();
  });

  it("does not screen a band name off a venue calendar", () => {
    expect(screenNoDance(row("Silver Arrow Band", [], null), {})).toBeNull();
  });

  it("'Breaking Sound' names no style; breaking battles and jams still do", () => {
    expect(matchStyles("breaking sound presents taylor hurd").styles).toEqual([]);
    expect(matchStyles("breaking battle").styles).toContain("breaking");
    expect(matchStyles("breaking jam").styles.length).toBeGreaterThan(0);
  });
});
