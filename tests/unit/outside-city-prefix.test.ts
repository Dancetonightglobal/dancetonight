import { describe, expect, it } from "vitest";
import { titlePrefixNamesOtherCity, titleNamesOutsideTown } from "@/config/metro-regions";

describe("titlePrefixNamesOtherCity", () => {
  it("returns the city when title starts with that city and a separator", () => {
    expect(titlePrefixNamesOtherCity("mexico-city", "GUadalajara: Día de Muertxxxs")).toBe(
      "Guadalajara",
    );
    expect(titlePrefixNamesOtherCity("mexico-city", "Monterrey | Pervert")).toBe("Monterrey");
    expect(titlePrefixNamesOtherCity("mexico-city", "  San Luis Potosí - Halloween")).toBe(
      "San Luis Potosí",
    );
    expect(titlePrefixNamesOtherCity("barcelona", "Madrid: Salsa Night")).toBe("Madrid");
    expect(titlePrefixNamesOtherCity("miami", "Orlando: Latin Night")).toBe("Orlando");
    expect(titlePrefixNamesOtherCity("nyc", "Chicago: House Night")).toBe("Chicago");
  });

  it("returns null for titles without the required separator", () => {
    expect(titlePrefixNamesOtherCity("mexico-city", "Fiesta en Calle Guadalajara 12")).toBeNull();
    expect(titlePrefixNamesOtherCity("mexico-city", "Guadalajara 12 Rooftop")).toBeNull();
    expect(titlePrefixNamesOtherCity("mexico-city", "Guadalajara-style tacos night")).toBeNull();
    expect(titlePrefixNamesOtherCity("nyc", "Chicago House Night")).toBeNull();
  });

  it("returns null for own city prefixes", () => {
    expect(titlePrefixNamesOtherCity("nyc", "New York: Salsa")).toBeNull();
    expect(titlePrefixNamesOtherCity("miami", "Miami: Bachata")).toBeNull();
    expect(titlePrefixNamesOtherCity("new-orleans", "NOLA: Brass")).toBeNull();
    expect(titlePrefixNamesOtherCity("philadelphia", "Philly: Swing")).toBeNull();
  });

  it("returns null for unknown metro or empty title", () => {
    expect(titlePrefixNamesOtherCity("xyz", "Madrid: x")).toBeNull();
    expect(titlePrefixNamesOtherCity("barcelona", "")).toBeNull();
  });
});

describe("titleNamesOutsideTown with prefix detection", () => {
  it("returns the city via prefix detection when no whole-word match", () => {
    expect(titleNamesOutsideTown("mexico-city", "GUadalajara: Día de Muertxxxs")).toBe(
      "Guadalajara",
    );
    expect(titleNamesOutsideTown("mexico-city", "Monterrey | Pervert")).toBe("Monterrey");
    expect(titleNamesOutsideTown("barcelona", "Madrid: Salsa Night")).toBe("Madrid");
    expect(titleNamesOutsideTown("miami", "Orlando: Latin Night")).toBe("Orlando");
    expect(titleNamesOutsideTown("nyc", "Chicago: House Night")).toBe("Chicago");
  });

  it("still returns null for titles without separator", () => {
    expect(titleNamesOutsideTown("nyc", "Chicago House Night")).toBeNull();
  });
});
