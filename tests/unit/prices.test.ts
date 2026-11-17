import { describe, expect, it } from "vitest";

import {
  currencyForCountry,
  currencyInText,
  isFreeFromPrices,
  normalizePrices,
  parsePriceText,
} from "@/src/domain/prices";

const rows = (text: string, fallback: string | null = "USD") =>
  parsePriceText(text, fallback).map((p) => [p.label, p.amount, p.currency]);

describe("parsePriceText", () => {
  it("labels each amount with the words around it", () => {
    expect(rows("$20 door; $15 advance")).toEqual([
      ["Door", 20, "USD"],
      ["Advance", 15, "USD"],
    ]);
  });

  it("never reads a clock time as a price", () => {
    expect(rows("$15, $10 before 10pm")).toEqual([
      ["Entry", 15, "USD"],
      ["Before 10pm", 10, "USD"],
    ]);
    expect(rows("Free before 11pm, $10 after")).toEqual([
      ["Free before 11pm", 0, "USD"],
      ["After", 10, "USD"],
    ]);
    expect(rows("22h - 12 €", "EUR")).toEqual([["22h", 12, "EUR"]]);
  });

  it("keeps thousands separators inside one amount", () => {
    expect(rows("$1,000 table")).toEqual([["Table", 1000, "USD"]]);
  });

  it("reads the currency from the text before the fallback", () => {
    expect(rows("€12 / 8 € réduit", "USD")).toEqual([
      ["Entry", 12, "EUR"],
      ["Réduit", 8, "EUR"],
    ]);
    expect(rows("15", "EUR")).toEqual([["Entry", 15, "EUR"]]);
  });

  it("gives free and donation rows without inventing an amount", () => {
    expect(rows("Free")).toEqual([["Free", 0, "USD"]]);
    expect(rows("No cover")).toEqual([["Free", 0, "USD"]]);
    expect(rows("Suggested donation")).toEqual([["Suggested donation", null, "USD"]]);
  });

  it("keeps a range as one row with no single amount", () => {
    expect(rows("Pay what you can ($5-$20)")).toEqual([["Pay what you can ($5-$20)", null, "USD"]]);
    expect(rows("$10 to 15 at the door")).toEqual([["$10 to 15 at the door", null, "USD"]]);
  });

  it("ignores bare numbers when the text prices things in a currency", () => {
    expect(rows("$15, 2 drink minimum")).toEqual([["Entry", 15, "USD"]]);
  });

  it("returns nothing for empty text", () => {
    expect(parsePriceText("  ", "USD")).toEqual([]);
  });
});

describe("bare $ as the local peso (D-230)", () => {
  it("reads bare $ as MXN when fallback is MXN", () => {
    expect(rows("$200", "MXN")).toEqual([["Entry", 200, "MXN"]]);
  });
  it("reads bare $ as ARS when fallback is ARS", () => {
    expect(rows("$15.000", "ARS")).toEqual([["Entry", 15000, "ARS"]]);
  });
  it("reads multiple amounts with bare $ as ARS", () => {
    expect(rows("Entrada $3.500, con clase $5.000", "ARS")).toEqual([
      ["Entrada", 3500, "ARS"],
      ["Con clase", 5000, "ARS"],
    ]);
  });
  it("US$ overrides fallback", () => {
    expect(rows("US$20", "ARS")).toEqual([["Entry", 20, "USD"]]);
  });
  it("bare $ with USD fallback stays USD", () => {
    expect(rows("$20", "USD")).toEqual([["Entry", 20, "USD"]]);
  });
  it("bare $ with GBP fallback becomes USD (not in set, doesn't end with D)", () => {
    expect(rows("$20", "GBP")).toEqual([["Entry", 20, "USD"]]);
  });
  it("bare $ with CAD fallback becomes CAD (ends with D)", () => {
    expect(rows("$20", "CAD")).toEqual([["Entry", 20, "CAD"]]);
  });
  it("bare $ with COP fallback becomes COP (in set)", () => {
    expect(rows("$25.000", "COP")).toEqual([["Entry", 25000, "COP"]]);
  });
  it("ARS code in text works", () => {
    expect(rows("ARS 15.000", null)).toEqual([["Entry", 15000, "ARS"]]);
  });
  it("masks hour-suffix forms like '22 hs'", () => {
    expect(rows("$300 desde las 22 hs", "MXN")).toEqual([["Desde las 22 hs", 300, "MXN"]]);
  });
  it("masks hour-suffix forms like '22:00 hrs'", () => {
    expect(rows("$300 a partir de las 22:00 hrs", "MXN")).toEqual([
      ["A partir de las 22:00 hrs", 300, "MXN"],
    ]);
  });
});

