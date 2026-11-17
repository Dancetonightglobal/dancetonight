import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeWord, postcodeOf } from "@/src/domain/postcode";
import { postcodeOutsideMetro } from "@/src/pipeline/geocode";
import {
  METRO_POSTCODE_PREFIXES,
  METRO_REGIONS,
  COUNTRY_REGIONS,
  METRO_OUTSIDE_TOWNS,
  titleNamesOutsideTown,
} from "@/config/metro-regions";

describe("India PIN codes", () => {
  describe("postcodeOf", () => {
    it("returns PIN code for addresses with 6-digit PIN", () => {
      expect(postcodeOf("Kamala Mills Compound, Lower Parel, Mumbai 400013", "IN")).toBe("400013");
      expect(postcodeOf("Linking Road, Khar West, Mumbai - 400 052", "IN")).toBe("400052");
      expect(postcodeOf("Andheri East, Mumbai, Maharashtra 400059, India", "IN")).toBe("400059");
      expect(postcodeOf("Plot 12, Sector 19, Vashi, Navi Mumbai 400703", "IN")).toBe("400703");
    });

    it("returns null when no PIN code", () => {
      expect(postcodeOf("Call +91 98200 12345", "IN")).toBe(null);
      expect(postcodeOf("Tel: 022 2345 6789, Colaba", "IN")).toBe(null);
      expect(postcodeOf("Order #9400013", "IN")).toBe(null); // longer number
    });
  });

  describe("hasPostcode", () => {
    it("returns true for address with PIN", () => {
      expect(hasPostcode("Phoenix Mills, Mumbai 400013", "IN")).toBe(true);
    });

    it("returns false for address without PIN", () => {
      expect(hasPostcode("Bandra West, Mumbai", "IN")).toBe(false);
    });
  });

  describe("postcodeWord", () => {
    it('returns "PIN code" for IN', () => {
      expect(postcodeWord("IN")).toBe("PIN code");
    });

    it("keeps other countries unchanged", () => {
      expect(postcodeWord("GB")).toBe("postcode");
      expect(postcodeWord("US")).toBe("ZIP");
      expect(postcodeWord("PT")).toBe("postcode");
      expect(postcodeWord("BR")).toBe("CEP");
      expect(postcodeWord("AR")).toBe("postcode");
    });
  });

  describe("config/metro-regions", () => {
    it("has Mumbai postcode prefixes", () => {
      expect(METRO_POSTCODE_PREFIXES.mumbai).toEqual(["4000", "4001"]);
    });

    it("prefixes match Mumbai PINs", () => {
      const prefixes = METRO_POSTCODE_PREFIXES.mumbai ?? [];
      const inside = (pin: string) => prefixes.some((p) => pin.startsWith(p));
      expect(inside("400013")).toBe(true);
      expect(inside("400104")).toBe(true);
      expect(inside("400601")).toBe(false); // Thane
      expect(inside("400703")).toBe(false); // Vashi
    });

    it("keeps Delhi, Gurugram and Noida PINs inside and Ghaziabad and Faridabad out (D-1140)", () => {
      const delhi = { slug: "delhi", countryCode: "IN" };
      expect(postcodeOutsideMetro("Hauz Khas Village, New Delhi, Delhi 110016", delhi)).toBe(null);
      expect(
        postcodeOutsideMetro("CyberHub, DLF Cyber City, Gurugram, Haryana 122002", delhi),
      ).toBe(null);
      expect(postcodeOutsideMetro("Sector 18, Noida, Uttar Pradesh 201301", delhi)).toBe(null);
      expect(postcodeOutsideMetro("Pari Chowk, Greater Noida 201310", delhi)).toBe(null);
      expect(postcodeOutsideMetro("Raj Nagar, Ghaziabad, Uttar Pradesh 201002", delhi)).toMatch(
        /201002/,
      );
      expect(postcodeOutsideMetro("Indirapuram, Ghaziabad 201014", delhi)).toMatch(/201014/);
      expect(postcodeOutsideMetro("Sector 15, Faridabad, Haryana 121007", delhi)).toMatch(/121007/);
    });

    it("has Mumbai region", () => {
      expect(METRO_REGIONS.mumbai).toEqual(["MH"]);
    });

    it("has India country regions", () => {
      expect(COUNTRY_REGIONS.IN).toHaveLength(36);
      expect(COUNTRY_REGIONS.IN).toContainEqual(["MH", "Maharashtra"]);
      expect(COUNTRY_REGIONS.IN).toContainEqual(["GA", "Goa"]);
    });

    it("has Mumbai outside towns", () => {
      const towns = METRO_OUTSIDE_TOWNS.mumbai;
      expect(towns).toContain("Goa");
      expect(towns).toContain("Pune");
      expect(towns).not.toContain("Bombay");
      expect(towns).not.toContain("Andheri");
      expect(towns).not.toContain("Juhu");
      expect(towns).not.toContain("Powai");
      expect(towns).not.toContain("Mumbai");
    });

    it("titleNamesOutsideTown matches outside towns", () => {
      expect(titleNamesOutsideTown("mumbai", "Sunburn Goa 2026")).toBe("Goa");
      expect(titleNamesOutsideTown("mumbai", "Bollywood Night at Kitty Su, Andheri")).toBe(null);
    });
  });
});
