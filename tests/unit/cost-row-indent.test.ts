// A cost row with no amount ("Cover not listed", "Free") starts at the left edge instead of
// sitting indented past an empty amount column (UX audit 2026-11-02, item 11).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CostSection } from "@/src/ui/detail/cost";
import type { PlacedListing } from "@/src/domain/listing";

const NY = "America/New_York";

/** A Sunday night listing shaped like the wireframe's Midtown Sunday Hop. */
function listing(overrides: Partial<PlacedListing> = {}): PlacedListing {
  const base: PlacedListing = {
    id: "evt-1",
    slug: "midtown-sunday-hop-2026-09-20",
    title: "Midtown Sunday Hop",
    listingType: "social",
    styles: ["lindy_hop"],
    families: ["swing"],
    doorsAt: new Date("2026-09-20T23:30:00Z"),
    lessonAt: new Date("2026-09-21T00:00:00Z"),
    dancingAt: new Date("2026-09-21T01:00:00Z"),
    endsAt: new Date("2026-09-21T04:30:00Z"),
    startsAt: new Date("2026-09-21T01:00:00Z"),
    nightDate: "2026-09-20",
    tz: NY,
    venue: {
      id: "ven-1",
      name: "You Should Be Dancing",
      location: { lat: 40.7505, lng: -73.9934 },
      address: {
        line1: "412 8th Ave",
        line2: "3rd floor",
        locality: "New York",
        region: "NY",
        postcode: "10001",
        countryCode: "US",
        formatted: null,
      },
      neighborhood: "Midtown",
      googlePlaceId: null,
      kind: "studio",
      danceFloor: "yes",
    },
    organizer: { name: "Midtown Hop", websiteUrl: "https://midtownhop.com", socials: {} },
    prices: [
      { label: "Social only", amount: 12, currency: "USD", includes: null },
      { label: "Lesson plus social", amount: 18, currency: "USD", includes: "Beginner lesson" },
    ],
    isFree: false,
    ticketUrl: null,
    level: "All levels",
    partnerRequired: false,
    ageMin: null,
    dressCode: null,
    floor: "Wood",
    indoorOutdoor: "indoor",
    music: { djs: ["DJ Ray"], bands: [], genreMix: "70% lindy, 30% blues", liveMusic: false },
    crowdSizeHint: "About 150 people",
    recurrenceText: "Every Sunday",
    confirmation: "confirmed_today",
    confidence: 0.8,
    summary: "Weekly lindy hop social with a beginner lesson first.",
    sources: [],
    status: "active",
    canonicalUrl: null,
    distanceKm: 3.86,
    liveStatus: null,
  };
  return { ...base, ...overrides };
}

describe("cost row indent", () => {
  it("renders 'Cover not listed' with col-span-2 and no dt", () => {
    const testListing = listing({ prices: [], isFree: false });
    const html = renderToStaticMarkup(createElement(CostSection, { listing: testListing }));
    expect(html).toContain("Cover not listed");
    expect(html).toContain("col-span-2");
    // No <dt> element
    expect(html).not.toContain("<dt");
  });

  it("renders priced rows with dt and no col-span-2", () => {
    const testListing = listing();
    const html = renderToStaticMarkup(createElement(CostSection, { listing: testListing }));
    // Should contain two <dt> elements
    const dtCount = (html.match(/<dt/g) || []).length;
    expect(dtCount).toBe(2);
    // Should not contain col-span-2
    expect(html).not.toContain("col-span-2");
  });
});
