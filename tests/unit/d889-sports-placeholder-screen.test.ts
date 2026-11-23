import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-889 (weekly review 2026-11-23): a pub's football screenings and a calendar's link text are not dance nights.
describe("D-889 sports screenings and link-text rows", () => {
  it.each([
    "Arsenal vs Borussia Dortmund",
    "Sporting Lisbon vs Man United",
    "Green Bay Packers vs Los Angeles Rams",
    "Chelsea v Liverpool",
    "Premier League",
    "Champions League Night",
    "Arsenal Games on our screens",
    "Live Football",
    "Learn more here",
    "Read more",
    "Click here",
    "More info",
    "Info Coming Soon",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Cumbia vs Reggaeton with DJ Bootleg",
    "NOCHE DE GÓTICOS: VAMPIRES VS GOTHS",
    "SOB's presents: Y2K Party: 2000's vs 2010's",
    "Taco Tuesday : Latto vs Sexy Red",
    "Sala Vivaldi Salsa vs Bachata, Talleres + Baile Social",
    "Soupherb vs psYsq",
    "Barcelona vs Madrid Salsa Battle",
    "Arsenal Fans Afterparty with DJ Ana",
    "Learn to Salsa: more info inside",
    "Learn more: Bachata Bootcamp",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
