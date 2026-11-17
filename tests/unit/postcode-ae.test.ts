import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeWord, postcodeOf } from "@/src/domain/postcode";

describe("UAE has no postcodes: building-or-street rule (D-1061)", () => {
  describe("hasPostcode", () => {
    it("does not read a time in a party title as a street address", () => {
      expect(hasPostcode("10pm Dance Street Party", "AE")).toBe(false);
    });
    it("returns true for building + Dubai area", () => {
      expect(hasPostcode("Five Palm Jumeirah Hotel, Palm Jumeirah, Dubai", "AE")).toBe(true);
      expect(hasPostcode("Unit 54, Alserkal Avenue, Al Quoz, Dubai", "AE")).toBe(true);
      expect(hasPostcode("Level 43, Address Sky View Hotel, Downtown Dubai", "AE")).toBe(true);
      expect(hasPostcode("Grosvenor House, Dubai Marina, Dubai", "AE")).toBe(true);
      expect(hasPostcode("12 Al Wasl Road, Dubai", "AE")).toBe(true);
      expect(hasPostcode("Street 6, Al Quoz Industrial Area 3, Dubai", "AE")).toBe(true);
      expect(hasPostcode("Zero Gravity Beach Club, Al Sufouh, Dubai", "AE")).toBe(true);
    });

    it("returns false for missing street number or building", () => {
      expect(hasPostcode("Dubai", "AE")).toBe(false);
      expect(hasPostcode("Dubai, United Arab Emirates", "AE")).toBe(false);
      expect(hasPostcode("Dubai Marina, Dubai", "AE")).toBe(false);
      expect(hasPostcode("AED 150 Road trip", "AE")).toBe(false);
      expect(hasPostcode("10 PM Rooftop", "AE")).toBe(false);
      expect(hasPostcode("Downtown", "AE")).toBe(false);
    });
  });

  describe("postcodeOf", () => {
    it("returns null for any AE address", () => {
      expect(postcodeOf("Unit 54, Alserkal Avenue, Al Quoz, Dubai 12345", "AE")).toBeNull();
      expect(postcodeOf("12 Al Wasl Road, Dubai", "AE")).toBeNull();
      expect(postcodeOf("12345", "AE")).toBeNull();
    });
  });

  describe("postcodeWord", () => {
    it('returns "street number or building" for AE', () => {
      expect(postcodeWord("AE")).toBe("street number or building");
    });

    it('returns "ZIP" for US unchanged', () => {
      expect(postcodeWord("US")).toBe("ZIP");
    });
  });

  describe("other countries unchanged", () => {
    it("US still works", () => {
      expect(hasPostcode("350 5th Ave, New York, NY 10118", "US")).toBe(true);
    });

    it("HK still works", () => {
      expect(hasPostcode("K 97, G/F, 11 Lan Kwai Fong, Central, Hong Kong", "HK")).toBe(true);
    });
  });
});
