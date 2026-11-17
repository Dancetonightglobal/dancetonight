// One street address written two ways by two venue rows (2026-11-05): NYC NEXO "29 W 36TH ST, New York,
// NY 10018" beside "29 West 36th Street, New York, NY 10018"; London Simmons Bar "109 Kingsway, London,
// ENG, WC2B 6PP" beside "109 Kingsway, London WC2B 6PP, United Kingdom, London". The street line (the
// part before the first comma, with common abbreviations spelled out) decides; the rest may differ.
import { describe, expect, it } from "vitest";

import { onePlace, sameStreetAddress, type DedupeSide } from "@/src/domain/dedupe";

describe("sameStreetAddress on the street line", () => {
  it("spells out direction and street-type abbreviations", () => {
    expect(
      sameStreetAddress(
        "29 W 36TH ST, New York, NY 10018",
        "29 West 36th Street, New York, NY 10018",
      ),
    ).toBe(true);
    expect(sameStreetAddress("12 Main St.", "12 Main Street, Springfield")).toBe(true);
    expect(sameStreetAddress("5 Kings Rd, London", "5 Kings Road, Chelsea, London")).toBe(true);
    expect(sameStreetAddress("100 5th Ave, New York", "100 Fifth Avenue, New York")).toBe(false);
    expect(sameStreetAddress("100 5th Ave, New York", "100 5th Avenue, NY 10011")).toBe(true);
  });

  it("one street line with the city and postcode written differently is one address", () => {
    expect(
      sameStreetAddress(
        "109 Kingsway, London, ENG, WC2B 6PP",
        "109 Kingsway, London WC2B 6PP, United Kingdom, London",
      ),
    ).toBe(true);
    expect(
      sameStreetAddress(
        "178 JUNCTION ROAD, LONDON, ENG, N19 5QQ",
        "178 Junction Road, London N19 5QQ, United Kingdom",
      ),
    ).toBe(true);
  });

  it("different house numbers, streets or directions are different addresses", () => {
    expect(sameStreetAddress("29 W 36th St, New York", "31 W 36th St, New York")).toBe(false);
    expect(sameStreetAddress("29 W 36th St, New York", "29 E 36th St, New York")).toBe(false);
    expect(sameStreetAddress("29 W 36th St, New York", "29 W 37th St, New York")).toBe(false);
    expect(sameStreetAddress("178 Junction Road, London", "178 Junction Street, London")).toBe(
      false,
    );
  });

  it("a street line with no house number is no street address", () => {
    expect(
      sameStreetAddress("Junction Road, Tufnell Park, London", "Junction Road, London N19 5QQ"),
    ).toBe(false);
  });
});

function side(id: string, venueId: string, venueName: string, venueAddress: string): DedupeSide {
  return {
    id,
    startsAt: new Date("2026-11-08T03:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-10-29T00:00:00Z"),
    venueName,
    venueAddress,
    venuePoint: { lat: 40.7505665, lng: -73.985069 },
  };
}

describe("onePlace with one street line", () => {
  it("NEXO and a row named by its street address are one place", () => {
    const tickeri = side("t", "v-nexo", "NEXO", "29 W 36TH ST, New York, NY 10018");
    const eventbrite = side(
      "e",
      "v-29w36",
      "29 W 36th St.",
      "29 West 36th Street, New York, NY 10018",
    );
    expect(onePlace(tickeri, eventbrite)).toBe(true);
  });

  it("different street lines at one point with unalike names stay two places", () => {
    const a = side("a", "v1", "NEXO", "29 W 36th St, New York, NY 10018");
    const b = side("b", "v2", "Other Club", "31 W 36th St, New York, NY 10018");
    expect(onePlace(a, b)).toBe(false);
  });
});
