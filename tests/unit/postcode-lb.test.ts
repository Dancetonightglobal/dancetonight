import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeWord, postcodeOf } from "@/src/domain/postcode";

describe("Lebanon has no postcodes: street with building or street number pins an address (D-1002)", () => {
  describe("hasPostcode", () => {
    it("returns true for street with building", () => {
      expect(
        hasPostcode("Electricite du Liban Building, Armenia Street, Mar Mikhael, Beirut", "LB"),
      ).toBe(true);
      expect(hasPostcode("Sursock Street, Bldg 45, Achrafieh", "LB")).toBe(true);
      expect(hasPostcode("Rue Gouraud, Immeuble Sayegh, Gemmayzeh", "LB")).toBe(true);
      expect(hasPostcode("شارع الحمرا، بناية المطران", "LB")).toBe(true);
    });

    it("returns true for street with street number", () => {
      expect(hasPostcode("12 Armenia Street, Beirut", "LB")).toBe(true);
      expect(hasPostcode("Armenia Street 12, Beirut", "LB")).toBe(true);
      expect(hasPostcode("Rue Gouraud 12, Gemmayzeh", "LB")).toBe(true);
      expect(hasPostcode("45 Sursock Street, Achrafieh", "LB")).toBe(true);
      expect(hasPostcode("١٢ Hamra Street, Beirut", "LB")).toBe(true);
      expect(hasPostcode("شارع الحمرا ٥٠", "LB")).toBe(true);
      expect(hasPostcode("طريق المطار 123", "LB")).toBe(true);
    });

    it("returns false for street without building or number", () => {
      expect(hasPostcode("Armenia Street, Beirut", "LB")).toBe(false);
      expect(hasPostcode("Armenia Street, Beirut 2020", "LB")).toBe(false);
      expect(hasPostcode("Rue Gouraud, open till 2", "LB")).toBe(false);
      expect(hasPostcode("شارع الحمرا، بيروت", "LB")).toBe(false);
    });

    it("returns false for building without street", () => {
      expect(hasPostcode("Beirut Souks Mall", "LB")).toBe(false);
      expect(hasPostcode("برج ساسين", "LB")).toBe(false);
    });

    it("returns false for area only", () => {
      expect(hasPostcode("Mar Mikhael, Beirut", "LB")).toBe(false);
      expect(hasPostcode("Hamra, Beirut, Lebanon", "LB")).toBe(false);
    });

    it("ignores digits that are prices or times", () => {
      expect(hasPostcode("Armenia Street, $15 entry", "LB")).toBe(false);
      expect(hasPostcode("Rue Gouraud, 10 PM", "LB")).toBe(false);
      expect(hasPostcode("شارع الحمرا، ٥٠ ل.ل", "LB")).toBe(false);
    });
  });

  describe("postcodeOf", () => {
    it("returns null for any LB address", () => {
      expect(postcodeOf("Armenia Street, Mar Mikhael, Beirut 1107 2020", "LB")).toBeNull();
      expect(postcodeOf("12 Armenia Street, Beirut", "LB")).toBeNull();
      expect(postcodeOf("12345", "LB")).toBeNull();
    });
  });

  describe("postcodeWord", () => {
    it('returns "street and building" for LB', () => {
      expect(postcodeWord("LB")).toBe("street and building");
    });

    it('returns "ZIP" for US unchanged', () => {
      expect(postcodeWord("US")).toBe("ZIP");
    });
  });

  describe("other countries unchanged", () => {
    it("US still works", () => {
      expect(hasPostcode("350 5th Ave, New York, NY 10118", "US")).toBe(true);
    });

    it("GB still works", () => {
      expect(hasPostcode("SW1A 1AA", "GB")).toBe(true);
    });
  });
});
