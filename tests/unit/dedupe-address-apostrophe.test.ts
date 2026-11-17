import { describe, expect, it } from "vitest";

import { onePlace, sameStreetAddress, type DedupeSide } from "@/src/domain/dedupe";

// D-869: London, daily site check 2026-11-11 (C). Eventbrite's "Wimbledon Salsa & Bachata Club" (venue named
// after the school, "44 St Georges Road, London, ENG, SW19 4ED") and social-dance.today's "Mondays at Wimbledon
// Salsa & Bachata Club" (Drake House Dance Hall, "44 St George’s Rd, Wimbledon London SW19 4ED"), both 7pm on
// 11-16, 8.75 m apart: the apostrophe split "george s" from "georges", so D-591 saw two street addresses.

const A = "44 St George’s Rd, Wimbledon London SW19 4ED, United Kingdom, Wimbledon";
const B = "44 St Georges Road, London, ENG, SW19 4ED";

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: new Date("2026-11-16T19:00:00Z"),
  organizerId: null,
  organizerName: null,
  venueId: "v1",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "ticketing",
  firstSeenAt: new Date("2026-11-01T00:00:00Z"),
  ...over,
});

describe("an apostrophe joins its word in a street address (D-869)", () => {
  it("St George’s Rd is St Georges Road, curly or straight", () => {
    expect(sameStreetAddress(A, B)).toBe(true);
    expect(sameStreetAddress(A.replace("’", "'"), B)).toBe(true);
    expect(sameStreetAddress("12 Kingʼs Road, London", "12 Kings Rd, London")).toBe(true);
  });

  it("another house number or street is still another address", () => {
    expect(sameStreetAddress(A, "46 St Georges Road, London, ENG, SW19 4ED")).toBe(false);
    expect(sameStreetAddress(A, "44 St George Road, London SW19 4ED")).toBe(false);
  });

  it("the two Wimbledon venue rows are one place", () => {
    const a = side({
      id: "a",
      venueId: "v1",
      venueName: "Wimbledon Salsa & Bachata Club",
      venueAddress: B,
      venuePoint: { lat: 51.41973114013672, lng: -0.210295990109444 },
    });
    const b = side({
      id: "b",
      venueId: "v2",
      venueName: "Drake House Dance Hall",
      venueAddress: A,
      venuePoint: { lat: 51.4197302, lng: -0.2104218 },
    });
    expect(onePlace(a, b)).toBe(true);
  });
});
