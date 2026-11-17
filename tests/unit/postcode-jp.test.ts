import { describe, expect, it } from "vitest";
import { hasPostcode, postcodeWord, postcodeOf } from "@/src/domain/postcode";
import { METRO_POSTCODE_PREFIXES } from "@/config/metro-regions";

describe("Japan postcodes and Tokyo block addresses", () => {
  describe("postcodeOf", () => {
    it("returns 7-digit postcode for JP addresses", () => {
      expect(postcodeOf("〒150-0043 東京都渋谷区道玄坂2-29-5", "JP")).toBe("1500043");
      expect(postcodeOf("〒１５０－００４３ 東京都渋谷区", "JP")).toBe("1500043");
      expect(postcodeOf("2-29-5 Dogenzaka, Shibuya-ku, Tokyo 150-0043", "JP")).toBe("1500043");
      expect(postcodeOf("〒 160-0021 新宿区歌舞伎町", "JP")).toBe("1600021");
    });

    it("returns null when no postcode", () => {
      expect(postcodeOf("Tel 03-3461-1234", "JP")).toBe(null);
      expect(postcodeOf("090-1234-5678", "JP")).toBe(null);
      expect(postcodeOf("料金 1500-2000円", "JP")).toBe(null);
      expect(postcodeOf("¥1000-1500", "JP")).toBe(null);
      expect(postcodeOf("OPEN 22:00-29:00", "JP")).toBe(null);
      expect(postcodeOf("Shibuya, Tokyo", "JP")).toBe(null);
    });

    it("handles edge cases", () => {
      // Full-width digits and hyphens
      expect(postcodeOf("〒１６０－００２１", "JP")).toBe("1600021");
      // With spaces
      expect(postcodeOf("〒 150-0043", "JP")).toBe("1500043");
    });
  });

  describe("hasPostcode", () => {
    it("returns true for addresses with JP postcode", () => {
      expect(hasPostcode("〒150-0043 東京都渋谷区道玄坂2-29-5", "JP")).toBe(true);
      expect(hasPostcode("東京都渋谷区道玄坂2-29-5", "JP")).toBe(true);
      expect(hasPostcode("渋谷区道玄坂2丁目29番5号", "JP")).toBe(true);
      expect(hasPostcode("2-29-5 Dogenzaka, Shibuya-ku, Tokyo", "JP")).toBe(true);
      expect(hasPostcode("東京都武蔵野市吉祥寺本町1-2-3", "JP")).toBe(true);
      expect(hasPostcode("1-2-3 Kichijoji Honcho, Musashino-shi", "JP")).toBe(true);
      expect(hasPostcode("東京都新宿区新宿３－１６－６", "JP")).toBe(true);
    });

    it("returns false for addresses without block address or ward/city", () => {
      expect(hasPostcode("Shibuya, Tokyo", "JP")).toBe(false);
      expect(hasPostcode("渋谷区", "JP")).toBe(false);
      expect(hasPostcode("Tel 03-3461-1234 Tokyo", "JP")).toBe(false);
      expect(hasPostcode("OPEN 22:00-29:00 渋谷区", "JP")).toBe(false);
      expect(hasPostcode("2-29-5", "JP")).toBe(false);
      expect(hasPostcode("1500-2000円 Tokyo", "JP")).toBe(false);
      // Edge case: "1番人気" should not be considered a block address
      expect(hasPostcode("渋谷区 1番人気のクラブ", "JP")).toBe(false);
    });

    it("rejects phone numbers and prices", () => {
      expect(hasPostcode("03-3461-1234 Tokyo", "JP")).toBe(false);
      expect(hasPostcode("090-1234-5678 Tokyo", "JP")).toBe(false);
      expect(hasPostcode("¥1500-2000 Tokyo", "JP")).toBe(false);
      expect(hasPostcode("1500-2000円 Tokyo", "JP")).toBe(false);
    });
    it("returns true for block address after phone number or price", () => {
      // Phone number is rejected but later block address passes
      expect(hasPostcode("Tel 03-3461-1234 東京都渋谷区道玄坂2-29-5", "JP")).toBe(true);
      // Price is rejected but later block address passes
      expect(hasPostcode("¥1500-2000 東京都渋谷区道玄坂2-29-5", "JP")).toBe(true);
    });
    it("handles Japanese block patterns correctly", () => {
      // 番地 pattern
      expect(hasPostcode("渋谷区宇田川町33番地", "JP")).toBe(true);
      // 番5号 pattern
      expect(hasPostcode("渋谷区道玄坂2丁目29番5号", "JP")).toBe(true);
    });
  });

  describe("block address with a price later in the text", () => {
    it("keeps the block when a price comes after it", () => {
      expect(hasPostcode("東京都渋谷区道玄坂2-29-5 入場料2000円", "JP")).toBe(true);
    });
  });

  describe("two-part numbers", () => {
    it("reads a two-part block only right after a town name", () => {
      expect(hasPostcode("渋谷区 11-08 OPEN", "JP")).toBe(false);
      expect(hasPostcode("渋谷区 22-5時", "JP")).toBe(false);
      expect(hasPostcode("渋谷区道玄坂2-29", "JP")).toBe(true);
      expect(hasPostcode("1-2-3 Kichijoji Honcho, Musashino-shi", "JP")).toBe(true);
    });
  });

  describe("postcodeWord", () => {
    it('returns "postcode" for JP', () => {
      expect(postcodeWord("JP")).toBe("postcode");
    });

    it("keeps other countries unchanged", () => {
      expect(postcodeWord("US")).toBe("ZIP");
      expect(postcodeWord("GB")).toBe("postcode");
    });
  });

  describe("other countries unaffected", () => {
    it("US still uses 5-digit ZIP", () => {
      expect(postcodeOf("New York, NY 10001", "US")).toBe("10001");
      expect(postcodeOf("150-0043", "US")).toBe(null);
    });
  });

  describe("config/metro-regions", () => {
    it("has Tokyo postcode prefixes", () => {
      expect(METRO_POSTCODE_PREFIXES.tokyo).toEqual(["1", "20"]);
    });
  });
});
