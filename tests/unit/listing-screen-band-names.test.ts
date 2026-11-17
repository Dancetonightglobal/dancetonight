import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

// D-774 (Austin 11-07, samstownpoint.com): band names that use a screen word are billings, not
// games nights or sex parties.
describe("band names with screen words (D-774)", () => {
  it.each([
    "Floyd Domino's All Stars",
    "Twisted Swingers feat. Alice Spencer",
    "Twisted Swingers ft Alice Spencer",
    "Kermit Ruffins & the BBQ Swingers",
    "The Swingers",
  ])("does not screen %s on its title", (title) => {
    expect(screenTitle(title)).toBeNull();
  });

  it.each([
    "Swingers Party at Club X",
    "Swingers Salsa Night",
    "The Swingers Party",
    "Fiesta Swinger Sábado",
  ])("still screens %s as a sex party", (title) => {
    expect(screenTitle(title)).toEqual({
      kind: "not_dance_scope",
      reason: "an explicit sex party (the owner lists none, D-564)",
    });
  });

  it.each(["Dominoes Night", "Domino Tournament", "Dominos & Drinks"])(
    "still screens %s as a games night",
    (title) => {
      expect(screenTitle(title)?.reason).toBe("a games night (the owner lists none, 2026-10-28)");
    },
  );

  it("keeps Domino Park a place", () => {
    expect(screenTitle("Salsa at Domino Park")).toBeNull();
  });
});
