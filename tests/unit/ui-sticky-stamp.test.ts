import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Timeline } from "@/src/ui/home/Timeline";
import { buildTimeline, meridiemReference, railStamp } from "@/src/ui/home/timeline-rows";
import type { Listing } from "@/src/domain/listing";
import { localInstant } from "@/src/domain/time";

const ZONE = "America/New_York";
const LOCALE = "en-US";

// Helpers as in ui-home.test.ts.
const at = (hour: number, minute = 0, day = "2026-09-20") => localInstant(day, ZONE, hour, minute);

const RENDER_NOW = at(19, 42);

function fakeListing(id: string, startsAt: Date | null, endsAt: Date | null): Listing {
  return {
    id,
    slug: id,
    title: id,
    listingType: "social",
    styles: ["salsa"],
    families: ["salsa"],
    doorsAt: null,
    lessonAt: null,
    dancingAt: startsAt,
    endsAt,
    startsAt,
    nightDate: "2026-09-20",
    tz: ZONE,
    venue: {
      id: `${id}-venue`,
      name: "A hall",
      location: { lat: 40.7128, lng: -74.006 },
      address: null,
      neighborhood: "SoHo",
      googlePlaceId: null,
      kind: "dance_hall",
      danceFloor: "yes",
    },
    organizer: null,
    prices: [{ label: "Door", amount: 15, currency: "USD", includes: null }],
    isFree: false,
    ticketUrl: null,
    level: null,
    partnerRequired: null,
    ageMin: null,
    dressCode: null,
    floor: null,
    indoorOutdoor: null,
    music: null,
    crowdSizeHint: null,
    recurrenceText: null,
    confirmation: "confirmed_today",
    confidence: null,
    summary: null,
    sources: [
      {
        url: "https://organiser.example/nights",
        label: "organiser.example",
        checkedAt: new Date(RENDER_NOW.getTime() - 2 * 3_600_000),
        byOrganiser: true,
        tier: "organizer",
        eventUrl: null,
      },
    ],
    status: "active",
    canonicalUrl: null,
    distanceKm: 1.2,
    liveStatus: null,
  };
}

function bill(listings: Listing[], now: Date, options: { sort: "start" | "distance" }) {
  return buildTimeline({ listings, now, zone: ZONE, locale: LOCALE, showNow: true, ...options });
}

describe("sticky stamp overlay", () => {
  it("groups consecutive cards with the same stamp under start sort", () => {
    const sameTime = at(20);
    const laterTime = at(21);
    const listings = [
      fakeListing("a", sameTime, at(23)),
      fakeListing("b", sameTime, at(23)),
      fakeListing("c", laterTime, at(23)),
    ];
    const { rows } = bill(listings, RENDER_NOW, { sort: "start" });
    const reference = meridiemReference("2026-09-20", ZONE, RENDER_NOW, true);
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        rows,
        stampFor: (listing) =>
          listing.startsAt === null
            ? "Time not listed"
            : railStamp(listing.startsAt, ZONE, LOCALE, reference),
        formatClock: (instant: Date) => instant.toLocaleTimeString(LOCALE),
        now: RENDER_NOW,
        locale: LOCALE,
        railed: true,
      }),
    );
    // Should have exactly 2 sticky-stamp overlays (one for each time group)
    const stickyStampElements = (html.match(/data-sticky-stamp/g) || []).length;
    expect(stickyStampElements).toBe(2);
    // All three cards should be present
    expect((html.match(/href="\/e\//g) || []).length).toBe(3);
    // First group's overlay should contain the shared stamp text
    const firstStamp = railStamp(sameTime, ZONE, LOCALE, reference);
    expect(html).toContain(firstStamp);
  });

  it("renders no sticky overlay under distance sort", () => {
    const listings = [fakeListing("a", at(20), at(23)), fakeListing("b", at(20), at(23))];
    const { rows } = bill(listings, RENDER_NOW, { sort: "distance" });
    const reference = meridiemReference("2026-09-20", ZONE, RENDER_NOW, true);
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        rows,
        stampFor: (listing) =>
          listing.startsAt === null
            ? "Time not listed"
            : railStamp(listing.startsAt, ZONE, LOCALE, reference),
        formatClock: (instant: Date) => instant.toLocaleTimeString(LOCALE),
        now: RENDER_NOW,
        locale: LOCALE,
        railed: false,
      }),
    );
    expect(html).not.toContain("data-sticky-stamp");
  });

  it("does not group untimed listings", () => {
    const untimed = fakeListing("untimed", null, at(23));
    const timed = fakeListing("timed", at(20), at(23));
    const listings = [timed, untimed];
    const { rows } = bill(listings, RENDER_NOW, { sort: "start" });
    const reference = meridiemReference("2026-09-20", ZONE, RENDER_NOW, true);
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        rows,
        stampFor: (listing) =>
          listing.startsAt === null
            ? "Time not listed"
            : railStamp(listing.startsAt, ZONE, LOCALE, reference),
        formatClock: (instant: Date) => instant.toLocaleTimeString(LOCALE),
        now: RENDER_NOW,
        locale: LOCALE,
        railed: true,
      }),
    );
    // The untimed listing should be in a separate section, not grouped with timed cards
    expect(html).toContain("Time not listed");
    // There should be exactly 1 sticky-stamp overlay (for the timed group)
    // Untimed groups don't get a sticky stamp overlay
    const stickyStampElements = (html.match(/data-sticky-stamp/g) || []).length;
    expect(stickyStampElements).toBe(1);
  });
});
