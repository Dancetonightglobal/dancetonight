// Tokyo is the mainland Tokyo Metropolis (the 23 special wards and the Tama municipalities, the Izu
// and Ogasawara islands left out): the outline in config/metro-bounds/tokyo.json, district neighbourhoods
// from HDX COD-AB (CC BY-IGO), no postcodes (Japanese addresses use ward/municipality names), and the towns
// around it that listings name.
import { describe, expect, it } from "vitest";

import type { Metro } from "@/src/adapters/types";
import {
  METRO_OUTSIDE_TOWNS,
  METRO_POSTCODE_PREFIXES,
  titleNamesOutsideTown,
} from "@/config/metro-regions";
import { KNOWN_VENUES } from "@/config/known-venues";
import { METRO_RETIRED_SOURCES, METRO_SOURCES } from "@/config/sources";
import { RA_AREAS } from "@/config/sources/ra";
import { TOKYO_SOURCES } from "@/config/sources/tokyo";
import { insideMetro } from "@/src/domain/metro-bounds";
import { neighbourhoodAt } from "@/src/domain/neighbourhoods";

import tokyoNeighbourhoods from "@/config/neighbourhoods/tokyo.json";

const TOKYO: Metro = {
  id: "m",
  slug: "tokyo",
  name: "Tokyo",
  countryCode: "JP",
  center: { lat: 35.6812, lng: 139.7671 },
  radiusKm: 75,
  tz: "Asia/Tokyo",
  languages: ["ja", "en"],
};

describe("the Tokyo area (D-1221)", () => {
  it.each([
    ["WOMB", 35.6577, 139.6942, "Shibuya"],
    ["Zerotokyo", 35.6958, 139.7006, "Shinjuku"],
    ["Roppongi", 35.6628, 139.7314, "Minato"],
    ["Koenji", 35.7053, 139.6497, "Suginami"],
    ["Tachikawa", 35.698, 139.414, "Tachikawa"],
    ["Tokyo Big Sight", 35.6298, 139.7942, "Koto"],
    ["Hinode Pier", 35.6516, 139.7609, "Minato"],
    ["Haneda", 35.5494, 139.7798, "Ota"],
  ])("puts %s inside, in its district", (_name, lat, lng, hood) => {
    expect(insideMetro(TOKYO, { lat, lng })).toBe(true);
    expect(neighbourhoodAt({ lat, lng })).toBe(hood);
  });

  it.each([
    ["Yokohama", 35.4437, 139.638],
    ["Kawasaki station", 35.5313, 139.697],
    ["Omiya", 35.9064, 139.6239],
    ["Izu Oshima", 34.75, 139.36],
    ["Maihama", 35.6329, 139.8804],
    ["Musashi-Kosugi", 35.5765, 139.6596],
  ])("leaves %s outside", (_name, lat, lng) => {
    expect(insideMetro(TOKYO, { lat, lng })).toBe(false);
  });

  it("has the 53 districts", () => {
    const names = tokyoNeighbourhoods.neighbourhoods.map((n) => n.name);
    expect(names.length).toBe(53);
    for (const n of ["Shibuya", "Shinjuku", "Minato", "Setagaya", "Hachioji", "Machida"]) {
      expect(names).toContain(n);
    }
    // No name ends in "-ku", " City", "-machi" or "-mura"
    for (const name of names) {
      expect(name).not.toMatch(/-ku$/);
      expect(name).not.toMatch(/ City$/);
      expect(name).not.toMatch(/-machi$/);
      expect(name).not.toMatch(/-mura$/);
    }
  });
});

describe("Tokyo in the shared tables", () => {
  it("has the Tokyo postcode prefixes, a deliberate superset (D-1222)", () => {
    expect(METRO_POSTCODE_PREFIXES.tokyo).toEqual(["1", "20"]);
  });

  it("lists outside towns, never a place inside", () => {
    const towns = METRO_OUTSIDE_TOWNS.tokyo ?? [];
    for (const inside of [
      "Tokyo",
      "Shibuya",
      "Shinjuku",
      "Minato",
      "Setagaya",
      "Hachioji",
      "Machida",
    ]) {
      expect(towns).not.toContain(inside);
    }
  });

  it.each([
    ["Salsa Night Yokohama", "Yokohama"],
    ["横浜 サルサナイト", "横浜"],
    ["湘南 エクスタティックダンス", "湘南"],
    ["Bachata Social in Osaka", "Osaka"],
    ["舞浜 ハロウィンパーティー", "舞浜"],
    ["京都府京都市中京区 サルサ", "京都"],
    ["東京発 京都 バチャータ合宿", "京都"],
  ])("takes %s for a night out of town", (title, town) => {
    expect(titleNamesOutsideTown("tokyo", title)).toBe(town);
  });

  it.each([
    "DJ Kawasaki Release Party",
    "渋谷 サルサナイト",
    "Roppongi Bachata Night",
    "新宿 タンゴ ミロンガ",
    // D-782: "東京都" holds "京都" (Kyoto); Tokyo read 42420733466 took these Meetup addresses off the site.
    "東京都港区六本木3-15-24 WIN六本木１階, Tokyo, Tokyo, jp",
    "東京都渋谷区恵比寿４－４－１１太興ビルB-1,, Tokyo, Tokyo, JP",
    "東京都目黒区東山1-4-13, ASA東山ビル1F, Tokyo, Tokyo, JP",
    "東京 サルサナイト",
  ])("keeps %s in Tokyo", (title) => {
    expect(titleNamesOutsideTown("tokyo", title)).toBeNull();
  });

  it.each([
    ["Bachata Night at Shibuya"],
    ["Shinjuku Salsa Social"],
    ["Whiskey Sour Night in Roppongi"],
    ["Tokyo Nights Party"],
  ])("keeps %s in Tokyo", (title) => {
    expect(titleNamesOutsideTown("tokyo", title)).toBeNull();
  });

  it("reads Resident Advisor area 27 (Tokyo, Japan)", () => {
    expect(RA_AREAS.tokyo).toBe(27);
  });

  it("wires its sources in, its retired addresses and its known venues", () => {
    expect(METRO_SOURCES.tokyo).toBeDefined();
    const sources = METRO_SOURCES.tokyo ?? [];
    expect(sources).toHaveLength(TOKYO_SOURCES.length + 1);
    const ra = sources.filter((s) => s.platform === "ra");
    expect(ra.map((s) => s.url)).toEqual(["https://ra.co/graphql?area=27"]);
    expect(METRO_RETIRED_SOURCES.tokyo).toBeDefined();
    expect(KNOWN_VENUES.tokyo).toBeInstanceOf(Array);
  });
});
