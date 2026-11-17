import { describe, expect, it } from "vitest";
import { dropUtcOffset, jsonLdToListings } from "@/src/adapters/feeds/jsonld";

describe("dropUtcOffset", () => {
  it("drops -06:00 offset", () => {
    expect(dropUtcOffset("2026-11-08T20:00:00-06:00")).toBe("2026-11-08T20:00:00");
  });
  it("drops +05:30 offset", () => {
    expect(dropUtcOffset("2026-11-08T20:00:00+05:30")).toBe("2026-11-08T20:00:00");
  });
  it("drops -0600 offset", () => {
    expect(dropUtcOffset("2026-11-08T20:00:00-0600")).toBe("2026-11-08T20:00:00");
  });
  it("drops Z", () => {
    expect(dropUtcOffset("2026-11-08T20:00:00Z")).toBe("2026-11-08T20:00:00");
  });
  it("keeps date-only unchanged", () => {
    expect(dropUtcOffset("2026-11-08")).toBe("2026-11-08");
  });
  it("keeps no-offset unchanged", () => {
    expect(dropUtcOffset("2026-11-08T20:00:00")).toBe("2026-11-08T20:00:00");
  });
  it("keeps non-string unchanged", () => {
    expect(dropUtcOffset(123)).toBe(123);
    expect(dropUtcOffset(null)).toBe(null);
    expect(dropUtcOffset(undefined)).toBe(undefined);
  });
});

describe("jsonLdToListings with wallClockTimes", () => {
  const ev = (name: string, startDate: string, endDate?: string) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name,
    startDate,
    endDate: endDate ?? startDate,
    location: {
      "@type": "Place",
      name: "Salon Sombrero",
      address: "Tulum, Q.R.",
    },
  });

  const baseOptions = {
    pageUrl: "https://www.salsavida.com/guides/mexico/quintana-roo/tulum/",
    fetchedAt: new Date("2026-11-07T12:00:00Z"),
    metroTz: "America/Cancun",
    countryCode: "MX",
    fromNight: "2026-11-07",
  };

  it("reads offset times as local wall clock when wallClock: true", () => {
    const blocks = [
      ev(
        "Salsa and Bachata Night at Salon Sombrero",
        "2026-11-08T20:00:00-06:00",
        "2026-11-09T01:00:00-06:00",
      ),
    ];
    const { listings } = jsonLdToListings(blocks, { ...baseOptions, wallClock: true });
    expect(listings).toHaveLength(1);
    const listing = listings[0]?.listing;
    expect(listing?.local_date).toBe("2026-11-08");
    // Without wallClock, UTC-5 Cancun would convert -06:00 to 21:00 local.
    // With wallClock, we drop offset and read 20:00 as local.
    expect(listing?.doors_time ?? listing?.dancing_time ?? listing?.lesson_time).toBe("20:00");
    // End time after midnight should be 01:00 on 2026-11-09 (local date)
    const end = listings[0]?.listing.end_time;
    expect(end).toBe("01:00");
  });

  it("without wallClock uses offset conversion", () => {
    const blocks = [ev("Salsa and Bachata Night at Salon Sombrero", "2026-11-08T20:00:00-06:00")];
    // Salsa Vida pages always read the wall clock (D-778), so the offset case uses another site.
    const { listings } = jsonLdToListings(blocks, {
      ...baseOptions,
      pageUrl: "https://example.com/events/",
    });
    expect(listings).toHaveLength(1);
    const listing = listings[0]?.listing;
    // America/Cancun is UTC-5, so -06:00 offset => 21:00 local
    expect(listing?.doors_time ?? listing?.dancing_time ?? listing?.lesson_time).toBe("21:00");
  });

  it("handles date-only startDate unchanged", () => {
    const blocks = [ev("Salsa Night", "2026-11-08")];
    const { listings } = jsonLdToListings(blocks, { ...baseOptions, wallClock: true });
    expect(listings).toHaveLength(1);
    const listing = listings[0]?.listing;
    expect(listing?.local_date).toBe("2026-11-08");
    expect(listing?.doors_time ?? listing?.dancing_time ?? listing?.lesson_time).toBeNull();
  });
});
