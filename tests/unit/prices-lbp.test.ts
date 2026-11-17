import { describe, expect, it } from "vitest";

import { currencyInText, parsePriceText } from "@/src/domain/prices";

const rows = (text: string, fallback: string | null = "USD") =>
  parsePriceText(text, fallback).map((p) => [p.label, p.amount, p.currency]);

describe("Lebanese pound: LL, L.L., LBP (D-1001)", () => {
  describe("currencyInText", () => {
    it("reads 500,000 LL with fallback LBP as LBP", () => {
      expect(currencyInText("500,000 LL", "LBP")).toBe("LBP");
    });
    it("does not read 500,000LL as LBP outside an LBP metro", () => {
      expect(currencyInText("500,000LL", null)).toBeNull();
    });
    it("does not read L.L. 1,000,000 as LBP outside an LBP metro", () => {
      expect(currencyInText("L.L. 1,000,000", null)).toBeNull();
    });
    it("reads LL 500,000 with fallback LBP as LBP", () => {
      expect(currencyInText("LL 500,000", "LBP")).toBe("LBP");
    });
    it("does not read 500,000 ل.ل as LBP outside an LBP metro", () => {
      expect(currencyInText("500,000 ل.ل", null)).toBeNull();
    });
    it("does not read ل.ل 500,000 as LBP outside an LBP metro", () => {
      expect(currencyInText("ل.ل 500,000", null)).toBeNull();
    });
    it("does not read HALL 20 as LBP", () => {
      expect(currencyInText("HALL 20", null)).toBeNull();
    });
    it("does not read BALL 30 as LBP", () => {
      expect(currencyInText("BALL 30", null)).toBeNull();
    });
    it("does not read LLC 100 as LBP", () => {
      expect(currencyInText("LLC 100", null)).toBeNull();
    });
    it("reads LBP500000 with null as LBP", () => {
      expect(currencyInText("LBP500000", null)).toBe("LBP");
    });
    it("reads Tickets $15 in LB metro as USD", () => {
      expect(currencyInText("Tickets $15", "LBP")).toBe("USD");
    });
    it("reads $10-15 including a drink in LB metro as USD", () => {
      expect(currencyInText("$10-15 including a drink", "LBP")).toBe("USD");
    });
  });

  describe("parsePriceText", () => {
    it("parses Entrance 500,000 LL with fallback LBP", () => {
      expect(rows("Entrance 500,000 LL", "LBP")).toEqual([["Entrance", 500000, "LBP"]]);
    });
    it("parses L.L. 1,000,000 with fallback LBP", () => {
      expect(rows("L.L. 1,000,000", "LBP")).toEqual([["Entry", 1000000, "LBP"]]);
    });
    it("parses Tickets $15 in LB metro", () => {
      expect(rows("Tickets $15", "LBP")).toEqual([["Tickets", 15, "USD"]]);
    });
    it("parses $10-15 including a drink in LB metro as range", () => {
      expect(rows("$10-15 including a drink", "LBP")).toEqual([
        ["$10-15 including a drink", null, "USD"],
      ]);
    });
    it("parses 500,000 ل.ل with fallback LBP", () => {
      expect(rows("500,000 ل.ل", "LBP")).toEqual([["Entry", 500000, "LBP"]]);
    });
    it("parses ل.ل 500,000 with fallback LBP", () => {
      expect(rows("ل.ل 500,000", "LBP")).toEqual([["Entry", 500000, "LBP"]]);
    });
    it("parses Ballroom Hall 20 (no currency) with fallback LBP as no rows", () => {
      expect(rows("Ballroom Hall 20", "LBP")).toEqual([]);
    });
    it("parses 1.500.000 LL with fallback LBP", () => {
      expect(rows("1.500.000 LL", "LBP")).toEqual([["Entry", 1500000, "LBP"]]);
    });
    it("parses 500,000LL (glued) with fallback LBP", () => {
      expect(rows("500,000LL", "LBP")).toEqual([["Entry", 500000, "LBP"]]);
    });
    it("parses LBP500,000 (glued) with fallback LBP", () => {
      expect(rows("LBP500,000", "LBP")).toEqual([["Entry", 500000, "LBP"]]);
    });
    it("parses multiple: Entrance 500,000 LL, Advance 300,000 LL", () => {
      expect(rows("Entrance 500,000 LL, Advance 300,000 LL", "LBP")).toEqual([
        ["Entrance", 500000, "LBP"],
        ["Advance", 300000, "LBP"],
      ]);
    });
  });
});
