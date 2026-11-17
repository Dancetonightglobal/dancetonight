// The Beirut starting list (D-1000) keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { BEIRUT_RETIRED, BEIRUT_SOURCES } from "@/config/sources/beirut";
import { STYLES } from "@/config/styles";

const listed = BEIRUT_SOURCES.map((seed) => seed.url);
const retired = BEIRUT_RETIRED.map((gone) => gone.url);

describe("Beirut's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of BEIRUT_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of BEIRUT_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of BEIRUT_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of BEIRUT_SOURCES) {
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
    for (const seed of BEIRUT_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("leaves out sites that block us or wait for permission (D-1000)", () => {
    for (const host of [
      "platinumlist.net",
      "agendaculturel.com",
      "lebtivity.com",
      "instagram.com",
      "facebook.com",
    ]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
  });

  it("reads Salsa Vida's Beirut guide as a directory and Metro al Madina as first-party", () => {
    const sv = BEIRUT_SOURCES.filter((s) => s.url.includes("salsavida.com"));
    expect(sv).toHaveLength(1);
    expect(sv[0]?.trustTier).toBe("directory");
    expect(sv[0]?.kind).toBe("html");
    expect(sv[0]?.mixedCalendar).toBe(false); // D-772: Salsa Vida lists only dance nights

    const mm = BEIRUT_SOURCES.filter((s) => s.url.includes("metromadina.com"));
    expect(mm).toHaveLength(1);
    expect(mm[0]?.trustTier).toBe("first_party");
    expect(mm[0]?.platform).toBe("metro_madina");
  });
});
