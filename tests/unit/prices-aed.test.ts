import { describe, expect, it } from "vitest";

import { currencyInText, parsePriceText } from "@/src/domain/prices";

const rows = (text: string, fallback: string | null = "USD") =>
  parsePriceText(text, fallback).map((p) => [p.label, p.amount, p.currency]);

describe("UAE dirham: AED, Dhs, Dh, Arabic د.إ and درهم (D-1061)", () => {
  describe("currencyInText", () => {
    it("reads AED 150 with null fallback as AED", () => {
      expect(currencyInText("AED 150", null)).toBe("AED");
    });
    it("reads 150 AED with USD fallback as AED", () => {
      expect(currencyInText("150 AED", "USD")).toBe("AED");
    });
    it("reads AED150 with null fallback as AED", () => {
      expect(currencyInText("AED150", null)).toBe("AED");
    });
    it("reads Dhs 150 with AED fallback as AED", () => {
      expect(currencyInText("Dhs 150", "AED")).toBe("AED");
    });
    it("reads Dhs 150 with null fallback as null", () => {
      expect(currencyInText("Dhs 150", null)).toBeNull();
    });
    it("reads 150Dhs with AED fallback as AED", () => {
      expect(currencyInText("150Dhs", "AED")).toBe("AED");
    });
    it("reads Dh100 with AED fallback as AED", () => {
      expect(currencyInText("Dh100", "AED")).toBe("AED");
    });
    it("reads 150 درهم with AED fallback as AED", () => {
      expect(currencyInText("150 درهم", "AED")).toBe("AED");
    });
    it("reads د.إ 150 with AED fallback as AED", () => {
      expect(currencyInText("د.إ 150", "AED")).toBe("AED");
    });
    it("does not read Dhow cruise from Abu Dhabi", () => {
      expect(currencyInText("Dhow cruise from Abu Dhabi", "AED")).toBeNull();
    });
    it("unchanged: $15 with null fallback gives USD", () => {
      expect(currencyInText("$15", null)).toBe("USD");
    });
    it("unchanged: €10 with null fallback gives EUR", () => {
      expect(currencyInText("€10", null)).toBe("EUR");
    });
  });

  describe("parsePriceText", () => {
    it("parses Entry AED 150 with AED fallback", () => {
      expect(rows("Entry AED 150", "AED")).toEqual([["Entry", 150, "AED"]]);
    });
    it("reads درهم only in an AED metro (Morocco also writes درهم)", () => {
      expect(currencyInText("150 درهم", null)).toBeNull();
      expect(currencyInText("150 درهم", "AED")).toBe("AED");
    });
    it("parses Ladies free, gents Dhs 200 with AED fallback", () => {
      expect(rows("Ladies free, gents Dhs 200", "AED")).toEqual([
        ["Ladies free", 0, "AED"], // the existing free-row label, unchanged
        ["Gents", 200, "AED"],
      ]);
    });
    it("parses Arabic free text الدخول مجاني as free", () => {
      const result = rows("الدخول مجاني", "AED");
      expect(result).toHaveLength(1);
      expect(result[0]?.[1]).toBe(0);
      expect(result[0]?.[2]).toBe("AED");
    });
    it("parses مجاني as free", () => {
      expect(rows("مجاني", "AED")).toEqual([["Free", 0, "AED"]]);
    });
    it("parses 150-300 AED as range", () => {
      expect(rows("150-300 AED", "AED")).toEqual([["150-300 AED", null, "AED"]]);
    });
    it("with fallback USD: AED 150 gives currency AED", () => {
      expect(rows("AED 150", "USD")).toEqual([["Entry", 150, "AED"]]);
    });
    it("with fallback USD: Dhs 150 is not read as dirham outside AED metro", () => {
      expect(rows("Dhs 150", "USD").some(([, , c]) => c === "AED")).toBe(false);
    });
    it("unchanged: $15 door, $10 advance with USD", () => {
      expect(rows("$15 door, $10 advance", "USD")).toEqual([
        ["Door", 15, "USD"],
        ["Advance", 10, "USD"],
      ]);
    });
  });
});
