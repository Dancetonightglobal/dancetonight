import { describe, expect, it } from "vitest";
import { isBookingTitle, sameTimeKeeper } from "@/src/pipeline/store";

describe("isBookingTitle", () => {
  it("returns true for booking titles", () => {
    expect(isBookingTitle("B-Day Celebrations @ Spades")).toBe(true);
    expect(isBookingTitle("Birthday Package")).toBe(true);
    expect(isBookingTitle("BDAY at Noto")).toBe(true);
    expect(isBookingTitle("VIP Table Reservations")).toBe(true);
    expect(isBookingTitle("Bottle Service Friday")).toBe(true);
    expect(isBookingTitle("bottle special")).toBe(true);
    expect(isBookingTitle("table reservation")).toBe(true);
    expect(isBookingTitle("reservations")).toBe(true);
    expect(isBookingTitle("booth")).toBe(true);
    expect(isBookingTitle("sections")).toBe(true);
  });

  it("returns false for non-booking titles", () => {
    expect(isBookingTitle("FRIEDdays SPADES")).toBe(false);
    expect(isBookingTitle("Salsa Night")).toBe(false);
    expect(isBookingTitle("Tablao Flamenco")).toBe(false); // no whole word "table"
    expect(isBookingTitle("Sectional Bachata")).toBe(false); // no whole word "section"
    expect(isBookingTitle("Turntable Tuesdays")).toBe(false);
  });
});

describe("sameTimeKeeper", () => {
  it("chooses non-booking title over booking title", () => {
    const rows = [
      { title: "B-Day Celebrations @ Spades", titleNormalized: "bday celebrations spades" },
      { title: "FRIEDdays SPADES", titleNormalized: "frieddays spades" },
    ];
    const keeper = sameTimeKeeper(rows);
    expect(keeper.title).toBe("FRIEDdays SPADES");
  });

  it("chooses non-booking title over booking title (reverse order)", () => {
    const rows = [
      { title: "FRIEDdays SPADES", titleNormalized: "frieddays spades" },
      { title: "B-Day Celebrations @ Spades", titleNormalized: "bday celebrations spades" },
    ];
    const keeper = sameTimeKeeper(rows);
    expect(keeper.title).toBe("FRIEDdays SPADES");
  });

  it("chooses by dance styles when both are non-booking", () => {
    const rows = [
      { title: "Salsa Night", titleNormalized: "salsa night" },
      { title: "Thursday Night", titleNormalized: "thursday night" },
    ];
    const keeper = sameTimeKeeper(rows);
    expect(keeper.title).toBe("Salsa Night");
  });

  it("chooses lower titleNormalized when styles equal and both non-booking", () => {
    const rows = [
      { title: "Zebra Night", titleNormalized: "zebra night" },
      { title: "Alpha Night", titleNormalized: "alpha night" },
    ];
    const keeper = sameTimeKeeper(rows);
    expect(keeper.titleNormalized).toBe("alpha night");
  });

  it("non-booking wins over booking even if booking has styles", () => {
    const rows = [
      { title: "Birthday Salsa Night", titleNormalized: "birthday salsa night" },
      { title: "Thursday Party", titleNormalized: "thursday party" },
    ];
    const keeper = sameTimeKeeper(rows);
    expect(keeper.title).toBe("Thursday Party");
  });

  it("throws on empty array", () => {
    expect(() => sameTimeKeeper([])).toThrow("sameTimeKeeper requires at least one row");
  });
});
