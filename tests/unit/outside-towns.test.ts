import { describe, expect, it } from "vitest";

import { titleNamesOutsideTown } from "@/config/metro-regions";

describe("titleNamesOutsideTown", () => {
  it("finds a town named in the title, as written in the list", () => {
    expect(titleNamesOutsideTown("nyc", "Hartford Tango Practica")).toBe("Hartford");
    expect(titleNamesOutsideTown("nyc", "Stony Brook Tango Practice")).toBe("Stony Brook");
    // A venue name is read the same way (the ingest checks a placeless listing's venue name too).
    expect(titleNamesOutsideTown("nyc", "Paramus Firehouse")).toBe("Paramus");
    expect(titleNamesOutsideTown("nyc", "Red Bank Tango at Elks Club")).toBe("Red Bank");
    expect(titleNamesOutsideTown("nyc", "Let's Be Friends San Francisco")).toBe("San Francisco");
    expect(titleNamesOutsideTown("nyc", "FURBALL Palm Springs")).toBe("Palm Springs");
    expect(titleNamesOutsideTown("nyc", "FURBALL P'TOWN Howl")).toBe("P'Town");
    expect(titleNamesOutsideTown("nyc", "FURBALL P\u2019Town Howl")).toBe("P\u2019Town");
    expect(titleNamesOutsideTown("nyc", "Provincetown Bear Week")).toBe("Provincetown");
    expect(titleNamesOutsideTown("nyc", "Fire Island Pines Party")).toBe("Fire Island");
  });

  it("ignores case and lets spaces inside a town match any whitespace run", () => {
    expect(titleNamesOutsideTown("nyc", "STONY  BROOK milonga")).toBe("Stony Brook");
    expect(titleNamesOutsideTown("nyc", "NEWARK social")).toBe("Newark");
  });

  it("matches a town followed by an apostrophe", () => {
    expect(titleNamesOutsideTown("nyc", "Newark's Salsa Night")).toBe("Newark");
  });

  it("returns null for places inside the metro and for partial words", () => {
    expect(titleNamesOutsideTown("nyc", "Long Island City Salsa")).toBeNull();
    expect(titleNamesOutsideTown("nyc", "Brooklyn Tango")).toBeNull();
    expect(titleNamesOutsideTown("nyc", "Newarkish Party")).toBeNull();
    expect(titleNamesOutsideTown("nyc", "Chicago House Night")).toBeNull();
    expect(titleNamesOutsideTown("nyc", "Washington Heights Salsa")).toBeNull();
    expect(titleNamesOutsideTown("nyc", "FURBALL NYC")).toBeNull();
  });

  it("returns null for an empty title or an unknown metro", () => {
    expect(titleNamesOutsideTown("nyc", "")).toBeNull();
    expect(titleNamesOutsideTown("xyz", "Hartford Tango Practica")).toBeNull();
  });

  it("returns one of the towns when a title names two", () => {
    const town = titleNamesOutsideTown("nyc", "Hoboken / Jersey City Swing");
    expect(["Hoboken", "Jersey City"]).toContain(town);
  });

  describe("outside towns after a comma (D-521)", () => {
    it("matches La Plata after a comma", () => {
      expect(titleNamesOutsideTown("buenos-aires", "TBA - Chacra El Descanso, La Plata")).toBe(
        "La Plata",
      );
      expect(
        titleNamesOutsideTown(
          "buenos-aires",
          "Juan Hansen - Chacra El Descanso, La Plata | ALLMusicParties",
        ),
      ).toBe("La Plata");
      expect(
        titleNamesOutsideTown(
          "buenos-aires",
          "Ezequiel Arias - Circus, La Plata - ALLMusicParties",
        ),
      ).toBe("La Plata");
      expect(
        titleNamesOutsideTown("buenos-aires", "Calle 50 nro 700, La Plata, Buenos Aires"),
      ).toBe("La Plata");
    });

    it("does not match without a preceding comma", () => {
      expect(titleNamesOutsideTown("buenos-aires", "Av. La Plata 1500")).toBeNull();
      expect(titleNamesOutsideTown("buenos-aires", "La Plata 1400, Boedo")).toBeNull();
      expect(titleNamesOutsideTown("buenos-aires", "Milonga en Av. La Plata")).toBeNull();
      expect(titleNamesOutsideTown("buenos-aires", "Bar Mar del Plata, Palermo")).toBeNull();
    });

    it("does not match when followed by a digit", () => {
      expect(
        titleNamesOutsideTown("buenos-aires", "Fiesta en Club Atlético, La Plata 123"),
      ).toBeNull();
    });

    it("matches other towns in the after-comma list", () => {
      expect(titleNamesOutsideTown("buenos-aires", "Evento, Quilmes")).toBe("Quilmes");
      expect(titleNamesOutsideTown("buenos-aires", "Fiesta, Avellaneda")).toBe("Avellaneda");
      expect(titleNamesOutsideTown("buenos-aires", "Show, Mar del Plata")).toBe("Mar del Plata");
    });

    it("does not affect other metros", () => {
      expect(titleNamesOutsideTown("nyc", "Event, La Plata")).toBeNull();
      expect(titleNamesOutsideTown("philadelphia", "Party, Quilmes")).toBeNull();
    });
  });
});
