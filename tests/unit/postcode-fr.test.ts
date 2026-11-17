import { describe, expect, it } from "vitest";
import { hasPostcode } from "@/src/domain/postcode";

describe("hasPostcode for FR (D-1043)", () => {
  it("returns true for house number and street in Paris without postcode", () => {
    expect(hasPostcode("12 rue Oberkampf, Paris", "FR")).toBe(true);
    expect(hasPostcode("45 bis boulevard de Belleville, Paris, FR", "FR")).toBe(true);
    expect(hasPostcode("3, quai d'Austerlitz, Paris", "FR")).toBe(true);
    expect(hasPostcode("8 av. de Clichy, Paris 17e", "FR")).toBe(true);
    expect(hasPostcode("1 Place de la République, Paris, Île-de-France, fr", "FR")).toBe(true);
    expect(hasPostcode("9 allée Darius Milhaud, Paris", "FR")).toBe(true);
  });

  it("returns true for Paris address with postcode (5-digit rule)", () => {
    expect(hasPostcode("77 Rue de la Folie-Méricourt, 75011 Paris", "FR")).toBe(true);
    expect(hasPostcode("La Bellevilloise, 19-21 rue Boyer, 75020 Paris", "FR")).toBe(true);
  });

  it("returns false when missing required components", () => {
    expect(hasPostcode("Parc de la Villette, Paris", "FR")).toBe(false); // no number
    expect(hasPostcode("Paris", "FR")).toBe(false); // no street+number
    expect(hasPostcode("12 rue Oberkampf", "FR")).toBe(false); // no city word
    expect(hasPostcode("Rue de Rivoli, Paris", "FR")).toBe(false); // no number
    expect(hasPostcode("Le Rex Club, Paris 2", "FR")).toBe(false); // number but no street word
    expect(hasPostcode("12 ruelle Saint-Jean, Parisot", "FR")).toBe(false); // "ruelle" and "Parisot" are not whole words
  });

  it("does not affect other countries", () => {
    expect(hasPostcode("C/ de Llança, 5, Barcelona", "ES")).toBe(true);
    expect(hasPostcode("12 rue Oberkampf, Paris", "ES")).toBe(false);
  });
});
