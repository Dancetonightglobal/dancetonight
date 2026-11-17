import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-883 (coverage daily 2026-11-13, K): an aerial-silks class and a weekly film screening
// are not dance nights on any calendar, unless the title names a style or a dance word.
describe("D-883 non-dance activities from the 11-13 daily check", () => {
  it.each([
    "Acrobacia en Telas",
    "Telas Aéreas para principiantes",
    "Aerial Silks Beginners",
    "Every Monday Movie Monday",
    "Movie Night on the Rooftop",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Salsa Night after the Movie",
    "Tango on Wheels: Milonga",
    "Bachata Social at the Roller Rink",
    "Swing Dance Movie Night: Lindy Hop Social",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
