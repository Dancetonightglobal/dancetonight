import { describe, it, expect } from "vitest";
import { cityPathSlug, cityRewrite, CITY_CENTERS } from "@/src/ui/home/city-path";

const centers = {
  nyc: { lat: 40.7128, lng: -74.006 },
  "san-juan": { lat: 18.4494, lng: -66.0663 },
  "buenos-aires": { lat: -34.6037, lng: -58.3816 },
} as const;

describe("cityPathSlug", () => {
  it("extracts slug from pathname", () => {
    expect(cityPathSlug("/san-juan")).toBe("san-juan");
    expect(cityPathSlug("/San-Juan/")).toBe("san-juan");
    expect(cityPathSlug("/buenos%2Daires")).toBe("buenos-aires");
  });

  it("returns null for invalid paths", () => {
    expect(cityPathSlug("/")).toBeNull();
    expect(cityPathSlug("/e/abc")).toBeNull();
    expect(cityPathSlug("/san-juan/x")).toBeNull();
    expect(cityPathSlug("/%E0%A4%A")).toBeNull();
    expect(cityPathSlug("/robots.txt")).toBeNull();
    expect(cityPathSlug("/icon.svg")).toBeNull();
  });
});

describe("cityRewrite", () => {
  it("returns coordinates for a known city", () => {
    const result = cityRewrite("/san-juan", new URLSearchParams(), centers);
    expect(result).not.toBeNull();
    expect(result!.get("lat")).toBe("18.44940");
    expect(result!.get("lng")).toBe("-66.06630");
  });

  it("replaces lat/lng, removes place, keeps other params", () => {
    const search = new URLSearchParams(
      "lat=1&lng=2&place=x&day=2026-11-03&style=salsa&style=bachata",
    );
    const before = new URLSearchParams(search);
    const result = cityRewrite("/san-juan", search, centers);
    expect(result).not.toBeNull();
    expect(result!.get("lat")).toBe("18.44940");
    expect(result!.get("lng")).toBe("-66.06630");
    expect(result!.get("place")).toBeNull();
    expect(result!.get("day")).toBe("2026-11-03");
    expect(result!.getAll("style")).toEqual(["salsa", "bachata"]);
    // Input unchanged
    expect([...search.entries()]).toEqual([...before.entries()]);
  });

  it("returns null for unknown city", () => {
    expect(cityRewrite("/atlantis", new URLSearchParams(), centers)).toBeNull();
    expect(cityRewrite("/bot", new URLSearchParams(), centers)).toBeNull();
    expect(cityRewrite("/report", new URLSearchParams(), centers)).toBeNull();
  });

  it("uses default CITY_CENTERS", () => {
    const result = cityRewrite("/san-juan", new URLSearchParams());
    expect(result).not.toBeNull();
    expect(CITY_CENTERS["san-juan"]).toBeDefined();
  });
  it("ignores inherited object keys", () => {
    expect(cityRewrite("/constructor", new URLSearchParams())).toBeNull();
    expect(cityRewrite("/__proto__", new URLSearchParams())).toBeNull();
    expect(cityRewrite("/tostring", new URLSearchParams())).toBeNull();
  });
});
