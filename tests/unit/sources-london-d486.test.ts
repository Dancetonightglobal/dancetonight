// London sources D-486: Sway Bar's club nights and DANCE GPS's bachata nights.
import { describe, expect, it } from "vitest";

import { LONDON_SOURCES } from "@/config/sources/london";

describe("London D-486 sources", () => {
  it("has Sway Bar's club page as a mixed venue calendar", () => {
    const sway = LONDON_SOURCES.find((s) => s.url === "https://www.swaybar.co.uk/club");
    expect(sway).toBeDefined();
    expect(sway?.trustTier).toBe("first_party");
    expect(sway?.venuePage).toBe(true);
    expect(sway?.onlyHere).toBe(true);
    expect(sway?.mixedCalendar).toBe(true);
    expect(sway?.venueAddress).toContain("WC2B 5BZ");
    expect(sway?.danceNights).toEqual(
      expect.arrayContaining(["Latino Sway Mondays", "Latin Krazy", "The Latin Collective"]),
    );
    expect(sway?.notDanceNights).toEqual(["Party N Paint"]);
  });

  it("has DANCE GPS with eventPageDates and the bachata style", () => {
    const gps = LONDON_SOURCES.find(
      (s) => s.url === "https://www.tickettailor.com/events/dancegps1",
    );
    expect(gps).toBeDefined();
    expect(gps?.eventPageDates).toBe(true);
    expect(gps?.styles).toEqual(["bachata"]);
  });

  it("has unique URLs across all sources", () => {
    const urls = LONDON_SOURCES.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
