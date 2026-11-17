import { describe, expect, it } from "vitest";

import { onePlace, scorePair, type DedupeSide } from "@/src/domain/dedupe";
import { postcodeAfterStreet } from "@/src/domain/same-name-address";

// D-843: two venue rows with one name at one street address are one place even when their geocodes drift
// further apart than D-765's 300 m: NYC "Vybz Astoria" at 2826 Steinway St, rows 453 m apart, held
// "Ladies Night at VYBZ Astoria" twice at 10pm on 11-12 (daily 2026-11-10, section C).
function side(
  id: string,
  venueId: string,
  venueName: string,
  venueAddress: string,
  lat: number,
  title: string,
  ticketUrl: string,
): DedupeSide {
  return {
    id,
    title,
    titleNormalized: title.toLowerCase(),
    listingType: "party",
    startsAt: new Date("2026-11-13T03:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-10T00:00:00Z"),
    venueName,
    venueAddress,
    venuePoint: { lat, lng: -73.9145 },
  };
}

// 0.00407 degrees of latitude is about 453 m.
const eventbrite = side(
  "eb",
  "v-64a3bd42",
  "Vybz Astoria",
  "2826 Steinway St, Astoria, NY 11103",
  40.7637,
  "Ladies Night at VYBZ Astoria – Ladies Night in Queens",
  "https://www.eventbrite.com/e/ladies-night-1",
);
const tickeri = side(
  "tk",
  "v-a093d49f",
  "Vybz Astoria",
  "2826 Steinway St, Astoria, NY, 11103-3332",
  40.76777,
  "Ladies Night at VYBZ Astoria – November 12",
  "https://www.tickeri.com/events/ladies-night-2",
);

describe("one venue name at one street address is one place (D-843)", () => {
  it("the two Vybz Astoria rows 453 m apart are one place", () => {
    expect(onePlace(eventbrite, tickeri)).toBe(true);
    expect(onePlace(tickeri, eventbrite)).toBe(true);
  });

  it("their two 10pm Ladies Night listings are one night", () => {
    const r = scorePair(eventbrite, tickeri, {
      titleSimilarity: 0.55,
      organizerSimilarity: null,
      sameSource: false,
    });
    expect(r.decision).toBe("auto_merge");
  });

  it("beyond 600 m they stay two places", () => {
    const far = { ...tickeri, venuePoint: { lat: 40.7637 + 0.0063, lng: -73.9145 } }; // ~700 m
    expect(onePlace(eventbrite, far)).toBe(false);
  });

  it("names that only share a first word keep the 300 m limit", () => {
    const other = { ...tickeri, venueName: "Vybz Lounge" };
    expect(onePlace(eventbrite, other)).toBe(false);
  });

  it("one name at two house numbers stays two places", () => {
    const other = { ...tickeri, venueAddress: "2830 Steinway St, Astoria, NY 11103" };
    expect(onePlace(eventbrite, other)).toBe(false);
  });

  it("case and accents do not tell names apart", () => {
    const other = { ...tickeri, venueName: "VYBZ ASTORIA" };
    expect(onePlace(eventbrite, other)).toBe(true);
  });

  it("without one postcode on both, D-765's 300 m stands", () => {
    const noZip = { ...tickeri, venueAddress: "2826 Steinway St, Astoria, NY" };
    expect(onePlace(eventbrite, noZip)).toBe(false);
    const otherZip = { ...tickeri, venueAddress: "2826 Steinway St, Astoria, NY 11105" };
    expect(onePlace(eventbrite, otherZip)).toBe(false);
  });

  it("a UK postcode counts, spaced or not", () => {
    const a = {
      ...eventbrite,
      venueName: "Oslo Hackney",
      venueAddress: "1A Amhurst Road, London E8 1LL",
    };
    const b = {
      ...tickeri,
      venueName: "Oslo Hackney",
      venueAddress: "1A Amhurst Road, Hackney, E81LL",
    };
    expect(onePlace(a, b)).toBe(true);
  });
});

describe("postcodeAfterStreet", () => {
  it("reads a ZIP or UK postcode after the street line only", () => {
    expect(postcodeAfterStreet("2826 Steinway St, Astoria, NY, 11103-3332")).toBe("11103");
    expect(postcodeAfterStreet("2 Regent's Park Road, London NW1 7AY")).toBe("NW17AY");
    expect(postcodeAfterStreet("12345 Main St, Springfield")).toBe(null);
    expect(postcodeAfterStreet("Amhurst Road")).toBe(null);
  });
});
