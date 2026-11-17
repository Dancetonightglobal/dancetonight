// London sources D-524: gap analysis seeds (London-43, 2026-11-01).
import { describe, expect, it } from "vitest";

import { LONDON_RETIRED, LONDON_SOURCES } from "@/config/sources/london";

describe("London D-524 sources", () => {
  it("has Lil' Nashville with fixedNights on Wednesday and Saturday", () => {
    const lilNashville = LONDON_SOURCES.find(
      (s) => s.url === "https://www.lilnashville.co.uk/line-dancing-lessons",
    );
    expect(lilNashville).toBeDefined();
    expect(lilNashville?.fixedNights).toHaveLength(2);
    const wednesday = lilNashville?.fixedNights?.find((n) => n.days?.includes(3));
    const saturday = lilNashville?.fixedNights?.find((n) => n.days?.includes(6));
    expect(wednesday).toBeDefined();
    expect(saturday).toBeDefined();
    expect(wednesday?.start).toBeNull();
    expect(saturday?.start).toBeNull();
    expect(wednesday?.danceCited).toBeTruthy();
    expect(saturday?.danceCited).toBeTruthy();
  });

  it("has forro.london with weeklyGrid and not mixedCalendar", () => {
    const forro = LONDON_SOURCES.find((s) => s.url === "https://forro.london/where-to-dance");
    expect(forro).toBeDefined();
    expect(forro?.weeklyGrid).toBe(true);
    expect(forro?.mixedCalendar).toBe(false);
    expect(forro?.trustTier).toBe("directory");
  });

  it("has the 5 venue pages with correct postcodes and flags", () => {
    const byUrl = new Map(LONDON_SOURCES.map((s) => [s.url, s]));

    const hootananny = byUrl.get("https://hootanannybrixton.co.uk/");
    expect(hootananny).toBeDefined();
    expect(hootananny?.venuePage).toBe(true);
    expect(hootananny?.onlyHere).toBe(true);
    expect(hootananny?.mixedCalendar).toBe(true);
    expect(hootananny?.venueAddress).toContain("SW2 1DF");

    const londonIrish = byUrl.get("https://www.londonirishcentre.org/events/");
    expect(londonIrish).toBeDefined();
    expect(londonIrish?.venuePage).toBe(true);
    expect(londonIrish?.onlyHere).toBe(true);
    expect(londonIrish?.mixedCalendar).toBe(true);
    expect(londonIrish?.venueAddress).toContain("NW1 9XB");
    expect(londonIrish?.danceNights).toContain("The Jive Tribe");

    const rvt = byUrl.get("https://www.vauxhalltavern.com/whats-on/");
    expect(rvt).toBeDefined();
    expect(rvt?.venuePage).toBe(true);
    expect(rvt?.onlyHere).toBe(true);
    expect(rvt?.mixedCalendar).toBe(true);
    expect(rvt?.venueAddress).toContain("SE11 5HY");
    expect(rvt?.danceNights).toContain("Boogie Wonderland");
    expect(rvt?.danceNights).toContain("Madonna Fan Party *");
    expect(byUrl.has("https://www.vauxhalltavern.com/")).toBe(false);
    expect(LONDON_RETIRED.map((gone) => gone.url)).toContain("https://www.vauxhalltavern.com/");

    const divine = byUrl.get("https://thedivine.co.uk/");
    expect(divine).toBeDefined();
    expect(divine?.venuePage).toBe(true);
    expect(divine?.onlyHere).toBe(true);
    expect(divine?.mixedCalendar).toBe(true);
    expect(divine?.venueAddress).toContain("N16 8BJ");

    for (const genre of ["northern-soul", "jump-jive"]) {
      const club100 = byUrl.get(`https://www.the100club.co.uk/events/?genre=${genre}`);
      expect(club100).toBeDefined();
      expect(club100?.venuePage).toBe(true);
      expect(club100?.onlyHere).toBe(true);
      expect(club100?.mixedCalendar).toBeUndefined();
      expect(club100?.venueAddress).toContain("W1D 1LL");
    }
    expect(byUrl.has("https://www.the100club.co.uk/")).toBe(false);
    expect(LONDON_RETIRED.map((gone) => gone.url)).toContain("https://www.the100club.co.uk/");
  });

  it("has MARSM, Bint Bash Parties and Haitian Vinyl Night", () => {
    const byUrl = new Map(LONDON_SOURCES.map((s) => [s.url, s]));
    expect(byUrl.get("https://www.marsm.co.uk/upcoming-events")).toBeDefined();
    expect(byUrl.get("https://www.tickettailor.com/events/bintbashparties")).toBeDefined();
    expect(byUrl.get("https://www.tickettailor.com/events/patriceesperant")).toBeDefined();
  });

  it("has unique URLs across all sources", () => {
    const urls = LONDON_SOURCES.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
