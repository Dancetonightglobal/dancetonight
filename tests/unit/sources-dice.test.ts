import { describe, expect, it } from "vitest";
import { diceSources, DICE_GENRES } from "@/config/sources/dice";
import { NYC_SOURCES } from "@/config/sources/nyc";
import { LONDON_SOURCES } from "@/config/sources/london";
import { diceAdapter } from "@/src/adapters/apis/dice";

describe("DICE shared sources", () => {
  it("diceSources returns DJ, Party, and genre pages", () => {
    const sources = diceSources("https://dice.fm/browse/x/music", "Test", [["dj/house", "House"]]);
    expect(sources).toHaveLength(3);
    expect(sources[0]!.url).toBe("https://dice.fm/browse/x/music/dj");
    expect(sources[0]!.label).toBe("DICE Test: DJ");
    expect(sources[1]!.url).toBe("https://dice.fm/browse/x/music/party");
    expect(sources[1]!.label).toBe("DICE Test: Party");
    expect(sources[2]!.url).toBe("https://dice.fm/browse/x/music/dj/house");
    expect(sources[2]!.label).toBe("DICE Test: House");
    for (const source of sources) {
      expect(source.platform).toBe("dice");
      expect(source.kind).toBe("ticketing_api");
      expect(source.trustTier).toBe("ticketing");
      expect(source.styles).toEqual(["dj_night"]);
    }
  });

  it("NYC_SOURCES has the correct number of DICE sources", () => {
    const diceSources = NYC_SOURCES.filter((s) => s.platform === "dice");
    expect(diceSources).toHaveLength(2 + DICE_GENRES.length);
    for (const source of diceSources) {
      expect(source.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/new_york-5bbf4db0f06331478e9b2c59\/music\//,
      );
    }
    const firstTwo = diceSources.slice(0, 2);
    expect(firstTwo[0]!.url.endsWith("/dj")).toBe(true);
    expect(firstTwo[1]!.url.endsWith("/party")).toBe(true);
    for (const source of diceSources) {
      expect(source.label).toMatch(/^DICE New York: /);
    }
  });

  it("LONDON_SOURCES has the correct number of DICE sources", () => {
    const diceSources = LONDON_SOURCES.filter((s) => s.platform === "dice");
    expect(diceSources).toHaveLength(2 + DICE_GENRES.length);
    for (const source of diceSources) {
      expect(source.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/london-54d8a23438fe5d27d500001c\/music\//,
      );
    }
    const firstTwo = diceSources.slice(0, 2);
    expect(firstTwo[0]!.url.endsWith("/dj")).toBe(true);
    expect(firstTwo[1]!.url.endsWith("/party")).toBe(true);
    for (const source of diceSources) {
      expect(source.label).toMatch(/^DICE London: /);
    }
  });

  it("diceAdapter.countries includes US and GB", () => {
    expect(diceAdapter.countries).toContain("US");
    expect(diceAdapter.countries).toContain("GB");
    expect(diceAdapter.countries).toContain("DE"); // Berlin (owner, 2026-11-06, D-1023)
  });
});
