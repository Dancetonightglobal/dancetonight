import { describe, expect, it } from "vitest";

import {
  BUGECE_CITIES,
  CLUB_GENRES,
  bugeceAdapter,
  bugeceToListings,
  bugeceUrl,
} from "@/src/adapters/apis/bugece";
import type { Metro } from "@/src/adapters/types";

const ISTANBUL: Metro = {
  id: "m1",
  slug: "istanbul",
  name: "Istanbul",
  countryCode: "TR",
  center: { lat: 41.0082, lng: 28.9784 },
  radiusKm: 60,
  tz: "Europe/Istanbul",
  languages: ["tr"],
};

const NIGHTS = ["2026-11-05", "2026-11-06", "2026-11-07"];

describe("Bugece", () => {
  it("bugeceUrl builds correct URL", () => {
    const url = bugeceUrl("istanbul", 2);
    expect(url).toBe("https://bugece.co/api/list?indices=events&city=istanbul&page=2&pageSize=100");
  });

  it("bugeceToListings keeps techno night", () => {
    const hit = {
      _id: "6a89ee5f88517765029a8a93",
      name: "FIDELES: KLEIN PHÖNIX, ISTANBUL",
      start_time: "2026-11-06T19:00:00.000Z",
      end_time: "2026-11-07T02:00:00.000Z",
      venue: { name: "Klein Phönix", slug: "klein-phonix" },
      slug: "fideles-klein-phonix-istanbul-11-13-26--1a2b3c4d",
      music_categories: [{ name: "Techno" }, { name: "Melodic" }],
      city: { name: "Istanbul" },
      _geo: { lat: 41.11887051028702, lng: 29.024402375651174 },
      show_price: true,
      starting_from: 750,
      starting_from_format: "₺750",
    };

    const { listings, screened } = bugeceToListings([hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date("2026-10-31T09:00:00Z"),
    });

    expect(listings).toHaveLength(1);
    expect(screened).toHaveLength(0);
    const listing = listings[0]!;
    expect(listing.externalId).toBe("bugece:6a89ee5f88517765029a8a93");
    expect(listing.listing.title).toBe("FIDELES: KLEIN PHÖNIX, ISTANBUL");
    expect(listing.listing.local_date).toBe("2026-11-06");
    expect(listing.listing.doors_time).toBe("22:00"); // 19:00 UTC -> 22:00 Istanbul
    expect(listing.listing.end_time).toBe("05:00"); // 02:00 UTC -> 05:00 Istanbul, inside the night
    expect(listing.listing.prices).toEqual([
      { label: "Tickets from", amount: 750, currency: "TRY", includes: null },
    ]);
    expect(listing.venueLocation).toEqual({
      lat: 41.11887051028702,
      lng: 29.024402375651174,
    });
    expect(listing.eventUrl).toBe(
      "https://bugece.co/tr/event/fideles-klein-phonix-istanbul-11-13-26--1a2b3c4d",
    );
    expect(listing.listing.styles).toContain("techno");
    expect(listing.listing.styles).toContain("house");
  });

  it("screens concert with non-club genre", () => {
    const hit = {
      _id: "concert123",
      name: "Punk Rock Night",
      start_time: "2026-11-05T16:30:00.000Z",
      end_time: "2026-11-05T19:30:00.000Z",
      venue: { name: "Venue" },
      slug: "punk-rock",
      music_categories: [{ name: "Punk" }],
      city: { name: "Istanbul" },
      _geo: { lat: 41, lng: 29 },
      show_price: true,
      starting_from: 100,
    };

    const { listings, screened } = bugeceToListings([hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(0);
    expect(screened).toHaveLength(1);
    expect(screened[0]!.reason).toContain("Punk");
    expect(screened[0]!.reason).toContain("19:30");
  });

  it("screens daytime festival", () => {
    const hit = {
      _id: "day123",
      name: "Daytime Festival",
      start_time: "2026-11-07T11:00:00.000Z",
      end_time: "2026-11-07T18:00:00.000Z",
      venue: { name: "Park" },
      slug: "day-fest",
      music_categories: [{ name: "Techno" }, { name: "House" }],
      city: { name: "Istanbul" },
      _geo: { lat: 41, lng: 29 },
      show_price: false,
    };

    const { listings, screened } = bugeceToListings([hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(0);
    expect(screened).toHaveLength(1);
    expect(screened[0]!.reason).toContain("starts 14:00");
  });

  it("keeps hip-hop party", () => {
    const hit = {
      _id: "hiphop456",
      name: "90s HIP-HOP PARTY",
      start_time: "2026-11-07T20:45:00.000Z",
      end_time: "2026-11-08T02:00:00.000Z",
      venue: { name: "Club" },
      slug: "90s-hip-hop",
      music_categories: [{ name: "Hip-Hop I R&B" }],
      city: { name: "Istanbul" },
      _geo: { lat: 41, lng: 29 },
      show_price: true,
      starting_from: 200,
    };

    const { listings, screened } = bugeceToListings([hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(1);
    expect(screened).toHaveLength(0);
    expect(listings[0]!.listing.styles).toEqual(["hip_hop_club"]);
  });

  it("ignores hit outside nights window", () => {
    const hit = {
      _id: "future",
      name: "Future Event",
      start_time: "2026-11-20T22:00:00.000Z",
      end_time: "2026-11-21T04:00:00.000Z",
      venue: { name: "Venue" },
      slug: "future-event",
      music_categories: [{ name: "Techno" }],
      city: { name: "Istanbul" },
      _geo: { lat: 41, lng: 29 },
      show_price: true,
      starting_from: 150,
    };

    const { listings, screened } = bugeceToListings([hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(0);
    expect(screened).toHaveLength(0);
  });

  it("deduplicates same _id", () => {
    const hit = {
      _id: "dupe",
      name: "Same Event",
      start_time: "2026-11-06T21:00:00.000Z",
      end_time: "2026-11-07T03:00:00.000Z",
      venue: { name: "Venue" },
      slug: "same",
      music_categories: [{ name: "Techno" }],
      city: { name: "Istanbul" },
      _geo: { lat: 41, lng: 29 },
      show_price: true,
      starting_from: 100,
    };

    const { listings } = bugeceToListings([hit, hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(1);
  });

  it("handles show_price false", () => {
    const hit = {
      _id: "noprice",
      name: "No Price Event",
      start_time: "2026-11-06T22:00:00.000Z",
      end_time: "2026-11-07T04:00:00.000Z",
      venue: { name: "Venue" },
      slug: "no-price",
      music_categories: [{ name: "Techno" }],
      city: { name: "Istanbul" },
      _geo: { lat: 0, lng: 0 },
      show_price: false,
    };

    const { listings } = bugeceToListings([hit], {
      metro: ISTANBUL,
      nights: NIGHTS,
      fetchedAt: new Date(),
    });

    expect(listings).toHaveLength(1);
    expect(listings[0]!.listing.prices).toEqual([]);
    expect(listings[0]!.venueLocation).toBeNull();
  });

  it("bugeceAdapter has correct properties", () => {
    expect(bugeceAdapter.id).toBe("bugece");
    expect(bugeceAdapter.tier).toBe("A");
    expect(bugeceAdapter.countries).toEqual(["TR"]);
    expect(bugeceAdapter.requiredEnv).toEqual([]);
    expect(bugeceAdapter.limits).toEqual({
      perDomainIntervalMs: 2000,
      rps: 0.5,
      perDay: 50,
    });
  });

  it("CLUB_GENRES contains expected genres", () => {
    expect(CLUB_GENRES).toContain("Techno");
    expect(CLUB_GENRES).toContain("House");
    expect(CLUB_GENRES).toContain("Melodic");
    expect(CLUB_GENRES).toContain("Trance");
  });

  it("BUGECE_CITIES maps istanbul", () => {
    expect(BUGECE_CITIES.istanbul).toBe("istanbul");
  });
});
