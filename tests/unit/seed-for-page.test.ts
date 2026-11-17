import { describe, expect, test } from "vitest";
import { seedNightTitles } from "@/src/pipeline/seed-for-page";
import type { SeedSource } from "@/config/sources/nyc";

describe("seedNightTitles", () => {
  const mockSeeds: SeedSource[] = [
    {
      url: "https://example.com/events",
      danceNights: ["Night A", "Night B"],
      notDanceNights: ["Concert X"],
    } as unknown as SeedSource,
    {
      url: "https://example.com/events?type=club",
      danceNights: ["Club Night"],
      notDanceNights: undefined,
    } as unknown as SeedSource,
    {
      url: "https://example.com/events/",
      danceNights: ["Night C"],
      notDanceNights: ["Training Y"],
    } as unknown as SeedSource,
    {
      url: "https://example.com/archive",
      danceNights: [],
      notDanceNights: undefined,
    } as unknown as SeedSource,
    {
      url: "https://www.example.com/events",
      danceNights: ["WWW Night"],
      notDanceNights: ["WWW Concert"],
    } as unknown as SeedSource,
    {
      url: "https://example.com/events?page=1",
      danceNights: ["Page 1 Night"],
      notDanceNights: undefined,
    } as unknown as SeedSource,
  ];

  test("exact match returns its lists", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events");
    expect(result.danceNights).toEqual(["Night A", "Night B"]);
    expect(result.notDanceNights).toEqual(["Concert X"]);
  });

  test("exact match with no lists returns empty/undefined even when query-less twin exists", () => {
    const seeds: SeedSource[] = [
      {
        url: "https://example.com/events?page=2",
        danceNights: undefined,
        notDanceNights: undefined,
      } as unknown as SeedSource,
      {
        url: "https://example.com/events",
        danceNights: ["Should not be used"],
        notDanceNights: ["Should not be used"],
      } as unknown as SeedSource,
    ];
    const result = seedNightTitles(seeds, "https://example.com/events?page=2");
    expect(result.danceNights).toEqual([]);
    expect(result.notDanceNights).toBeUndefined();
  });

  test("/events?9dda5f90_page=2 gets /events's lists", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events?9dda5f90_page=2");
    expect(result.danceNights).toEqual(["Night A", "Night B"]);
    expect(result.notDanceNights).toEqual(["Concert X"]);
  });

  test("/events/?p=2 gets /events/ (with trailing slash) lists", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events/?p=2");
    expect(result.danceNights).toEqual(["Night C"]);
    expect(result.notDanceNights).toEqual(["Training Y"]);
  });

  test("with fragment #frag gets base URL's lists", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events#frag");
    expect(result.danceNights).toEqual(["Night A", "Night B"]);
    expect(result.notDanceNights).toEqual(["Concert X"]);
  });

  test("different path (/events/archive?p=2) gets nothing", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events/archive?p=2");
    expect(result.danceNights).toEqual([]);
    expect(result.notDanceNights).toBeUndefined();
  });

  test("different host (no www) gets nothing when seed has www", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events?page=2");
    // Should match the non-www seed, not the www one
    expect(result.danceNights).toEqual(["Night A", "Night B"]);
    expect(result.notDanceNights).toEqual(["Concert X"]);
  });

  test("seed with its own query string is not used as fallback", () => {
    const result = seedNightTitles(mockSeeds, "https://example.com/events?page=2");
    // Should match the seed without query (https://example.com/events), not the one with ?type=club
    expect(result.danceNights).toEqual(["Night A", "Night B"]);
    expect(result.notDanceNights).toEqual(["Concert X"]);
  });

  test("invalid URL returns empty", () => {
    const result = seedNightTitles(mockSeeds, "not-a-valid-url");
    expect(result.danceNights).toEqual([]);
    expect(result.notDanceNights).toBeUndefined();
  });

  test("seed with query string not used as fallback for other queries", () => {
    const seeds: SeedSource[] = [
      {
        url: "https://example.com/events?type=club",
        danceNights: ["Club Night"],
        notDanceNights: undefined,
      } as unknown as SeedSource,
      // No seed without query
    ];
    const result = seedNightTitles(seeds, "https://example.com/events?page=2");
    expect(result.danceNights).toEqual([]);
    expect(result.notDanceNights).toBeUndefined();
  });

  test("trailing slash normalization works both ways", () => {
    const seeds: SeedSource[] = [
      {
        url: "https://example.com/events",
        danceNights: ["No Slash"],
        notDanceNights: undefined,
      } as unknown as SeedSource,
    ];
    // Target with slash should match seed without slash
    const result1 = seedNightTitles(seeds, "https://example.com/events/");
    expect(result1.danceNights).toEqual(["No Slash"]);

    // Also test the opposite
    const seeds2: SeedSource[] = [
      {
        url: "https://example.com/events/",
        danceNights: ["With Slash"],
        notDanceNights: undefined,
      } as unknown as SeedSource,
    ];
    const result2 = seedNightTitles(seeds2, "https://example.com/events");
    expect(result2.danceNights).toEqual(["With Slash"]);
  });
});
