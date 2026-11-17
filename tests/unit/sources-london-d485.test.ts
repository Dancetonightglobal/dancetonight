// London sources D-485: Pura Nights and RSCDS Thursday Social.
import { describe, expect, it } from "vitest";

import { LONDON_SOURCES } from "@/config/sources/london";

describe("London D-485 sources", () => {
  it("has Pura Nights with eventPageDates and salsa/bachata styles", () => {
    const pura = LONDON_SOURCES.find(
      (s) => s.url === "https://www.tickettailor.com/events/puranightssalsabachata",
    );
    expect(pura).toBeDefined();
    expect(pura?.eventPageDates).toBe(true);
    expect(pura?.styles).toContain("salsa");
    expect(pura?.styles).toContain("bachata");
    expect(pura?.datesList).toBeUndefined();
  });

  it("has RSCDS Thursday Social with datesList, venuePage and scottish_country style", () => {
    const rscds = LONDON_SOURCES.find(
      (s) => s.url === "https://www.rscdslondon.org.uk/thursday-social",
    );
    expect(rscds).toBeDefined();
    expect(rscds?.datesList).toBe(true);
    expect(rscds?.venuePage).toBe(true);
    expect(rscds?.venueAddress).toContain("SW1X 0BD");
    expect(rscds?.styles).toEqual(["scottish_country"]);
  });

  it("has unique URLs across all sources", () => {
    const urls = LONDON_SOURCES.map((s) => s.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
