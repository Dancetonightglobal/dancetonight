// A venue's neighbourhood from its point (D-176): Who's On First neighbourhood outlines, the
// smallest outline that holds the point, null outside every outline.
import { describe, expect, it } from "vitest";

import { NEIGHBOURHOODS, neighbourhoodAt } from "@/src/domain/neighbourhoods";

describe("neighbourhoodAt", () => {
  it.each([
    ["House of Yes", 40.7067, -73.9235, "Bushwick"],
    ["SOB's", 40.7262, -74.0054, "SoHo"],
    ["Judson Memorial Church", 40.7302, -73.999, "Greenwich Village"],
    ["Laissez Faire, 10 Theater Alley", 40.7114, -74.0073, "Financial District"],
    ["Astoria", 40.7644, -73.9235, "Astoria"],
    ["St George ferry terminal", 40.642, -74.076, "St. George"],
    ["Lincoln Center", 40.7725, -73.9835, "Upper West Side"],
    ["The Newsroom, LIC", 40.748, -73.944, "Long Island City"],
  ])("puts %s in its neighbourhood", (_name, lat, lng, expected) => {
    expect(neighbourhoodAt({ lat, lng })).toBe(expected);
  });

  it("takes the smaller outline where two overlap", () => {
    // Gowanus Heights lies inside Gowanus's outline.
    expect(neighbourhoodAt({ lat: 40.673, lng: -73.994 })).toBe("Gowanus Heights");
  });

  it("is null on the water and outside every metro with outlines", () => {
    expect(neighbourhoodAt({ lat: 40.7, lng: -74.03 })).toBeNull(); // Upper Bay
    expect(neighbourhoodAt({ lat: 39.7392, lng: -104.9903 })).toBeNull(); // Denver (Austin became a metro, D-1180)
  });

  it("is null for a point that is not a number", () => {
    expect(neighbourhoodAt({ lat: Number.NaN, lng: -73.99 })).toBeNull();
    expect(neighbourhoodAt({ lat: 40.73, lng: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("leaves out a point inside a hole", () => {
    // A square with a square hole: the hole is not the neighbourhood.
    const square = (x0: number, y0: number, s: number): [number, number][] => [
      [x0, y0],
      [x0 + s, y0],
      [x0 + s, y0 + s],
      [x0, y0 + s],
      [x0, y0],
    ];
    const ring = { name: "Ring", polygons: [[square(10, 10, 1), square(10.4, 10.4, 0.2)]] };
    expect(neighbourhoodAt({ lat: 10.1, lng: 10.1 }, [ring])).toBe("Ring");
    expect(neighbourhoodAt({ lat: 10.5, lng: 10.5 }, [ring])).toBeNull();
  });

  it("loads New York's outlines with names", () => {
    expect(NEIGHBOURHOODS.length).toBeGreaterThan(250);
    for (const n of NEIGHBOURHOODS) expect(n.name.trim()).not.toBe("");
  });
});

describe("London's neighbourhoods (D-200)", () => {
  it.each([
    ["Fabric", 51.5196, -0.1025, "Farringdon"],
    ["Ministry of Sound", 51.4979, -0.0997, "Elephant and Castle"],
    ["Dalston Superstore", 51.5487, -0.0755, "Dalston"],
    ["Electric Brixton", 51.4627, -0.1145, "Brixton"],
    ["Ronnie Scott's", 51.5134, -0.1318, "Soho"],
    ["Royal Vauxhall Tavern", 51.4859, -0.1236, "Vauxhall"],
    ["Bethnal Green Working Men's Club", 51.5284, -0.0596, "Bethnal Green"],
  ])("puts %s in its neighbourhood", (_name, lat, lng, expected) => {
    expect(neighbourhoodAt({ lat, lng })).toBe(expected);
  });

  it("never names the river as a neighbourhood", () => {
    expect(NEIGHBOURHOODS.some((n) => n.name === "River Thames")).toBe(false);
  });
});
