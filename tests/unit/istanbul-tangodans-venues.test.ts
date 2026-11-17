// Istanbul TangoDANS venues: config tests for cov-82 (2026-10-31)
import { describe, expect, it } from "vitest";

import { ISTANBUL_SOURCES } from "@/config/sources/istanbul";
import { KNOWN_VENUES } from "@/config/known-venues";
import { lineOnPage } from "@/src/domain/fixed-nights";

const istanbulVenues = KNOWN_VENUES.istanbul ?? [];
const istanbulSources = ISTANBUL_SOURCES;

describe("Istanbul TangoDANS config", () => {
  const tangoDans = istanbulSources.find((s) => s.url === "https://tangodans.com/en/milongas");

  it("has mixedCalendar false, weeklyGrid true, trustTier directory", () => {
    expect(tangoDans).toBeDefined();
    expect(tangoDans?.mixedCalendar).toBe(false);
    expect(tangoDans?.weeklyGrid).toBe(true);
    expect(tangoDans?.trustTier).toBe("directory");
  });

  it("has exactly one fixedNight for Monday Armada with correct fields", () => {
    expect(tangoDans?.fixedNights).toHaveLength(1);
    const fn = tangoDans?.fixedNights?.[0];
    expect(fn?.days).toEqual([1]);
    expect(fn?.start).toBe("21:00");
    expect(fn?.end).toBe("01:00");
    expect(fn?.replacesTitles).toContain("Armada Otel Milonga");
    expect(fn?.danceCited).toBeTruthy();
    expect(fn?.danceCited.length).toBeGreaterThan(0);
    // Title uniqueness across all Istanbul sources
    const allFixedNightTitles = istanbulSources.flatMap(
      (s) => s.fixedNights?.map((f) => f.title) ?? [],
    );
    const uniqueTitles = new Set(allFixedNightTitles);
    expect(uniqueTitles.size).toBe(allFixedNightTitles.length);
  });

  it("lineOnPage finds the Armada line in the page text", () => {
    const pageText =
      "Pazartesi\nArmada Otel / Sultanahmet / Ahırkapı Restaurant / İstanbul\n21:00 - 01:00\nSerdar Sungar - 0532 664 88 36";
    const line = "Armada Otel / Sultanahmet / Ahırkapı Restaurant / İstanbul";
    expect(lineOnPage(line, pageText)).toBe(true);
  });

  it("every titleVenues value is a Known Venue with a point", () => {
    const tv = tangoDans?.titleVenues ?? {};
    for (const [key, venueName] of Object.entries(tv)) {
      const venue = istanbulVenues.find((v) => v.names[0] === venueName);
      expect(venue, `titleVenues["${key}"] -> "${venueName}" not found`).toBeDefined();
      expect(venue?.point, `KnownVenue "${venueName}" has no point`).toBeDefined();
    }
  });

  it("each expected title contains at least one titleVenues key (case-insensitive)", () => {
    const tvKeys = Object.keys(tangoDans?.titleVenues ?? {});
    const titles = [
      "Tango Mia Milonga",
      "Tango Mia Pratik Milonga",
      "Milonga 333",
      "Milonga Tormenta",
      "Zeytuna Tango Milongası",
      "Milongahane / Bora Erdem Dans Cafe",
      "Tangoist Stüdyo Milongası",
      "TangoDANS Monday Milonga at Armada Otel",
    ];
    for (const title of titles) {
      const lowerTitle = title.toLowerCase();
      const found = tvKeys.some((k) => lowerTitle.includes(k.toLowerCase()));
      expect(found, `title "${title}" contains no titleVenues key`).toBe(true);
    }
  });

  it("every Istanbul Known Venue with a point has valid Istanbul coordinates", () => {
    for (const v of istanbulVenues) {
      if (v.point) {
        expect(v.point.lat).toBeGreaterThanOrEqual(40.8);
        expect(v.point.lat).toBeLessThanOrEqual(41.6);
        expect(v.point.lng).toBeGreaterThanOrEqual(27.9);
        expect(v.point.lng).toBeLessThanOrEqual(29.95);
      }
    }
  });

  it("both Swing Planet entries have a point", () => {
    const bomonti = istanbulVenues.find((v) => v.names.includes("Swing Planet Bomonti"));
    const kadikoy = istanbulVenues.find((v) => v.names.includes("Swing Planet Kadıköy"));
    expect(bomonti?.point).toBeDefined();
    expect(kadikoy?.point).toBeDefined();
  });

  it("no name appears in two Istanbul Known Venues (case-insensitive)", () => {
    // One entry may list case forms of its own name; a name must not belong to two entries.
    const allNames: string[] = [];
    for (const v of istanbulVenues) {
      allNames.push(...new Set(v.names.map((n) => n.toLowerCase())));
    }
    const uniqueNames = new Set(allNames);
    expect(uniqueNames.size).toBe(allNames.length);
  });
});
