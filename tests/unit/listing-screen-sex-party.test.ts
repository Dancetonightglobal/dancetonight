import { describe, expect, it } from "vitest";
import { screenTitle } from "@/src/domain/listing-screen";

describe("screenTitle sex parties and paint-and-sip", () => {
  it("screens explicit sex-party titles", () => {
    for (const title of [
      "Sexy Party Halloween",
      "Gangbang Night",
      "Swingers Party at Club X",
      "Swingers Salsa Night",
      "Play Party London",
      "ANAL ADVENTURES",
      "Orgía de Halloween",
      "Fiesta Swinger Sábado",
      "Intercambio de parejas",
      "Festa Liberal",
      "Sex Party Berlin",
      "Gang Bang Friday",
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "not_dance_scope",
        reason: "an explicit sex party (the owner lists none, D-564)",
      });
    }
  });

  it("keeps fetish/kink dance nights", () => {
    for (const title of [
      "Torture Garden Halloween Ball",
      "Klub Verboten: Fetish Dance Night",
      "Kink Night Techno",
      "BDSM Disco",
      "Swing Dance Social",
      "Sexy Salsa Night",
      "West Coast Swing Party",
      "Swinging Sixties Dance",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("screens paint-and-sip nights that name no dance", () => {
    for (const title of [
      "Party N Paint",
      "Sip 'N Stroke",
      "Sip and Paint Night",
      "Paint & Sip: Starry Night",
      "Paint Party Friday",
    ]) {
      expect(screenTitle(title), title).toEqual({
        kind: "not_dance_scope",
        reason: "a paint-and-sip night that names no dance",
      });
    }
  });

  it("keeps paint-and-sip nights that name a dance", () => {
    for (const title of ["Salsa Paint Party", "Sip & Salsa", "Bachata and Painting Night"]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });
});
