import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-748: daily site check 11-05 (section C). Poetry readings on a café calendar (New Orleans, Cafe
// Istanbul), a stand-up festival and drag shows (NYC, Philadelphia, Miami), a solo pianist's gig
// tagged as a DJ night (WWOZ) and a cooking course (Philadelphia): never a dance, on any calendar,
// unless a dance style or a dance word is named (D-589's rule).

describe("screenTitle: poetry, stand-up festivals, drag shows, solo piano, cooking (D-748)", () => {
  it.each([
    "P.R.I.M.E POETRY",
    "Poets on Poets",
    "Poetry Slam at the Café",
    "Open Mic Poetry Night",
    "Spoken Word Night",
    "Noche de poesía",
    "Jaye McBride - New York Comedy Festival",
    "Miss Lisa Lisa's drag show",
    "Turn It Out: Friday Night Drag Dinner Show",
    "Sunday Drag Brunch",
    "Solo Piano Barbecue Party",
    "Holiday Hors D'oeuvres with John DiPrimo",
    "Pasta Making Cooking Class",
  ])("screens %s", (title) => {
    expect(screenTitle(title)?.kind).toBe("not_dance_scope");
  });

  it.each([
    "Drag & Dance Party",
    "Salsa & Poetry Night",
    "Poetry in Motion: Bachata Social",
    "Comedy Festival Afterparty: Dance Till Late",
    "Bachata Drag Brunch",
    "Piano Bar Swing Night",
    "Sunday Brunch Party",
  ])("does not screen %s as not dance", (title) => {
    expect(screenTitle(title)?.kind ?? "").not.toBe("not_dance_scope");
  });
});
