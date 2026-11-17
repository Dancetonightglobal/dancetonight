import { describe, expect, it } from "vitest";
import { wpTribeToListings } from "@/src/adapters/feeds/wp-tribe";

describe("wp_tribe adapter with mixedCalendar", () => {
  const baseOptions = {
    siteUrl: "https://ballandchainmiami.com/live-music/",
    fetchedAt: new Date("2026-11-03T12:00:00Z"),
    metroTz: "America/New_York",
    countryCode: "US",
    fromNight: "2026-11-03",
  };

  it("returns empty styles and no styles evidence when mixedCalendar is true", () => {
    const events = [
      {
        id: 1,
        status: "publish",
        title: "The Ball & Chain Trio",
        start_date: "2026-11-04 12:00:00",
        timezone: "America/New_York",
        categories: [{ name: "Live Salsa &amp; Jazz All Day" }],
        venue: {
          venue: "Ball & Chain",
          address: "1513 SW 8th Street",
          city: "Miami",
          state: "FL",
          zip: "33135",
        },
      },
    ];
    const { listings } = wpTribeToListings(events, {
      ...baseOptions,
      mixedCalendar: true,
    });
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.listing.styles).toEqual([]);
    expect(listing.listing.evidence.styles).toBeUndefined();
  });

  it("returns styles from categories when mixedCalendar is absent", () => {
    const events = [
      {
        id: 2,
        status: "publish",
        title: "The Ball & Chain Trio",
        start_date: "2026-11-04 12:00:00",
        timezone: "America/New_York",
        categories: [{ name: "Live Salsa &amp; Jazz All Day" }],
        venue: {
          venue: "Ball & Chain",
          address: "1513 SW 8th Street",
          city: "Miami",
          state: "FL",
          zip: "33135",
        },
      },
    ];
    const { listings } = wpTribeToListings(events, baseOptions);
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.listing.styles).toContain("salsa");
    expect(listing.listing.evidence.styles).toBeDefined();
  });

  it("returns styles from categories when mixedCalendar is false", () => {
    const events = [
      {
        id: 3,
        status: "publish",
        title: "The Ball & Chain Trio",
        start_date: "2026-11-04 12:00:00",
        timezone: "America/New_York",
        categories: [{ name: "Live Salsa &amp; Jazz All Day" }],
        venue: {
          venue: "Ball & Chain",
          address: "1513 SW 8th Street",
          city: "Miami",
          state: "FL",
          zip: "33135",
        },
      },
    ];
    const { listings } = wpTribeToListings(events, {
      ...baseOptions,
      mixedCalendar: false,
    });
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.listing.styles).toContain("salsa");
    expect(listing.listing.evidence.styles).toBeDefined();
  });

  it("handles categories that don't match any style with mixedCalendar true", () => {
    const events = [
      {
        id: 4,
        status: "publish",
        title: "BachaTuesday",
        start_date: "2026-11-03 23:30:00",
        timezone: "America/New_York",
        categories: [{ name: "BachaTuesdays" }],
        venue: {
          venue: "Ball & Chain",
          address: "1513 SW 8th Street",
          city: "Miami",
          state: "FL",
          zip: "33135",
        },
      },
    ];
    const { listings } = wpTribeToListings(events, {
      ...baseOptions,
      mixedCalendar: true,
    });
    expect(listings).toHaveLength(1);
    const listing = listings[0]!;
    expect(listing.listing.styles).toEqual([]);
    expect(listing.listing.evidence.styles).toBeUndefined();
  });
});
