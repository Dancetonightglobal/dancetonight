import { describe, it, expect } from "vitest";
import { neighbourhoodUpdates } from "@/src/pipeline/venue-neighbourhoods";
import { summaryFacts } from "@/src/pipeline/summarize";
import type { Point } from "@/src/domain/listing";

describe("neighbourhoodUpdates", () => {
  it("returns update when stored null and computed non-null", () => {
    const rows = [
      {
        id: "1",
        location: { lat: 40.7, lng: -74.0 },
        neighborhood: null,
      },
    ];
    const at = (p: Point) => "Roma Norte";
    const updates = neighbourhoodUpdates(rows, at);
    expect(updates).toEqual([{ id: "1", neighborhood: "Roma Norte" }]);
  });

  it("returns no update when stored equals computed", () => {
    const rows = [
      {
        id: "1",
        location: { lat: 40.7, lng: -74.0 },
        neighborhood: "Roma Norte",
      },
    ];
    const at = (p: Point) => "Roma Norte";
    const updates = neighbourhoodUpdates(rows, at);
    expect(updates).toEqual([]);
  });

  it("returns update when stored non-null and computed null", () => {
    const rows = [
      {
        id: "1",
        location: { lat: 40.7, lng: -74.0 },
        neighborhood: "Old",
      },
    ];
    const at = (p: Point) => null;
    const updates = neighbourhoodUpdates(rows, at);
    expect(updates).toEqual([{ id: "1", neighborhood: null }]);
  });

  it("skips rows without location", () => {
    const rows = [
      {
        id: "1",
        location: null,
        neighborhood: null,
      },
      {
        id: "2",
        location: { lat: 40.7, lng: -74.0 },
        neighborhood: null,
      },
    ];
    const at = (p: Point) => "Roma Norte";
    const updates = neighbourhoodUpdates(rows, at);
    // Only row 2 should be updated
    expect(updates).toEqual([{ id: "2", neighborhood: "Roma Norte" }]);
  });
});

describe("summaryFacts", () => {
  it("does not include neighborhood in facts", () => {
    const row = {
      title: "Test Event",
      listingType: "class",
      styles: [],
      nightDate: "2026-10-30",
      tz: "America/New_York",
      doorsAt: null,
      lessonAt: null,
      dancingAt: null,
      endsAt: null,
      prices: [],
      isFree: null,
      level: null,
      partnerRequired: null,
      ageMin: null,
      dressCode: null,
      floor: null,
      indoorOutdoor: null,
      music: null,
      crowdSizeHint: null,
      venueName: "Test Venue",
      neighborhood: "Test Neighborhood", // This should be ignored
      organizerName: null,
    };
    const facts = summaryFacts(row);
    expect(facts.neighborhood).toBeUndefined();
    // Verify other facts are present
    expect(facts.title).toBe("Test Event");
    expect(facts.venue).toBe("Test Venue");
  });
});
