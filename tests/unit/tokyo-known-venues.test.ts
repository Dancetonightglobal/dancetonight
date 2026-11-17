import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";

function makeListing({
  title = "Test Event",
  venueName = null,
  venueAddress = null,
  venueLocation = null,
}: {
  title?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  venueLocation?: { lat: number; lng: number } | null;
}): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-10-11",
    doors_time: "20:00",
    venue: {
      name: venueName ?? null,
      address: venueAddress ?? null,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Asia/Tokyo",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("Tokyo known venues (D-1234)", () => {
  const tokyoVenues = KNOWN_VENUES.tokyo ?? [];

  it("has 53 entries", () => {
    expect(tokyoVenues).toHaveLength(53);
  });

  it("every entry has a point inside Tokyo's box and an address in 東京都", () => {
    for (const venue of tokyoVenues) {
      expect(venue.point).toBeDefined();
      expect(venue.point!.lat).toBeGreaterThanOrEqual(35.5);
      expect(venue.point!.lat).toBeLessThanOrEqual(35.9);
      expect(venue.point!.lng).toBeGreaterThanOrEqual(139.2);
      expect(venue.point!.lng).toBeLessThanOrEqual(139.95);
      expect(venue.address).toBeDefined();
      expect(venue.address).toContain("東京都");
    }
  });

  it("no two entries share a name", () => {
    const names = tokyoVenues.flatMap((v) => v.names);
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  describe("withKnownVenue places listings correctly", () => {
    it("places Studio Pepe with matching name and address", () => {
      const listing = makeListing({
        venueName: "Studio Pepe",
        venueAddress: "〒106-0032 東京都港区六本木7-17-12",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6627765, lng: 139.7296556 });
    });

    it("places Latin Club Leon with matching name and null address", () => {
      const listing = makeListing({
        venueName: "Latin Club Leon",
        venueAddress: null,
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6930589, lng: 139.7057478 });
    });

    it("places Zita with matching name and address", () => {
      const listing = makeListing({
        venueName: "Zita",
        venueAddress: "〒141-0021 東京都品川区上大崎2-27-2 塚原ビル4F",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6343718, lng: 139.7150034 });
    });

    it("places T2 Shinjuku with matching name and address", () => {
      const listing = makeListing({
        venueName: "T2 Shinjuku",
        venueAddress: "7F, 7-1-1 Nishi-Shinjuku, Shinjuku-ku, Tokyo",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6941022, lng: 139.6992649 });
    });

    it("does NOT place Studio Pepe with mismatched Osaka address", () => {
      const listing = makeListing({
        venueName: "Studio Pepe",
        venueAddress: "〒530-0001 大阪府大阪市北区梅田1-1-1",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      // Should remain unchanged because address doesn't match Tokyo
      expect(result.venueLocation).toBeNull();
      expect(result.listing.venue.address).toBe("〒530-0001 大阪府大阪市北区梅田1-1-1");
    });
  });

  describe("batch 2 (D-1236)", () => {
    it("places BRAND SHIBUYA with matching name and address", () => {
      const listing = makeListing({
        venueName: "BRAND SHIBUYA",
        venueAddress:
          "〒150-0043 Tokyo, Shibuya City, Dogenzaka, 2 Chome−23−13 渋谷デリタワービル B1F",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6601085, lng: 139.6961331 });
    });

    it("places ZUBAR with matching name and address", () => {
      const listing = makeListing({
        venueName: "ZUBAR",
        venueAddress: "ZU Bldg 1F 2-54-4 Kitamagome Ota-ku Tokyo, 143-0021",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6002151, lng: 139.7124236 });
    });

    it("places リトゥモ with matching name and null address", () => {
      const listing = makeListing({
        venueName: "リトゥモ",
        venueAddress: null,
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.7371086, lng: 139.7502946 });
    });

    it("places SinRumbo by its street phrase under another name", () => {
      const listing = makeListing({
        venueName: "Some Milonga Name",
        venueAddress: "東京都新宿区四谷三栄町15-3 ヴィラアート四谷2F",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.687968, lng: 139.7268242 });
    });

    it("places Efecto tango with matching name and null address", () => {
      const listing = makeListing({
        venueName: "Efecto tango",
        venueAddress: null,
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.7106825, lng: 139.7042606 });
    });

    it("places SoyLatte STUDIO with matching name and address", () => {
      const listing = makeListing({
        venueName: "SoyLatte STUDIO",
        venueAddress: "3F Sugano building, 2-17-8 Nishigotanda, Shinagawa City, Tokyo",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toEqual({ lat: 35.6264541, lng: 139.7212573 });
    });

    it("does NOT place Ritmo Bar Osaka with mismatched address", () => {
      const listing = makeListing({
        venueName: "Ritmo Bar Osaka",
        venueAddress: "大阪府大阪市北区1-1-1",
        venueLocation: null,
      });
      const result = withKnownVenue(listing, tokyoVenues, "JP");
      expect(result.venueLocation).toBeNull();
      expect(result.listing.venue.address).toBe("大阪府大阪市北区1-1-1");
    });
  });

  it("places OATH at its Dogenzaka point, not the old Shibuya 4-chome node (D-1240)", () => {
    const listing = makeListing({
      venueName: "OATH",
      venueAddress: "1-6-5-B1F Dogenzaka, Shibuya-ku, Tokyo, 150-0043",
      venueLocation: null,
    });
    const result = withKnownVenue(listing, tokyoVenues, "JP");
    expect(result.venueLocation).toEqual({ lat: 35.657711, lng: 139.699249 });
  });

  it("names HIROO MILONGA's hall, not the FamilyMart below it (D-1242)", () => {
    const listing = makeListing({
      title: "HIROO MILONGA ~ E&A MILONGA produce",
      venueName: "ファミリーマート広尾駅前",
      venueAddress: "〒106-0047 東京都港区南麻布5-10-26 ORE広尾ビル2F",
      venueLocation: null,
    });
    const result = withKnownVenue(listing, tokyoVenues, "JP");
    expect(result.listing.venue.name).toBe("ORE広尾ビル 2F");
    expect(result.venueLocation).toEqual({ lat: 35.6528393, lng: 139.7223769 });
  });
});
