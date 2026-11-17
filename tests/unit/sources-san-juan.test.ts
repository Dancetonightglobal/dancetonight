// San Juan's starting list keeps the promises every metro's list keeps (D-047, D-110): one row per
// address, only http(s), real style keys, no Resident Advisor (D-034), and the right trust tiers.
import { describe, expect, it } from "vitest";

import { SAN_JUAN_RETIRED, SAN_JUAN_SOURCES } from "@/config/sources/san-juan";
import { STYLES } from "@/config/styles";

const listed = SAN_JUAN_SOURCES.map((seed) => seed.url);
const retired = SAN_JUAN_RETIRED.map((gone) => gone.url);

describe("San Juan's starting list", () => {
  it("lists each address once, retires each once, and only http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
  });

  it("never lists an address it has retired, and every retirement has a reason", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
    for (const gone of SAN_JUAN_RETIRED) {
      expect(gone.reason.length).toBeGreaterThan(20);
    }
  });

  it("stays off Resident Advisor, Facebook and Instagram (D-034), except hand-checked seeds (D-797)", () => {
    // A hand-checked seed is read by hand in the owner's Chrome and never fetched, so it reads nothing from those sites.
    for (const seed of SAN_JUAN_SOURCES.filter((s) => !s.handChecked)) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net|facebook\.com|instagram\.com/);
    }
  });

  it("names only real style keys", () => {
    const styleKeys = new Set<string>(STYLES.map((s) => s.key));
    for (const seed of SAN_JUAN_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys.has(style), `${seed.url}: ${style}`).toBe(true);
      }
    }
  });

  it("reads Salsa Vida as a directory and Eventbrite organisers through the API as ticketing calendars", () => {
    const salsaVida = SAN_JUAN_SOURCES.find((s) => s.url.includes("salsavida.com"));
    expect(salsaVida?.trustTier).toBe("directory");
    const organisers = SAN_JUAN_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBeGreaterThan(0);
    for (const source of organisers) {
      expect(source.url).toMatch(/^https:\/\/www\.eventbrite\.com\/o\/[a-z0-9-]+-\d+$/);
      expect(source.kind).toBe("ticketing_api");
      expect(source.trustTier).toBe("ticketing");
      // Every organiser's calendar is screened as mixed except Da Sunday Cookout's, a DJ day party only.
      expect(source.mixedCalendar).toBe(!source.url.includes("veronica-cint-ajay-omowale"));
    }
  });

  it("keeps Da Sunday Cookout's untitled-dance day party past the no-dance screen (D-264)", () => {
    const cookout = SAN_JUAN_SOURCES.find((s) => s.url.includes("veronica-cint-ajay-omowale"));
    expect(cookout?.danceNights).toContain("Da Sunday Cookout PR");
  });

  it("keeps Ajay Omowale's AFRO BEACH party past the no-dance screen (D-264)", () => {
    const ajay = SAN_JUAN_SOURCES.find((s) => s.url.includes("/o/ajay-omowale-"));
    expect(ajay?.mixedCalendar).toBe(true);
    expect(ajay?.danceNights).toContain("AFRO BEACH: A Caribbean & Afro Diaspora Experience");
  });

  it("reads Cambio en Clave's own events list as a first-party html page", () => {
    const cec = SAN_JUAN_SOURCES.find((s) => s.url === "https://www.cambioenclave.com/eventos");
    expect(cec?.kind).toBe("html");
    expect(cec?.trustTier).toBe("first_party");
    expect(cec?.feedUrl).toBeUndefined();
  });

  it("reads DanceUS's Puerto Rico salsa calendar as a mixed directory (D-461)", () => {
    const danceus = SAN_JUAN_SOURCES.filter((s) => s.url.includes("danceus.org"));
    expect(danceus).toHaveLength(1);
    expect(danceus[0]?.url).toBe(
      "https://www.danceus.org/events/salsa/puerto-rico-salsa-calendar/",
    );
    expect(danceus[0]?.kind).toBe("html");
    expect(danceus[0]?.trustTier).toBe("directory");
    expect(danceus[0]?.mixedCalendar).toBe(true);
  });

  it("reads Club Brava's weekly hours from the hotel's own page, not clubbrava.com (D-524 #4)", () => {
    const brava = SAN_JUAN_SOURCES.filter((s) => s.label === "Club Brava");
    expect(brava).toHaveLength(1);
    expect(brava[0]?.url).toContain(
      "fairmont.com/en/hotels/puerto-rico/fairmont-el-san-juan-hotel/",
    );
    expect(brava[0]?.trustTier).toBe("first_party");
    expect(brava[0]?.venuePage).toBe(true);
    expect(brava[0]?.weeklyGrid).toBe(true);
    expect(brava[0]?.venueAddress).toContain("Isla Verde");
    expect(retired).toContain("https://www.clubbrava.com/brava");
    expect(brava[0]?.houseHours).toBeUndefined();
    expect(
      brava[0]?.fixedNights?.map((f) => ({
        title: f.title,
        line: f.line,
        days: f.days,
        start: f.start,
        end: f.end,
      })),
    ).toEqual([
      {
        title: "Club Brava",
        line: "Thursday 10:00 p.m. to 4:00 a.m.",
        days: [4],
        start: "22:00",
        end: "04:00",
      },
      {
        title: "Club Brava (Fri & Sat)",
        line: "Friday & Saturday 11:00 p.m. to 4:00 a.m.",
        days: [5, 6],
        start: "23:00",
        end: "04:00",
      },
    ]);
    for (const f of brava[0]?.fixedNights ?? []) {
      expect(f.replacesTitles).toEqual(["Club Brava"]);
      expect(f.danceCited).toContain("dance floor");
    }
  });

  it("retires San Juan Sip & Paint's craft calendar found by discovery", () => {
    expect(retired).toContain("https://www.sanjuansipandpaint.com/ladies-night");
  });

  it("reads Out x Out's San Juan events calendar as a mixed directory, with permission (D-545)", () => {
    const oxo = SAN_JUAN_SOURCES.filter((s) => s.url.startsWith("https://outxout.com/"));
    expect(oxo.map((s) => s.url)).toEqual(["https://outxout.com/events/san-juan-pr"]);
    expect(oxo[0]?.trustTier).toBe("directory");
    expect(oxo[0]?.mixedCalendar).toBe(true);
  });

  it("retires the Condado Vanderbilt's dining calendar found on the first run", () => {
    expect(retired).toContain("https://www.condadovanderbilt.com/happenings/");
  });

  it("lists three venues' own Instagram nights, hand-checked, never fetched (D-797)", () => {
    const nights = (url: string) => {
      const seed = SAN_JUAN_SOURCES.find((s) => s.url === url);
      expect(seed?.handChecked).toBe(true);
      expect(seed?.onlyHere).toBe(true);
      return seed?.fixedNights?.map((n) => [n.days, n.start]);
    };
    expect(nights("https://www.instagram.com/tabernalosvazquezpr/")).toEqual([
      [[5, 6, 0], "19:00"],
    ]);
    expect(nights("https://www.instagram.com/lafactoriapr/")).toEqual([[[0, 1], "22:00"]]);
    expect(nights("https://www.instagram.com/larespuestapr/")).toEqual([[[0], "20:00"]]);
  });
});
