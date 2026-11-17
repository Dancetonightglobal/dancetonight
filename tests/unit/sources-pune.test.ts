// The Pune starting list keeps its own promises (D-047, D-110, D-1120): one row per address, only http(s), no
// Squarespace ?format= view, no Resident Advisor pages in its own file (D-505), real style keys.
import { describe, expect, it } from "vitest";

import { METRO_SOURCES } from "@/config/sources";
import { PUNE_RETIRED, PUNE_SOURCES } from "@/config/sources/pune";
import { STYLES } from "@/config/styles";

const listed = PUNE_SOURCES.map((seed) => seed.url);
const retired = PUNE_RETIRED.map((gone) => gone.url);

describe("Pune's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view and keeps Resident Advisor out of its own file (D-505)", () => {
    for (const seed of PUNE_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of PUNE_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads Salsa Vida's Pune guide as a directory", () => {
    const sv = PUNE_SOURCES.find((s) => s.label === "Salsa Vida Pune");
    expect(sv?.url).toBe("https://www.salsavida.com/guides/india/pune/");
    expect(sv?.trustTier).toBe("directory");
    // Furor's own page says La Rumba is twice a month, Salsa Vida says weekly: La Rumba comes from Furor's page.
    // Salsa Vida's venue and night for Pune Latin Nights and MAK are contradicted by the organisers' own IG (2026-11-09).
    expect(sv?.notDanceNights).toEqual([
      "La Rumba",
      "Pune Latin Nights",
      "MAK Afro-Latin Nights at Kiki",
    ]);
  });

  it("reads La Rumba from Furor Pune Salsa's own page", () => {
    const furor = PUNE_SOURCES.find((s) => s.url === "https://punesalsa.com/index.php/la-rumba/");
    expect(furor?.trustTier).toBe("first_party");
    expect(furor?.kind).toBe("html");
  });

  it("retires the discovered sites that are not dance venues (first scheduled read, 2026-11-08)", () => {
    expect(retired).toEqual(
      expect.arrayContaining([
        "https://mcckala.com/",
        "https://www.gyaanadab.org/",
        "https://www.seamedu.com/events",
        "https://www.swigbar.com/",
      ]),
    );
  });

  it("reads District's two Pune nightlife pages and its workshops page with no model, as mixed calendars (D-542)", () => {
    const district = PUNE_SOURCES.filter((s) => s.url.startsWith("https://www.district.in/"));
    expect(district.map((s) => s.url)).toEqual([
      "https://www.district.in/events/nightlife-in-pune-book-tickets",
      "https://www.district.in/events/nightlife-this-weekend-in-pune",
      "https://www.district.in/events/workshops-in-pune-book-tickets",
    ]);
    for (const seed of district) {
      expect(seed.kind).toBe("jsonld");
      expect(seed.platform).toBe("jsonld_items");
      expect(seed.mixedCalendar).toBe(true);
      expect(seed.trustTier).toBe("directory");
      expect(seed.notDanceNights).toContain("Jamming Night - Pune");
    }
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-015, D-131)", () => {
    const organisers = PUNE_SOURCES.filter((s) => s.platform === "eventbrite");
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.com\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.trustTier).toBe("ticketing");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("is wired with Resident Advisor area 329 on top", () => {
    const all = METRO_SOURCES.pune ?? [];
    expect(all).toHaveLength(PUNE_SOURCES.length + 1);
    expect(all.filter((s) => s.platform === "ra").map((s) => s.url)).toEqual([
      "https://ra.co/graphql?area=329",
    ]);
  });

  it("retires The Vibrancy Clinic Eventbrite after its only night passed (2026-11-16)", () => {
    expect(retired).toContain("https://www.eventbrite.com/o/114096315351");
    expect(listed).not.toContain("https://www.eventbrite.com/o/114096315351");
  });
});
