import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";
import { matchStyles } from "@/config/styles";

// D-862 (daily check 2026-11-11, NYC): a venue calendar's 10pm "Davinci at Thank Comedy It's Friday @
// Comic Strip Live" was kept by the club-hours rule. A comedy show or open mic is seated at any hour.
const TZ = "America/New_York";
const NIGHT = "2026-11-13";
/** Local hour on Friday 2026-11-13 (EST, UTC-5). */
const at = (hour: number) => new Date(Date.UTC(2026, 10, 13, hour + 5));
const listing = (title: string, hour = 22) => ({
  title,
  styles: matchStyles(title).styles as string[],
  startsAt: at(hour),
  nightDate: NIGHT,
  tz: TZ,
});
const mixed = { mixedCalendar: true, styles: [] as string[] };

describe("D-862 late comedy on a venue calendar", () => {
  it.each([
    "Friday, Nov 13th - Davinci at Thank Comedy It's Friday @ Comic Strip Live",
    "Stand Up Showcase at the Cellar",
    "Open Mic Night",
  ])("screens %s at 10pm", (title) => {
    expect(screenNoDance(listing(title), mixed)).not.toBeNull();
  });

  it.each(["Midnight Rave", "Late Night Sessions", "After Hours with Friends"])(
    "still keeps %s at 10pm",
    (title) => {
      expect(screenNoDance(listing(title), mixed)).toBeNull();
    },
  );

  it("keeps a comedy title that names a style", () => {
    const result = screenNoDance(listing("Comedy Salsa Night"), mixed);
    expect(result).toBeNull();
  });
});
