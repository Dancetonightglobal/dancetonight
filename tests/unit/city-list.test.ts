import { describe, expect, it } from "vitest";
import { MockListingsRepository } from "@/src/data/mock-repository";
import { LONDON_METRO } from "@/src/db/seed/london";

describe("MockListingsRepository listCities", () => {
  it("returns exactly two cities, names ['London', 'New York'] in that order", async () => {
    const repo = new MockListingsRepository();
    const cities = await repo.listCities(new Date());
    expect(cities).toHaveLength(2);
    expect(cities.map((c) => c.name)).toEqual(["London", "New York"]);
  });

  it("New York hasListings true for a now that the seed fills", async () => {
    const repo = new MockListingsRepository();
    // Use a date that the seed will have listings for
    const now = new Date("2026-09-20T23:42:00Z"); // same as in db-repository.test.ts
    const cities = await repo.listCities(now);
    const nyc = cities.find((c) => c.slug === "nyc");
    expect(nyc).toBeDefined();
    expect(nyc?.hasListings).toBe(true);
  });

  it("London hasListings false and its centre equals LONDON_METRO.center", async () => {
    const repo = new MockListingsRepository();
    const cities = await repo.listCities(new Date());
    const london = cities.find((c) => c.slug === "london");
    expect(london).toBeDefined();
    expect(london?.hasListings).toBe(false);
    expect(london?.center).toEqual({
      lat: LONDON_METRO.center.lat,
      lng: LONDON_METRO.center.lng,
    });
  });
});
