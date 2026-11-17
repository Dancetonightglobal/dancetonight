// The Nashville starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and Resident Advisor only through config/sources/ra.ts (D-505).
import { describe, expect, it } from "vitest";

import { NASHVILLE_RETIRED, NASHVILLE_SOURCES } from "@/config/sources/nashville";
import { METRO_SOURCES, METRO_RETIRED_SOURCES } from "@/config/sources";
import { RA_AREAS } from "@/config/sources/ra";
import { STYLES } from "@/config/styles";

const listed = NASHVILLE_SOURCES.map((seed) => seed.url);
const retired = NASHVILLE_RETIRED.map((gone) => gone.url);

describe("Nashville's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of NASHVILLE_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of NASHVILLE_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of NASHVILLE_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl", () => {
    for (const seed of NASHVILLE_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of NASHVILLE_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });
});

describe("American Legion Post 82's Thursday night", () => {
  it("replaces the model's copy of its own header line, raw and tidied (D-837)", () => {
    const post82 = NASHVILLE_SOURCES.find((s) => s.url === "https://nashvillepost82.org/")!;
    const night = post82.fixedNights![0]!;
    const replaced = (night.replacesTitles ?? []).map((t) => t.trim().toLowerCase());
    expect(replaced).toContain("live music and dance lessons on thursdays");
    expect(replaced).toContain("live music and dance lessons");
  });
});

describe("Nashville in the shared metro sources", () => {
  it("METRO_SOURCES.nashville holds its own list plus the RA GraphQL source for area 653", () => {
    const sources = METRO_SOURCES.nashville ?? [];
    expect(sources).toHaveLength(NASHVILLE_SOURCES.length + 1);
    const raSource = sources.find((s) => s.platform === "ra")!;
    expect(raSource.url).toBe("https://ra.co/graphql?area=653");
    // The RA source uses kind: "ticketing_api" (as per D-505)
    expect(raSource.kind).toBe("ticketing_api");
    expect(raSource.platform).toBe("ra");
    expect(RA_AREAS.nashville).toBe(653);
  });

  it("METRO_RETIRED_SOURCES.nashville is empty", () => {
    expect(METRO_RETIRED_SOURCES.nashville).toEqual([]);
  });
});
