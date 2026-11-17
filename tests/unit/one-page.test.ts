import { describe, it, expect } from "vitest";
import { onePageTwice } from "@/src/domain/one-page";
import type { DedupeSide } from "@/src/domain/dedupe";

// Helper to create minimal DedupeSide fixtures
function createSide(overrides: Partial<DedupeSide>): DedupeSide {
  const now = new Date();
  return {
    id: "test-id",
    startsAt: null,
    organizerId: "org-1",
    organizerName: "Organizer",
    venueId: "venue-1",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "unofficial",
    firstSeenAt: now,
    ...overrides,
  };
}

describe("onePageTwice", () => {
  it("returns true for Canal Zero example: both untimed, same venueId, same ticketUrl", () => {
    const url = "https://www.m2miami.com/events/canal-zero-mineu";
    const a = createSide({
      startsAt: null,
      venueId: "m2miami",
      ticketUrl: url,
      canonicalUrl: "https://www.m2miami.com/events", // list page
    });
    const b = createSide({
      startsAt: null,
      venueId: "m2miami",
      ticketUrl: url,
      canonicalUrl: "https://www.m2miami.com/events", // list page
    });

    expect(onePageTwice(a, b)).toBe(true);
  });

  it("returns true for BalletX example: both timed, same venueId, same canonicalUrl", () => {
    const starts = new Date("2026-11-06T23:45:00Z");
    const url = "https://www.ourphilly.org/events/balletx-lindy-hop-101-2026-11-06-1845";
    const a = createSide({
      startsAt: starts,
      venueId: "balletx-studio",
      ticketUrl: null,
      canonicalUrl: url,
      listingType: "class",
    });
    const b = createSide({
      startsAt: starts,
      venueId: "balletx-studio",
      ticketUrl: null,
      canonicalUrl: url,
      listingType: "class",
    });

    expect(onePageTwice(a, b)).toBe(true);
  });

  it("returns false when only shared URL is a list page", () => {
    const listUrl = "https://www.m2miami.com/events";
    const a = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: null,
      canonicalUrl: listUrl,
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: null,
      canonicalUrl: listUrl,
    });

    expect(onePageTwice(a, b)).toBe(false);
  });

  it("returns false when same ticket page but different start times", () => {
    const url = "https://example.com/event";
    const a = createSide({
      startsAt: new Date("2026-11-06T20:00:00Z"),
      venueId: "venue-1",
      ticketUrl: url,
    });
    const b = createSide({
      startsAt: new Date("2026-11-06T23:00:00Z"),
      venueId: "venue-1",
      ticketUrl: url,
    });

    expect(onePageTwice(a, b)).toBe(false);
  });

  // D-804: Penthouse Dubai, 2026-11-14: one events list gave the night timed and untimed, both on one event page.
  it("returns true when one untimed and one timed share one event page", () => {
    const url = "https://www.thepenthouse.co/dubai/events/house-rules-richy-ahmed-14112026";
    const a = createSide({
      startsAt: new Date("2026-11-14T18:00:00Z"),
      venueId: "venue-penthouse",
      ticketUrl: url,
      canonicalUrl: "https://www.thepenthouse.co/dubai/events",
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-penthouse",
      canonicalUrl: url,
    });

    expect(onePageTwice(a, b)).toBe(true);
  });

  // D-804: Marula Café, Barcelona, 2026-11-09: "MARULA CLUB Dj Kusuri" 11pm and untimed "Dj Kusuri", one page.
  it("returns true for Marula: timed and untimed on one /evento/ page", () => {
    const url = "https://marulacafe.com/evento/dj-kusuri-3/";
    const a = createSide({
      startsAt: new Date("2026-11-09T22:59:00Z"),
      venueId: "venue-marula",
      ticketUrl: "https://www.unclebeat.com/store-2/p/offbeatmarula",
      canonicalUrl: url,
    });
    const b = createSide({ startsAt: null, venueId: "venue-marula", canonicalUrl: url });

    expect(onePageTwice(a, b)).toBe(true);
  });

  it("returns false when one untimed and one timed share only a list page", () => {
    const list = "https://marulacafe.com/agenda/";
    const a = createSide({ startsAt: new Date("2026-11-08T22:59:00Z"), canonicalUrl: list });
    const b = createSide({ startsAt: null, canonicalUrl: list });

    expect(onePageTwice(a, b)).toBe(false);
  });

  it("returns false when same ticket page but different venueIds", () => {
    const url = "https://example.com/event";
    const a = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url,
      venuePoint: { lat: 40.0, lng: -75.0 },
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-2", // Different venueId
      ticketUrl: url,
      venuePoint: { lat: 40.1, lng: -75.1 }, // ~11 km apart
    });

    expect(onePageTwice(a, b)).toBe(false);
  });

  it("returns false when one side is cancelled", () => {
    const url = "https://example.com/event";
    const a = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url,
      cancelled: true,
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url,
    });

    expect(onePageTwice(a, b)).toBe(false);
  });

  it("returns true for cross match: a.ticketUrl equals b.canonicalUrl", () => {
    const url = "https://example.com/specific-event";
    const a = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url,
      canonicalUrl: null,
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: null,
      canonicalUrl: url,
    });

    expect(onePageTwice(a, b)).toBe(true);
  });

  it("returns true for trailing-slash difference (sameLink handles it)", () => {
    const url1 = "https://www.eventbrite.com/e/test-event";
    const url2 = "https://www.eventbrite.com/e/test-event/";
    const a = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url1,
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url2,
    });

    expect(onePageTwice(a, b)).toBe(true);
  });

  it("returns false when different listing types", () => {
    const url = "https://example.com/event";
    const a = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url,
      listingType: "class",
    });
    const b = createSide({
      startsAt: null,
      venueId: "venue-1",
      ticketUrl: url,
      listingType: "social", // Different type
    });

    expect(onePageTwice(a, b)).toBe(false);
  });
});
