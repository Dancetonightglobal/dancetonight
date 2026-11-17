// The Dubai starting list (D-1060) keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { DUBAI_RETIRED, DUBAI_SOURCES } from "@/config/sources/dubai";
import { STYLES } from "@/config/styles";

const listed = DUBAI_SOURCES.map((seed) => seed.url);
const retired = DUBAI_RETIRED.map((gone) => gone.url);

describe("Dubai's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of DUBAI_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of DUBAI_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of DUBAI_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of DUBAI_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
      if (seed.kind === "squarespace") {
        expect(seed.platform).toBe("squarespace");
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of DUBAI_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("leaves out sites that block us or wait for permission (D-1060); an own Instagram only as handChecked (D-796)", () => {
    for (const host of ["platinumlist.net", "timeoutdubai.com", "facebook.com"]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
    for (const seed of DUBAI_SOURCES.filter((s) =>
      new URL(s.url).hostname.endsWith("instagram.com"),
    )) {
      expect(seed.handChecked).toBe(true);
    }
  });

  it("the seven new venue entries are first_party, venuePage: true, onlyHere: true, and have a venueAddress containing Dubai", () => {
    const venueLabels = [
      "The Penthouse Dubai",
      "Bohemia Dubai",
      "BLU Dubai",
      "Little Havana Dubai",
      "Lucky Voice Dubai",
      "Avenue Club Dubai",
      "KIZA Dubai",
    ];
    const venueSources = DUBAI_SOURCES.filter((s) => venueLabels.includes(s.label));
    expect(venueSources).toHaveLength(7);
    for (const source of venueSources) {
      expect(source.trustTier).toBe("first_party");
      expect(source.venuePage).toBe(true);
      expect(source.onlyHere).toBe(true);
      expect(source.venueAddress).toBeDefined();
      expect(source.venueAddress).toContain("Dubai");
    }
  });

  it("Salsa Vida Dubai stays a directory, not a mixed calendar (D-772)", () => {
    const sv = DUBAI_SOURCES.find((s) => s.label === "Salsa Vida Dubai");
    expect(sv).toBeDefined();
    expect(sv?.trustTier).toBe("directory");
    expect(sv?.mixedCalendar).toBe(false);
  });

  it("reads Papa Dubai's six weekly nights (four through the JSON-LD reader), at its own address", () => {
    const papaSources = DUBAI_SOURCES.filter((s) => s.label.startsWith("Papa Dubai: "));
    expect(papaSources).toHaveLength(6);
    for (const source of papaSources) {
      if (source.label === "Papa Dubai: Papasito" || source.label === "Papa Dubai: French Kiss") {
        // Pinned to plain HTML: their own page line gives the night (fixedNights, D-1068).
        expect(source.kind).toBe("html");
        expect(source.platform).toBe("probed");
        expect(source.fixedNights).toHaveLength(1);
      } else {
        expect(source.kind).toBe("jsonld");
        expect(source.platform).toBe("jsonld");
      }
      expect(source.trustTier).toBe("first_party");
      expect(source.venuePage).toBe(true);
      expect(source.onlyHere).toBe(true);
      expect(source.venueAddress).toContain("Al Habtoor City");
      const url = new URL(source.url);
      expect(url.hostname).toBe("papadubai.ae");
      expect(url.pathname).not.toMatch(/^\/tilda\//);
    }
  });
  it("pins every seed with fixedNights to plain HTML, since only the model path applies them (D-1068)", () => {
    // A handChecked seed is never fetched (D-797), so it has no reader to pin.
    for (const seed of DUBAI_SOURCES.filter((s) => s.fixedNights?.length && !s.handChecked)) {
      expect(seed.kind).toBe("html");
      expect(seed.platform).toBe("probed");
    }
  });
});
