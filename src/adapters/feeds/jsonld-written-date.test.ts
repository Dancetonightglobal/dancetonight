import { describe, expect, it } from "vitest";

import { writtenDateOnly, jsonLdToListings } from "@/src/adapters/feeds/jsonld";
import type { LocalMoment } from "@/src/adapters/shared";

describe("writtenDateOnly", () => {
  const nycZone = "America/New_York";

  it("parses Month D, YYYY format", () => {
    const result = writtenDateOnly("Oct 29, 2026", nycZone);
    expect(result).toEqual({
      day: "2026-10-29",
      night: "2026-10-29",
      time: null,
      zone: "America/New_York",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("parses Month D YYYY format without comma", () => {
    const result = writtenDateOnly("October 29 2026", nycZone);
    expect(result).toEqual({
      day: "2026-10-29",
      night: "2026-10-29",
      time: null,
      zone: "America/New_York",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("parses with weekday prefix", () => {
    const result = writtenDateOnly("Thu, Oct 29, 2026", nycZone);
    expect(result).toEqual({
      day: "2026-10-29",
      night: "2026-10-29",
      time: null,
      zone: "America/New_York",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("parses D Month YYYY format", () => {
    const result = writtenDateOnly("29 October 2026", nycZone);
    expect(result).toEqual({
      day: "2026-10-29",
      night: "2026-10-29",
      time: null,
      zone: "America/New_York",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("parses D Mon YYYY format", () => {
    const result = writtenDateOnly("29 Oct 2026", nycZone);
    expect(result).toEqual({
      day: "2026-10-29",
      night: "2026-10-29",
      time: null,
      zone: "America/New_York",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("parses Sept abbreviation", () => {
    const result = writtenDateOnly("Sept 3, 2026", nycZone);
    expect(result).toEqual({
      day: "2026-09-03",
      night: "2026-09-03",
      time: null,
      zone: "America/New_York",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("falls back to UTC for invalid zone", () => {
    const result = writtenDateOnly("Oct 29, 2026", "Invalid/Zone");
    expect(result).toEqual({
      day: "2026-10-29",
      night: "2026-10-29",
      time: null,
      zone: "UTC",
      absolute: false,
    } satisfies LocalMoment);
  });

  it("returns null for date with time", () => {
    expect(writtenDateOnly("Oct 29, 2026 8:00 PM", nycZone)).toBeNull();
  });

  it("returns null for slash format", () => {
    expect(writtenDateOnly("10/29/2026", nycZone)).toBeNull();
  });

  it("returns null for yearless date", () => {
    expect(writtenDateOnly("Oct 29", nycZone)).toBeNull();
  });

  it("returns null for invalid calendar date", () => {
    expect(writtenDateOnly("Feb 30, 2026", nycZone)).toBeNull();
  });

  it("returns null for date range", () => {
    expect(writtenDateOnly("Oct 29-30, 2026", nycZone)).toBeNull();
  });

  it("returns null for non-string", () => {
    expect(writtenDateOnly(42, nycZone)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(writtenDateOnly("", nycZone)).toBeNull();
  });
});

describe("jsonLdToListings with written dates", () => {
  it("creates an untimed listing from a written-out startDate", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Salsa at the Barbary",
        startDate: "Oct 29, 2026",
        location: {
          "@type": "Place",
          name: "The Barbary",
          address: "951 Frankford Ave, Philadelphia, PA 19125",
        },
      },
    ];
    const { listings, notes } = jsonLdToListings(blocks, {
      pageUrl: "https://thebarbaryphl.com/calendar",
      fetchedAt: new Date("2026-10-29T12:00:00Z"),
      metroTz: "America/New_York",
      countryCode: "US",
      fromNight: "2026-10-29",
      days: 14,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!.listing;
    expect(listing.local_date).toBe("2026-10-29");
    expect(listing.doors_time).toBeNull();
    expect(listing.lesson_time).toBeNull();
    expect(listing.dancing_time).toBeNull();
    expect(listing.evidence).toMatchObject({ start: "startDate Oct 29, 2026" });
  });

  it("still reads ISO date-only startDate as before", () => {
    const blocks = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Brooklyn Social",
        startDate: "2026-09-25",
        location: {
          "@type": "Place",
          name: "Brooklyn Commons",
          address: "495 Flatbush Ave, Brooklyn, NY",
        },
      },
    ];
    const { listings, notes } = jsonLdToListings(blocks, {
      pageUrl: "https://studio.example/events/",
      fetchedAt: new Date("2026-09-23T16:00:00Z"),
      metroTz: "America/New_York",
      countryCode: "US",
      fromNight: "2026-09-23",
      days: 14,
    });
    expect(notes).toEqual([]);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!.listing;
    expect(listing.local_date).toBe("2026-09-25");
    expect(listing.doors_time).toBeNull();
    expect(listing.lesson_time).toBeNull();
    expect(listing.dancing_time).toBeNull();
    expect(listing.evidence).toMatchObject({ start: "startDate 2026-09-25" });
  });
});
