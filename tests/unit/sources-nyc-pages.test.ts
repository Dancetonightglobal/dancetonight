// D-115: the first-party pages added on 2026-10-05. Each address is listed once, is http(s), and
// a venue's whole calendar (DJ nights beside concerts, cabaret or bar hours) is a mixed calendar,
// so its shows are screened while its late nights stay (`screenNoDance`).

import { describe, expect, it } from "vitest";

import { NYC_RETIRED, NYC_SOURCES } from "@/config/sources/nyc";

const added = {
  "https://gygnyc.com/new-york-soho-greenwich-village-gonzalez-y-gonzalez-live-salsa": false,
  "https://bigappleballroom.com/schedule": false,
  "https://cobblefish.net/events": false,
  "https://misalsadurabaileevent.netlify.app/": false,
  "https://nievesdancestudio.com/manhattan/": false,
  "https://h0l0.nyc/": false,
  "https://www.lebainnewyork.com/": true,
  "https://calendar.houseofyes.org/": true,
  "https://lpr.com/": true,
} as const;

describe("the pages D-115 adds to New York's starting list", () => {
  it("lists each once, as a first-party page, mixed only where it is a venue's whole calendar", () => {
    for (const [url, mixed] of Object.entries(added)) {
      const rows = NYC_SOURCES.filter((s) => s.url === url);
      expect(rows, url).toHaveLength(1);
      expect(rows[0], url).toMatchObject({ kind: "html", trustTier: "first_party" });
      expect(rows[0]!.mixedCalendar ?? false, url).toBe(mixed);
      expect(new URL(url).protocol).toBe("https:");
      expect(
        NYC_RETIRED.map((r) => r.url),
        url,
      ).not.toContain(url);
    }
  });

  it("adds no more than 12 model pages in one day (the brief's cap)", () => {
    expect(Object.keys(added).length).toBeLessThanOrEqual(12);
  });
});
