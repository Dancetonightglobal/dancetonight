// Mexico City's starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Resident Advisor pages (D-034), and no Facebook or Instagram.
import { describe, expect, it } from "vitest";

import { MEXICO_CITY_RETIRED, MEXICO_CITY_SOURCES } from "@/config/sources/mexico-city";
import { STYLES } from "@/config/styles";

const listed = MEXICO_CITY_SOURCES.map((seed) => seed.url);
const retired = MEXICO_CITY_RETIRED.map((gone) => gone.url);

describe("Mexico City's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of MEXICO_CITY_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("stays off Resident Advisor (ra.co, residentadvisor.net), Facebook and Instagram", () => {
    for (const seed of MEXICO_CITY_SOURCES) {
      const urlHost = new URL(seed.url).hostname;
      expect(urlHost).not.toMatch(/(\.|^)ra\.co$/);
      expect(urlHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
      expect(urlHost).not.toMatch(/(\.|^)facebook\.com$/);
      expect(urlHost).not.toMatch(/(\.|^)instagram\.com$/);
      if (seed.feedUrl) {
        const feedHost = new URL(seed.feedUrl).hostname;
        expect(feedHost).not.toMatch(/(\.|^)ra\.co$/);
        expect(feedHost).not.toMatch(/(\.|^)residentadvisor\.net$/);
        expect(feedHost).not.toMatch(/(\.|^)facebook\.com$/);
        expect(feedHost).not.toMatch(/(\.|^)instagram\.com$/);
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of MEXICO_CITY_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("retires the six dead feeds discovery switched on (run 41311336330)", () => {
    for (const url of [
      "http://www.elduxdevenecia.com",
      "https://gentedemezcal.com/en/",
      "https://www.centrodidacticocultural.mx/",
      "https://cultura.uam.mx/",
      "https://foro.engranica.com/",
      "https://mc.jpf.go.jp/",
    ]) {
      expect(retired).toContain(url);
    }
  });

  it("screens Somos Casineros' projected weekly nights out of Salsa Vida's guide (various venues, monthly)", () => {
    const salsaVida = MEXICO_CITY_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/mexico/mexico-city/",
    );
    expect(salsaVida?.notDanceNights).toContain("Somos Casineros en México – Cuban Dance Events");
  });

  it("reads Salsa Vida Mexico City as a directory", () => {
    const salsaVida = MEXICO_CITY_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/mexico/mexico-city/",
    );
    expect(salsaVida).toBeDefined();
    expect(salsaVida?.trustTier).toBe("directory");
    expect(salsaVida?.kind).toBe("html");
  });

  it("reads Out x Out's Mexico City events calendar as a mixed JSON-LD directory, with permission (D-558)", () => {
    const oxo = MEXICO_CITY_SOURCES.filter((s) => s.url.startsWith("https://outxout.com/"));
    expect(oxo.map((s) => s.url)).toEqual(["https://outxout.com/events/mexico-city-mx"]);
    expect(oxo[0]?.trustTier).toBe("directory");
    expect(oxo[0]?.kind).toBe("jsonld");
    expect(oxo[0]?.mixedCalendar).toBe(true);
  });
});