describe("currencies", () => {
  it("maps countries and symbols", () => {
    expect(currencyForCountry("us")).toBe("USD");
    expect(currencyForCountry("FR")).toBe("EUR");
    expect(currencyForCountry("XX")).toBeNull();
    expect(currencyInText("£8", null)).toBe("GBP");
    expect(currencyInText("15 CHF", null)).toBe("CHF");
    expect(currencyInText("$10", "CAD")).toBe("CAD");
    expect(currencyInText("10", null)).toBeNull();
  });
});

describe("normalizePrices and isFreeFromPrices", () => {
  it("fills a missing currency and drops unusable rows", () => {
    expect(
      normalizePrices(
        [
          { label: "Door", amount: 15, currency: null, includes: null },
          { label: "Bad", amount: -1, currency: "USD", includes: null },
          { label: "Odd", amount: 5, currency: "US", includes: null },
        ],
        "USD",
      ),
    ).toEqual([{ label: "Door", amount: 15, currency: "USD", includes: null }]);
  });

  it("says free only when every row is free", () => {
    const free = { label: "Free", amount: 0, currency: "USD", includes: null };
    const paid = { label: "Door", amount: 10, currency: "USD", includes: null };
    const donation = { label: "Donation", amount: null, currency: "USD", includes: null };
    expect(isFreeFromPrices([free])).toBe(true);
    expect(isFreeFromPrices([free, paid])).toBe(false);
    expect(isFreeFromPrices([donation])).toBeNull();
    expect(isFreeFromPrices([])).toBeNull();
  });
});

describe("peso codes in labels (D-230)", () => {
  it("drops the code from the label and keeps the clock", () => {
    expect(parsePriceText("ARS 15.000", null).map((r) => [r.label, r.amount, r.currency])).toEqual([
      ["Entry", 15000, "ARS"],
    ]);
    expect(parsePriceText("$20 before 10pm", "USD").map((r) => r.label)).toEqual(["Before 10pm"]);
  });
});

describe("Hong Kong dollars (D-661)", () => {
  it("maps HK to HKD and reads HK$, HKD and a bare $", () => {
    expect(currencyForCountry("HK")).toBe("HKD");
    expect(currencyInText("HK$150", null)).toBe("HKD");
    expect(currencyInText("HKD 150", null)).toBe("HKD");
    expect(currencyInText("HKD150", null)).toBe("HKD");
    expect(currencyInText("$150", "HKD")).toBe("HKD");
  });
  it("parses real Hong Kong price strings", () => {
    expect(rows("HK$150", "HKD")).toEqual([["Entry", 150, "HKD"]]);
    expect(rows("HKD150 including one drink", "HKD")).toEqual([
      ["Including one drink", 150, "HKD"],
    ]);
    expect(rows("HKD 100", "HKD")).toEqual([["Entry", 100, "HKD"]]);
    expect(rows("$100 regular; $80 student", "HKD")).toEqual([
      ["Regular", 100, "HKD"],
      ["Student", 80, "HKD"],
    ]);
    expect(rows("HK$1,200 table", "HKD")).toEqual([["Table", 1200, "HKD"]]);
  });
  it("keeps US$ as USD in Hong Kong", () => {
    expect(rows("US$20", "HKD")).toEqual([["Entry", 20, "USD"]]);
  });
});
