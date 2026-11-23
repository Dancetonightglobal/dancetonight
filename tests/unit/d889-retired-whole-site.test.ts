import { describe, expect, it } from "vitest";
import { retiredMatches } from "@/src/pipeline/retired-sources";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";

// D-889: a retirement marked wholeSite retires every page of that host in the metro, whatever page discovery
// stored; any other retirement still matches its exact address only.
describe("D-889 retired whole sites", () => {
  const site = { url: "https://www.vteatro.com/", wholeSite: true };
  it.each([
    "https://www.vteatro.com/cartelera",
    "https://vteatro.com/obras?page=2",
    "http://www.vteatro.com/",
    "https://www.vteatro.com/",
  ])("%s is retired by the whole site", (source) => {
    expect(retiredMatches(source, site)).toBe(true);
  });

  it.each(["https://tickets.vteatro.com/", "https://www.vteatro.com.mx/", "not a url"])(
    "%s is not the retired site",
    (source) => {
      expect(retiredMatches(source, site)).toBe(false);
    },
  );

  it("an address without wholeSite retires that page only (a seeded events page on the host stays)", () => {
    const home = { url: "https://nylindy.com/" };
    expect(retiredMatches("https://nylindy.com/", home)).toBe(true);
    expect(retiredMatches("https://www.nylindy.com/dances-2026", home)).toBe(false);
  });

  it("no whole-site retirement covers a starting page of its own metro", () => {
    for (const [metro, list] of Object.entries(METRO_RETIRED_SOURCES)) {
      for (const retired of list.filter((r) => r.wholeSite)) {
        const hit = (METRO_SOURCES[metro] ?? []).filter((s) => retiredMatches(s.url, retired));
        expect(
          hit.map((s) => s.url),
          `${metro} ${retired.url}`,
        ).toEqual([]);
      }
    }
  });

  it("Mexico City retires vteatro.com, a theatre ticket site (plays listed as socials)", () => {
    expect(METRO_RETIRED_SOURCES["mexico-city"]).toContainEqual(
      expect.objectContaining({ url: "https://www.vteatro.com/", wholeSite: true }),
    );
  });
});
