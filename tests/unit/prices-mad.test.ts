import { describe, expect, it } from "vitest";

import { currencyInText, parsePriceText, currencyForCountry } from "@/src/domain/prices";

const rows = (text: string, fallback: string | null = "USD") =>
  parsePriceText(text, fallback).map((p) => [p.label, p.amount, p.currency]);

describe("Moroccan dirham: MAD, DH/Dhs/dirhams/درهم/د.م. in a MAD metro (Marrakesh, D-1101)", () => {
  describe("currencyInText", () => {
    it("reads 200 DH with MAD fallback as MAD", () => {
      expect(currencyInText("200 DH", "MAD")).toBe("MAD");
    });
    it("reads Dhs 200 with null fallback as null", () => {
      expect(currencyInText("Dhs 200", null)).toBeNull();
    });
    it("reads 150 MAD only in a MAD metro", () => {
      expect(currencyInText("150 MAD", "MAD")).toBe("MAD");
      expect(currencyInText("150 MAD", "USD")).not.toBe("MAD");
    });
    it("does not read mad in lowercase as currency", () => {
      expect(currencyInText("mad hatter 5", "USD")).toBeNull();
    });
    it("reads MAD 150 with MAD fallback as MAD", () => {
      expect(currencyInText("MAD 150", "MAD")).toBe("MAD");
    });
    it("reads 150 درهم with MAD fallback as MAD", () => {
      expect(currencyInText("150 درهم", "MAD")).toBe("MAD");
    });
    it("reads 150 د.م. with MAD fallback as MAD", () => {
      expect(currencyInText("150 د.م.", "MAD")).toBe("MAD");
    });
    it("reads 200 DH with USD fallback as not MAD", () => {
      expect(currencyInText("200 DH", "USD")).not.toBe("MAD");
    });
    it("AED unchanged: Dhs 150 with AED fallback gives AED", () => {
      expect(currencyInText("Dhs 150", "AED")).toBe("AED");
    });
  });

  describe("parsePriceText", () => {
    it("parses Entrée 200 DH with MAD fallback", () => {
      expect(rows("Entrée 200 DH", "MAD")).toEqual([["Entrée", 200, "MAD"]]);
    });
    it("parses 200DH with MAD fallback", () => {
      expect(rows("200DH", "MAD")).toEqual([["Entry", 200, "MAD"]]);
    });
    it("parses 200 Dhs with MAD fallback", () => {
      expect(rows("200 Dhs", "MAD")).toEqual([["Entry", 200, "MAD"]]);
    });
    it("parses Dhs 200 with MAD fallback", () => {
      expect(rows("Dhs 200", "MAD")).toEqual([["Entry", 200, "MAD"]]);
    });
    it("parses DH 200 with MAD fallback", () => {
      expect(rows("DH 200", "MAD")).toEqual([["Entry", 200, "MAD"]]);
    });
    it("parses 200 dh with MAD fallback", () => {
      expect(rows("200 dh", "MAD")).toEqual([["Entry", 200, "MAD"]]);
    });
    it("parses 150 dirhams with MAD fallback", () => {
      expect(rows("150 dirhams", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses 150 Dirhams with MAD fallback", () => {
      expect(rows("150 Dirhams", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses 150 MAD with MAD fallback", () => {
      expect(rows("150 MAD", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses MAD 150 with MAD fallback", () => {
      expect(rows("MAD 150", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses 150 درهم with MAD fallback", () => {
      expect(rows("150 درهم", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses 150 د.م. with MAD fallback", () => {
      expect(rows("150 د.م.", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses د.م. 150 with MAD fallback", () => {
      expect(rows("د.م. 150", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
    it("parses 200,00 DH with MAD fallback", () => {
      expect(rows("200,00 DH", "MAD")).toEqual([["Entry", 200, "MAD"]]);
    });
    it("parses 1.500 DH with MAD fallback", () => {
      expect(rows("1.500 DH", "MAD")).toEqual([["Entry", 1500, "MAD"]]);
    });
    it("parses multiple prices: Entrée 300 DH avec consommation, 500 DH VIP", () => {
      expect(rows("Entrée 300 DH avec consommation, 500 DH VIP", "MAD")).toEqual([
        ["Entrée avec consommation", 300, "MAD"],
        ["VIP", 500, "MAD"],
      ]);
    });
    it("parses €30 with MAD fallback as EUR", () => {
      expect(rows("€30", "MAD")).toEqual([["Entry", 30, "EUR"]]);
    });
    it("ignores clock time: Soirée à 22h, entrée 200 DH", () => {
      expect(rows("Soirée à 22h, entrée 200 DH", "MAD")).toEqual([["Entrée", 200, "MAD"]]);
    });
    it("parses Gratuit as free", () => {
      expect(rows("Gratuit", "MAD")).toEqual([["Free", 0, "MAD"]]);
    });
    it("does not parse 200 DH with USD fallback as MAD", () => {
      const result = rows("200 DH", "USD");
      expect(result.some(([, , c]) => c === "MAD")).toBe(false);
    });
    it("does not parse Mad Hatter Party 5 with USD fallback as MAD", () => {
      const result = rows("Mad Hatter Party 5", "USD");
      expect(result.some(([, , c]) => c === "MAD")).toBe(false);
    });
    it("does not parse Mad 4 Salsa, $10 with USD fallback as MAD", () => {
      const result = rows("Mad 4 Salsa, $10", "USD");
      expect(result.some(([, , c]) => c === "MAD")).toBe(false);
    });
    it("does not treat Mad Max night 2 in MAD metro as a price", () => {
      expect(rows("Mad Max night", "MAD")).toEqual([]);
    });
  });

  describe("currencyForCountry", () => {
    it("returns MAD for MA", () => {
      expect(currencyForCountry("MA")).toBe("MAD");
    });
  });
  describe("capital MAD away from an amount (D-1101)", () => {
    it("MAD PARTY with a dollar price stays USD", () => {
      expect(rows("MAD PARTY, $10", "USD")).toEqual([["Entry", 10, "USD"]]);
      expect(currencyInText("MAD PARTY tonight", "USD")).toBeNull();
    });
    it("MAD PARTY 200 DH in a MAD metro is one MAD row", () => {
      expect(rows("MAD PARTY 200 DH", "MAD").map(([, a, c]) => [a, c])).toEqual([[200, "MAD"]]);
    });
    it("150MAD glued is MAD in a MAD metro", () => {
      expect(currencyInText("150MAD", "MAD")).toBe("MAD");
    });
    it("MAD 2026 in a USD metro is no MAD price", () => {
      expect(rows("MAD 2026", "USD").some(([, , c]) => c === "MAD")).toBe(false);
      expect(currencyInText("MAD 2 Festival", "USD")).not.toBe("MAD");
    });
    it("MAD 150 in the Marrakesh metro is 150 MAD", () => {
      expect(rows("MAD 150", "MAD")).toEqual([["Entry", 150, "MAD"]]);
    });
  });
});
