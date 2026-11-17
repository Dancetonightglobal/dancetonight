// The Marrakesh starting list (D-1100) keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-505).
import { describe, expect, it } from "vitest";

import { MARRAKESH_RETIRED, MARRAKESH_SOURCES } from "@/config/sources/marrakesh";
import { STYLES } from "@/config/styles";

const listed = MARRAKESH_SOURCES.map((seed) => seed.url);
const retired = MARRAKESH_RETIRED.map((gone) => gone.url);

describe("Marrakesh's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of MARRAKESH_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of MARRAKESH_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of MARRAKESH_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of MARRAKESH_SOURCES) {
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
    for (const seed of MARRAKESH_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("leaves out sites that block us or wait for permission (D-1100)", () => {
    for (const host of [
      "platinumlist.net",
      "ticket.ma",
      "events.ma",
      "shotgun.live",
      "feverup.com",
      "billetweb.fr",
      "weezevent.com",
      "instagram.com",
      "facebook.com",
    ]) {
      expect(listed.some((url) => new URL(url).hostname.endsWith(host))).toBe(false);
    }
  });

  it("reads Salsa Vida's guide as a directory with its +00:00 wall clock, and the clubs as their own pages", () => {
    const sv = MARRAKESH_SOURCES.filter((s) => s.url.includes("salsavida.com"));
    expect(sv).toHaveLength(1);
    expect(sv[0]?.trustTier).toBe("directory");
    expect(sv[0]?.kind).toBe("html");
    expect(sv[0]?.mixedCalendar).toBe(false); // D-772: Salsa Vida lists only dance nights
    expect(sv[0]?.jsonldZuluIsLocal).toBe("+00:00");

    for (const host of [
      "theatromarrakech.com",
      "babouchka-marrakech.com",
      "el-fenn.com",
      "comptoirmarrakech.com",
    ]) {
      const club = MARRAKESH_SOURCES.filter((s) => new URL(s.url).hostname.endsWith(host));
      expect(club).toHaveLength(1);
      expect(club[0]?.trustTier).toBe("first_party");
      expect(club[0]?.venuePage).toBe(true);
      expect(club[0]?.onlyHere).toBe(true);
    }
  });

  it("reads Tidar through its reader, and Souktronic as a fixed nightly club with its page's own line", () => {
    const tidar = MARRAKESH_SOURCES.filter((s) => s.platform === "tidar");
    expect(tidar).toHaveLength(1);
    expect(tidar[0]?.kind).toBe("platform_api");
    expect(tidar[0]?.trustTier).toBe("ticketing");

    const souk = MARRAKESH_SOURCES.find((s) => s.url.includes("comptoirmarrakech.com"));
    expect(souk?.fixedNights?.[0]?.line).toBe("TOUT LES SOIRS DE 00:00 à 03:00");
    expect(souk?.fixedNights?.[0]?.days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});
