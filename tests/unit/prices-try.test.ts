import { describe, expect, it } from "vitest";

import { currencyInText, parsePriceText } from "@/src/domain/prices";

const rows = (text: string, fallback: string | null = "USD") =>
  parsePriceText(text, fallback).map((p) => [p.label, p.amount, p.currency]);

describe("Turkish lira: TL, ₺ and TRY read as TRY, Turkish free-entry words (D-681)", () => {
  describe("currencyInText", () => {
    it("reads 400 TL with fallback TRY as TRY", () => {
      expect(currencyInText("400 TL", "TRY")).toBe("TRY");
    });
    it("reads 400 TL with null fallback as null", () => {
      expect(currencyInText("400 TL", null)).toBeNull();
    });
    it("reads ₺250 with null as TRY", () => {
      expect(currencyInText("₺250", null)).toBe("TRY");
    });
    it("reads TRY 400 with fallback TRY as TRY", () => {
      expect(currencyInText("TRY 400", "TRY")).toBe("TRY");
    });
    it("reads TRY 400 with null fallback as null", () => {
      expect(currencyInText("TRY 400", null)).toBeNull();
    });
    it("reads 400TL with null as TRY", () => {
      expect(currencyInText("400TL", null)).toBe("TRY");
    });
    it("does not read Try a free class", () => {
      expect(currencyInText("Try a free class", null)).toBeNull();
    });
    it("reads Try it for $10 as USD", () => {
      expect(currencyInText("Try it for $10", null)).toBe("USD");
    });
    it("does not read tl;dr 5", () => {
      expect(currencyInText("tl;dr 5", null)).toBeNull();
    });
  });

  describe("parsePriceText", () => {
    it("parses 400 TL with fallback TRY", () => {
      expect(rows("400 TL", "TRY")).toEqual([["Entry", 400, "TRY"]]);
    });
    it("parses 400TL with fallback TRY", () => {
      expect(rows("400TL", "TRY")).toEqual([["Entry", 400, "TRY"]]);
    });
    it("parses ₺400 with fallback TRY", () => {
      expect(rows("₺400", "TRY")).toEqual([["Entry", 400, "TRY"]]);
    });
    it("parses 1.500 TL as 1500 TRY", () => {
      expect(rows("1.500 TL", "TRY")).toEqual([["Entry", 1500, "TRY"]]);
    });
    it("parses 150,00 TL as 150 TRY", () => {
      expect(rows("150,00 TL", "TRY")).toEqual([["Entry", 150, "TRY"]]);
    });
    it("parses Giriş 400 TL, ön satış 300 TL", () => {
      expect(rows("Giriş 400 TL, ön satış 300 TL", "TRY")).toEqual([
        ["Giriş", 400, "TRY"],
        ["Ön satış", 300, "TRY"],
      ]);
    });
    it("parses 400 TL (1 içecek dahil)", () => {
      expect(rows("400 TL (1 içecek dahil)", "TRY")).toEqual([["(1 içecek dahil)", 400, "TRY"]]);
    });
    it("parses Ücretsiz as free", () => {
      expect(rows("Ücretsiz", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("parses Giriş ücretsiz as free", () => {
      expect(rows("Giriş ücretsiz", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("parses bedava as free", () => {
      expect(rows("bedava", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("parses ÜCRETSİZ in capitals as free", () => {
      expect(rows("ÜCRETSİZ", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("parses GİRİŞ ÜCRETSİZ in capitals as free", () => {
      expect(rows("GİRİŞ ÜCRETSİZ", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("parses GIRIŞ SERBEST without dots as free", () => {
      expect(rows("GIRIŞ SERBEST", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("parses Ücretsız with a dotless ı as free", () => {
      expect(rows("Ücretsız", "TRY")).toEqual([["Free", 0, "TRY"]]);
    });
    it("reads ÜCRETSİZ inside a sentence as free", () => {
      const result = rows("Bu akşam giriş ÜCRETSİZ!", "TRY");
      expect(result).toHaveLength(1);
      expect(result[0]?.[1]).toBe(0);
      expect(result[0]?.[2]).toBe("TRY");
    });
    it("parses 300-500 TL as range", () => {
      expect(rows("300-500 TL", "TRY")).toEqual([["300-500 ₺", null, "TRY"]]);
    });
    it("with fallback USD: 400TL gives currency TRY", () => {
      expect(rows("400TL", "USD")).toEqual([["Entry", 400, "TRY"]]);
    });
    it("with fallback USD: a spaced 400 TL is not read as lira outside a TRY metro", () => {
      expect(rows("400 TL", "USD").some(([, , c]) => c === "TRY")).toBe(false);
    });
    it("with fallback USD: TRY 2 CLASSES FREE gives no lira row", () => {
      expect(rows("TRY 2 CLASSES FREE", "USD").some(([, , c]) => c === "TRY")).toBe(false);
    });
    it("with fallback USD: TRY 1 LESSON $20 gives USD row", () => {
      expect(rows("TRY 1 LESSON $20", "USD")).toEqual([["TRY 1 LESSON", 20, "USD"]]);
    });
    it("with fallback TRY: TRY 400 gives TRY row", () => {
      expect(rows("TRY 400", "TRY")).toEqual([["Entry", 400, "TRY"]]);
    });
    it("with fallback TRY: 400 TL gives TRY row", () => {
      expect(rows("400 TL", "TRY")).toEqual([["Entry", 400, "TRY"]]);
    });
    it("unchanged: $15 door, $10 advance with USD", () => {
      expect(rows("$15 door, $10 advance", "USD")).toEqual([
        ["Door", 15, "USD"],
        ["Advance", 10, "USD"],
      ]);
    });
  });
});
