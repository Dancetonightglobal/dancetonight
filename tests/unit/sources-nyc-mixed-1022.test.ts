// Test for the four discovered venue calendars added 2026-10-22 as mixed calendars
import { describe, expect, it } from "vitest";

import { NYC_SOURCES } from "@/config/sources/nyc";

describe("discovered venue calendars added 2026-10-22 as mixed calendars", () => {
  const entries = [
    {
      url: "https://www.momaps1.org/en/calendar",
      label: "MoMA PS1",
      mixedCalendar: true,
      venuePage: true,
      venueAddress: "22-25 Jackson Ave, Long Island City, NY 11101",
    },
    {
      url: "https://roulette.org/calendar/",
      label: "Roulette Intermedium",
      mixedCalendar: true,
      venuePage: true,
      venueAddress: "509 Atlantic Ave, Brooklyn, NY 11217",
    },
    {
      url: "https://www.hostoscenter.org/events",
      label: "Hostos Center for the Arts & Culture",
      mixedCalendar: true,
      venuePage: true,
      venueAddress: "450 Grand Concourse, Bronx, NY 10451",
    },
    {
      url: "https://www.index-space.org/programming",
      label: "Index",
      mixedCalendar: true,
      venuePage: undefined,
      venueAddress: undefined,
    },
  ];

  for (const expected of entries) {
    it(`has exactly one entry for ${expected.label}`, () => {
      const rows = NYC_SOURCES.filter((s) => s.url === expected.url);
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row?.label).toBe(expected.label);
      expect(row?.mixedCalendar).toBe(expected.mixedCalendar);
      if (expected.venuePage !== undefined) {
        expect(row?.venuePage).toBe(expected.venuePage);
      }
      if (expected.venueAddress !== undefined) {
        expect(row?.venueAddress).toBe(expected.venueAddress);
      } else {
        expect(row?.venueAddress).toBeUndefined();
      }
    });
  }
});
