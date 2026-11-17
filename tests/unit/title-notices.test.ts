import { describe, expect, it } from "vitest";
import { cancelledByTitle, isPlaceholderTitle } from "@/src/domain/title-notices";
import { screenTitle } from "@/src/domain/listing-screen";

// D-815 (coverage daily 2026-11-09): a calendar row whose title opens or closes with a cancellation word
// and still names the event is that event, cancelled; a "guide for today is N/A" row is a placeholder.
describe("cancelledByTitle", () => {
  it.each([
    "CANCELLED - Sunday Tango Classes with VANIA REY!!!",
    "CANCELLED TODAY ☆ AUSTIN TANGO PRACTICA",
    "Canceled: Salsa Social",
    "POSTPONED | Bachata Night",
    "[CANCELLED] Friday Milonga",
    "Cancelado - Milonga de los Viernes",
    "ANNULÉ - Soirée Salsa",
    "Friday Milonga - CANCELLED",
    "Swing Night (cancelled)",
    "Salsa Social *** CANCELED ***",
  ])("reads %s as cancelled", (title) => {
    expect(cancelledByTitle(title)).toBe(true);
  });

  it.each([
    "Sunday Tango Classes",
    "CANCELLED",
    "Cancelled tonight",
    "Cancellation Policy Night",
    "The Cancelled Show: a comedy",
    "Not Cancelled! Salsa Social",
    "Uncancelled Bachata Party",
    "Postponement Party",
  ])("does not read %s as cancelled", (title) => {
    expect(cancelledByTitle(title)).toBe(false);
  });
});

describe("isPlaceholderTitle", () => {
  it.each([
    "■ THE PRACTICA GUIDE FOR TODAY IS N/A",
    "Milonga tonight: TBA",
    "Today's class is N/A",
    "Practica: none today",
    "TBA",
    "N/A",
  ])("reads %s as a placeholder", (title) => {
    expect(isPlaceholderTitle(title)).toBe(true);
  });

  it.each([
    "Salsa Social",
    "Bachata Night - DJ TBA",
    "Milonga with guest DJ (TBA)",
    "N/A Dance Crew Showcase Party",
    "Practica",
  ])("does not read %s as a placeholder", (title) => {
    expect(isPlaceholderTitle(title)).toBe(false);
  });
});

describe("screenTitle: D-815 not-dance titles", () => {
  it.each([
    "■ THE PRACTICA GUIDE FOR TODAY IS N/A",
    "SPECIALTY COCKTAIL MENU! JOIN US FOR A COCKTAIL...MY DEER!",
    "Happy Hour Drink Specials",
    "Meeting | Board of Directors",
    "Board Meeting",
    "X CONEZO - Congresso Esportivo da Zona Oeste - 2026.2",
  ])("screens %s", (title) => {
    expect(screenTitle(title)).not.toBeNull();
  });

  it.each([
    "Salsa Social",
    "Soul Skate",
    "RollerDisco",
    "Cocktails & Bachata",
    "Salsa on the Board Walk",
    "Bachata Congress 2026",
  ])("keeps %s", (title) => {
    expect(screenTitle(title)).toBeNull();
  });
});
