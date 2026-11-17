import { describe, expect, it } from "vitest";

import type { HarvestedListing, Metro } from "@/src/adapters/types";
import { isPlaceholderLink } from "@/src/domain/event-links";
import { rawListingSchema } from "@/src/domain/listing";
import { normalizeListing } from "@/src/pipeline/normalize";

// D-745: itsmenna.com's own page for "Intermediate Dabke Class" (NYC 11-08) links tickets at
// https://www.eventbrite.com/e/intermediate-dabke-class-tickets-1234567890: a template link nobody
// filled in (404). A card must not send dancers to it.

const PLACEHOLDER = "https://www.eventbrite.com/e/intermediate-dabke-class-tickets-1234567890";

describe("isPlaceholderLink", () => {
  it("is true for a sequential or repeated-digit id", () => {
    expect(isPlaceholderLink(PLACEHOLDER)).toBe(true);
    expect(isPlaceholderLink("https://www.eventbrite.com/e/x-tickets-123456789")).toBe(true);
    expect(isPlaceholderLink("https://www.eventbrite.com/e/x-tickets-0123456789")).toBe(true);
    expect(isPlaceholderLink("https://tickets.example/event/00000000")).toBe(true);
    expect(isPlaceholderLink("https://tickets.example/buy?id=11111111")).toBe(true);
  });
  it("is false for real ids, including ones that hold the run inside a longer number", () => {
    expect(
      isPlaceholderLink("https://www.eventbrite.com/e/salsa-night-tickets-1757062834291"),
    ).toBe(false);
    expect(isPlaceholderLink("https://www.eventbrite.com/e/x-tickets-91234567890123")).toBe(false);
    expect(isPlaceholderLink("https://ra.co/events/2575169")).toBe(false);
    expect(isPlaceholderLink("https://example.org/2026/11/08/dabke")).toBe(false);
    expect(isPlaceholderLink("https://example.org/1111111")).toBe(false);
  });
  it("is false for text that is not an http URL", () => {
    expect(isPlaceholderLink("not a url 1234567890")).toBe(false);
  });
});

const NYC: Metro = {
  id: "m",
  slug: "nyc",
  name: "New York",
  countryCode: "US",
  center: { lat: 40.7128, lng: -74.006 },
  radiusKm: 50,
  tz: "America/New_York",
  languages: ["en"],
};
const NOW = new Date("2026-11-05T16:00:00Z");

function harvested(ticketUrl: string): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      listing_type: "class",
      styles: [],
      venue: {},
      organizer: {},
      title: "Intermediate Dabke Class",
      local_date: "2026-11-08",
      lesson_time: "18:00",
      ticket_url: ticketUrl,
    }),
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: null,
    eventUrl: "https://itsmenna.com/events/1757-intermediate-dabke-class/",
    provenance: { sourceUrl: "https://itsmenna.com/events", fetchedAt: NOW, method: "feed" },
  };
}

const ctx = { metro: NYC, source: { styles: [] as string[] }, now: NOW };

describe("normalizeListing drops a placeholder ticket link (D-745)", () => {
  it("stores no ticket link for a template id", () => {
    const out = normalizeListing(harvested(PLACEHOLDER), ctx);
    if (!out.ok) throw new Error(out.reason);
    expect(out.event.ticketUrl).toBeNull();
    expect(out.event.canonicalUrl).toBe(
      "https://itsmenna.com/events/1757-intermediate-dabke-class/",
    );
  });
  it("keeps a real ticket link", () => {
    const real = "https://www.eventbrite.com/e/intermediate-dabke-class-tickets-1757062834291";
    const out = normalizeListing(harvested(real), ctx);
    if (!out.ok) throw new Error(out.reason);
    expect(out.event.ticketUrl).toBe(real);
  });
});
