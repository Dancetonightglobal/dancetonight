import { describe, expect, it } from "vitest";

import { currencyInText, parsePriceText } from "@/src/domain/prices";

const rows = (text: string, fallback: string | null = "USD") =>
  parsePriceText(text, fallback).map((p) => [p.label, p.amount, p.currency]);

describe("Indian rupees: Rs., INR, lakh grouping (D-620)", () => {
  describe("currencyInText", () => {
    it("reads Rs. as INR", () => {
      expect(currencyInText("Rs. 1,500", null)).toBe("INR");
    });
    it("reads Rs as INR", () => {
      expect(currencyInText("Rs 500", null)).toBe("INR");
    });
    it("reads INR1500 (no space) as INR", () => {
      expect(currencyInText("INR1500", null)).toBe("INR");
    });
    it("reads ₹2,000 as INR", () => {
      expect(currencyInText("₹2,000", null)).toBe("INR");
    });
    it("does not read Mrs Smith 2", () => {
      expect(currencyInText("Mrs Smith 2", null)).toBeNull();
    });
  });

  describe("parsePriceText", () => {
    it("parses Rs. 1,500", () => {
      expect(rows("Rs. 1,500", "INR")).toEqual([["Entry", 1500, "INR"]]);
    });
    it("parses Rs 1500/-", () => {
      expect(rows("Rs 1500/-", "INR")).toEqual([["Entry", 1500, "INR"]]);
    });
    it("parses INR1500 cover, redeemable", () => {
      expect(rows("INR1500 cover, redeemable", "INR")).toEqual([["Cover", 1500, "INR"]]);
    });
    it("parses ₹1,00,000 table", () => {
      expect(rows("₹1,00,000 table", "INR")).toEqual([["Table", 100000, "INR"]]);
    });
    it("parses Stag entry Rs. 2000, couple Rs. 3000", () => {
      expect(rows("Stag entry Rs. 2000, couple Rs. 3000", "INR")).toEqual([
        ["Stag entry", 2000, "INR"],
        ["Couple", 3000, "INR"],
      ]);
    });
    it("keeps HKD150 including one drink", () => {
      expect(rows("HKD150 including one drink", "HKD")).toEqual([
        ["Including one drink", 150, "HKD"],
      ]);
    });
    it("keeps $20 door; $15 advance", () => {
      expect(rows("$20 door; $15 advance")).toEqual([
        ["Door", 20, "USD"],
        ["Advance", 15, "USD"],
      ]);
    });
    it("keeps €12,50", () => {
      expect(rows("€12,50", "EUR")).toEqual([["Entry", 12.5, "EUR"]]);
    });
  });
});

describe("a comma before 1-2 digits is a decimal mark, all metros (D-620)", () => {
  it.each([
    ["€12,50", "EUR", [["Entry", 12.5, "EUR"]]],
    [
      "€12,50 door, €10 advance",
      "EUR",
      [
        ["Door", 12.5, "EUR"],
        ["Advance", 10, "EUR"],
      ],
    ],
    ["$15, 2 drink minimum", "USD", [["Entry", 15, "USD"]]],
    ["$1,500", "USD", [["Entry", 1500, "USD"]]],
    ["Rs. 1,50,000", "INR", [["Entry", 150000, "INR"]]],
  ] as const)("%s", (text, fallback, expected) => {
    expect(rows(text, fallback)).toEqual(expected);
  });
});
