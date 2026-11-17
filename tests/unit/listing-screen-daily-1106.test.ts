// Daily site check 2026-11-06, section C (D-762): calendars of clubs and aggregators carry record fairs written in
// French, piano-bar sets, comedy, shop pop-ups, bike rides, drawing parties, makeovers and holiday notes.
import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

describe("not-dance titles from the 11-06 daily check (D-762)", () => {
  it.each([
    "PARIS LOVES VINYL 17 - 100 000 vinyles - 70 Vendeurs - 8 DJs",
    "Bourse aux disques",
    "PARIS LOVES VINYL 17",
    "Vinyl Market Sunday",
    "Brooklyn Record Swap",
    "At The Piano with Chris Blacker",
    "Open Mic Piano Party! with Anthony Fett",
    "Cheesemongers Doing Comedy at a Brooklyn Cheese Shop",
    "Avenoir Co Brand Pop Up",
    "Mumbai Midnight Cycling",
    "Bad Drawing Party - Mumbai",
    "Cambiá de look con @.queerstyle",
    "Remembrance Day",
    "Los Locos: Dinner Show at L'estació Espai Gastronomic",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Salsa Pop Up Party",
    "Bachata Dinner Show",
    "Vinyl Salsa Night",
    "All Vinyl Soul Night",
    "Swing Remix with the George Gee Orchestra",
    "Tango at the Piano Bar Milonga",
  ])("keeps %s (a dance style or dance word is named)", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
