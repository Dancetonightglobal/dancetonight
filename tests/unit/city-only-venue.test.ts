import { describe, expect, it } from "vitest";

import { isCityOnlyPlace, isCityOnlyVenue } from "@/src/domain/city-only-venue";

// D-840: folkdance.page's London feed writes the city itself as the LOCATION ("London"); it was matched to a seeded
// venue named "London" at a Wimbledon address and 79 London nights were pinned there (daily report 2026-11-10, C).

describe("isCityOnlyPlace", () => {
  it("is true for the city's own name, in any case, accents or spacing", () => {
    expect(isCityOnlyPlace("London", ["London"])).toBe(true);
    expect(isCityOnlyPlace("  LONDON ", ["London"])).toBe(true);
    expect(isCityOnlyPlace("Medellin", ["Medellín"])).toBe(true);
    expect(isCityOnlyPlace("new  york", ["New York"])).toBe(true);
  });

  it("is true for the city followed only by the city again, a short code or a country", () => {
    expect(isCityOnlyPlace("London, UK", ["London"])).toBe(true);
    expect(isCityOnlyPlace("London, United Kingdom", ["London"])).toBe(true);
    expect(isCityOnlyPlace("London, United Kingdom, London, EN, GB", ["London"])).toBe(true);
    expect(isCityOnlyPlace("London, England", ["London"])).toBe(true);
    expect(isCityOnlyPlace("Paris, France", ["Paris"])).toBe(true);
    expect(isCityOnlyPlace("Barcelona, España", ["Barcelona"])).toBe(true);
    expect(isCityOnlyPlace("Berlin, Deutschland", ["Berlin"])).toBe(true);
    expect(isCityOnlyPlace("New York, NY", ["New York"])).toBe(true);
    expect(isCityOnlyPlace("New York, NY, USA", ["New York"])).toBe(true);
    expect(isCityOnlyPlace("Austin, TX, United States", ["Austin"])).toBe(true);
  });

  it("is false for a real place, a street, a postcode or another city", () => {
    expect(isCityOnlyPlace("Cecil Sharp House", ["London"])).toBe(false);
    expect(isCityOnlyPlace("London Bridge", ["London"])).toBe(false);
    expect(isCityOnlyPlace("London Ceilidh Club", ["London"])).toBe(false);
    expect(isCityOnlyPlace("London, Cecil Sharp House", ["London"])).toBe(false);
    expect(isCityOnlyPlace("London NW1 7AY", ["London"])).toBe(false);
    expect(isCityOnlyPlace("London, NW1 7AY", ["London"])).toBe(false);
    expect(isCityOnlyPlace("2 Regent's Park Road, London", ["London"])).toBe(false);
    expect(isCityOnlyPlace("Paris", ["London"])).toBe(false);
    expect(isCityOnlyPlace("Brooklyn, NY", ["New York"])).toBe(false);
  });

  it("is false for empty text or no city names", () => {
    expect(isCityOnlyPlace(null, ["London"])).toBe(false);
    expect(isCityOnlyPlace(undefined, ["London"])).toBe(false);
    expect(isCityOnlyPlace("", ["London"])).toBe(false);
    expect(isCityOnlyPlace("   ", ["London"])).toBe(false);
    expect(isCityOnlyPlace("London", [])).toBe(false);
    expect(isCityOnlyPlace("London", [""])).toBe(false);
  });
});

describe("isCityOnlyVenue", () => {
  it("is true when the name is only the city and the address is empty or only the city", () => {
    expect(isCityOnlyVenue({ name: "London", address: null }, ["London"])).toBe(true);
    expect(isCityOnlyVenue({ name: "London", address: "" }, ["London"])).toBe(true);
    expect(isCityOnlyVenue({ name: "London", address: "London, UK" }, ["London"])).toBe(true);
  });

  it("is true when there is no name and the address is only the city", () => {
    expect(isCityOnlyVenue({ name: null, address: "London" }, ["London"])).toBe(true);
    expect(isCityOnlyVenue({ name: "", address: "London, United Kingdom" }, ["London"])).toBe(true);
  });

  it("is false when either side names a real place", () => {
    expect(
      isCityOnlyVenue({ name: "London", address: "2 Regent's Park Road, London NW1 7AY" }, [
        "London",
      ]),
    ).toBe(false);
    expect(isCityOnlyVenue({ name: "Cecil Sharp House", address: "London" }, ["London"])).toBe(
      false,
    );
    expect(isCityOnlyVenue({ name: "Cecil Sharp House", address: null }, ["London"])).toBe(false);
  });

  it("is false when there is nothing at all", () => {
    expect(isCityOnlyVenue({ name: null, address: null }, ["London"])).toBe(false);
    expect(isCityOnlyVenue({ name: "", address: "" }, ["London"])).toBe(false);
  });
});
