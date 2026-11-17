import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeWord, postcodeOf } from "@/src/domain/postcode";

describe("Hong Kong has no postcodes: building rule instead of ZIP fallback (D-662)", () => {
  describe("hasPostcode", () => {
    it("returns true for English street number + capitalised street name", () => {
      expect(hasPostcode("K 97, G/F, 11 Lan Kwai Fong, Central, Hong Kong", "HK")).toBe(true);
      expect(hasPostcode("2 Lower Albert Road, Central", "HK")).toBe(true);
      expect(hasPostcode("60 Wyndham Street, Central", "HK")).toBe(true);
      expect(hasPostcode("30-32 D'Aguilar Street, Central", "HK")).toBe(true);
      expect(hasPostcode("G/F, 48 Peel St, Central", "HK")).toBe(true);
      expect(hasPostcode("Shop 3, G/F, 99 Queen's Road Central", "HK")).toBe(true);
    });

    it("returns true for Chinese street + number + 號", () => {
      expect(hasPostcode("中環蘭桂坊11號", "HK")).toBe(true);
      expect(hasPostcode("中環雲咸街60號地下", "HK")).toBe(true);
    });

    it("returns true for building word AND Hong Kong area word", () => {
      expect(hasPostcode("California Tower, 30-32 D'Aguilar Street", "HK")).toBe(true);
      expect(hasPostcode("Shop 3, Harbour City Mall, Tsim Sha Tsui", "HK")).toBe(true);
    });

    it("returns false for missing street number or building", () => {
      expect(hasPostcode("Causeway Bay", "HK")).toBe(false);
      expect(hasPostcode("Hong Kong", "HK")).toBe(false);
      expect(hasPostcode("Central, Hong Kong", "HK")).toBe(false);
      expect(hasPostcode("Room 12345, Hong Kong", "HK")).toBe(false);
      expect(hasPostcode("", "HK")).toBe(false);
      expect(hasPostcode("8 PM Sheung Wan", "HK")).toBe(false);
      expect(hasPostcode("HKD 150 Peel Street", "HK")).toBe(false);
      expect(hasPostcode("Opera House", "HK")).toBe(false);
    });
  });

  describe("postcodeOf", () => {
    it("returns null for any HK address", () => {
      expect(postcodeOf("Room 12345, Kowloon", "HK")).toBeNull();
      expect(postcodeOf("11 Lan Kwai Fong", "HK")).toBeNull();
      expect(postcodeOf("12345", "HK")).toBeNull();
    });
  });

  describe("postcodeWord", () => {
    it('returns "street number or building" for HK', () => {
      expect(postcodeWord("HK")).toBe("street number or building");
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
