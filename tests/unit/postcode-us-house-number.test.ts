import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeOf } from "@/src/domain/postcode";

describe("US five-digit house number is not a ZIP (D-507)", () => {
  describe("postcodeOf", () => {
    it("returns null for five-digit house number at start", () => {
      expect(postcodeOf("18145 Biscayne Blvd, North Miami, FL", "US")).toBeNull();
    });

    it("returns ZIP when house number is not five digits", () => {
      expect(postcodeOf("112 Chestnut St, Philadelphia, PA 19106", "US")).toBe("19106");
    });

    it("returns ZIP when five digits are not at part start", () => {
      expect(postcodeOf("FL 33181 USA", "US")).toBe("33181");
    });

    it("returns ZIP when five digits are at end", () => {
      expect(postcodeOf("Miami, 33181", "US")).toBe("33181");
    });

    it("returns ZIP when five digits are alone", () => {
      expect(postcodeOf("33181", "US")).toBe("33181");
    });

    it("returns null for five-digit house number after comma", () => {
      expect(postcodeOf("Ohm Lounge, 16117 Collins Ave, Sunny Isles Beach, FL", "US")).toBeNull();
    });

    it("returns ZIP when there's also a valid ZIP", () => {
      expect(postcodeOf("18145 Biscayne Blvd, North Miami, FL 33160", "US")).toBe("33160");
    });

    it("returns null for five-digit at start followed by word", () => {
      expect(postcodeOf("10001 USA", "US")).toBeNull();
    });
  });

  describe("hasPostcode", () => {
    it("returns false for five-digit house number at start", () => {
      expect(hasPostcode("18145 Biscayne Blvd, North Miami, FL", "US")).toBe(false);
    });

    it("returns true when there's a valid ZIP", () => {
      expect(hasPostcode("18145 Biscayne Blvd, North Miami, FL 33160", "US")).toBe(true);
    });

    it("returns true for non-five-digit house number with ZIP", () => {
      expect(hasPostcode("112 Chestnut St, Philadelphia, PA 19106", "US")).toBe(true);
    });

    it("returns true for five digits not at part start", () => {
      expect(hasPostcode("FL 33181 USA", "US")).toBe(true);
    });

    it("returns true for five digits at end", () => {
      expect(hasPostcode("Miami, 33181", "US")).toBe(true);
    });

    it("returns true for five digits alone", () => {
      expect(hasPostcode("33181", "US")).toBe(true);
    });

    it("returns false for five-digit house number after comma", () => {
      expect(hasPostcode("Ohm Lounge, 16117 Collins Ave, Sunny Isles Beach, FL", "US")).toBe(false);
    });

    it("returns false for five-digit at start followed by word", () => {
      expect(hasPostcode("10001 USA", "US")).toBe(false);
    });
  });

  describe("Puerto Rico no-ZIP path (D-262) still works", () => {
    it("returns true for house number and street in San Juan metro", () => {
      expect(hasPostcode("18145 Calle Loiza, San Juan, PR", "US")).toBe(true);
    });

    it("returns false for highway without house number", () => {
      expect(hasPostcode("PR-169, Guaynabo, PR", "US")).toBe(false);
    });
  });

  describe("Other countries unchanged", () => {
    it("ES: keeps five-digit postcode", () => {
      expect(postcodeOf("Carrer del Cobalt 12, 08907 L'Hospitalet", "ES")).toBe("08907");
      expect(hasPostcode("Carrer del Cobalt 12, 08907 L'Hospitalet", "ES")).toBe(true);
    });

    it("MX: keeps five-digit postcode", () => {
      expect(postcodeOf("Calle 5, 06700 Ciudad de Mexico", "MX")).toBe("06700");
      expect(hasPostcode("Calle 5, 06700 Ciudad de Mexico", "MX")).toBe(true);
    });

    it("GB: unchanged", () => {
      expect(postcodeOf("London N1 9GU", "GB")).toBe("N19GU");
      expect(hasPostcode("London N1 9GU", "GB")).toBe(true);
    });

    it("PT: unchanged", () => {
      expect(postcodeOf("Rua X 12, 1100-148 Lisboa", "PT")).toBe("1100-148");
      expect(hasPostcode("Rua X 12, 1100-148 Lisboa", "PT")).toBe(true);
    });

    it("BR: unchanged", () => {
      expect(postcodeOf("22050-002", "BR")).toBe("22050002");
      expect(hasPostcode("22050-002", "BR")).toBe(true);
    });

    it("AR: unchanged", () => {
      expect(postcodeOf("C1414ABC", "AR")).toBe("C1414ABC");
      expect(hasPostcode("C1414ABC", "AR")).toBe(true);
    });
  });
});

describe("Puerto Rico five-digit house number without ZIP (D-507 with D-262)", () => {
  it("still places a San Juan street address", () => {
    expect(hasPostcode("18145 Calle Loiza, San Juan, PR", "US")).toBe(true);
  });
});
