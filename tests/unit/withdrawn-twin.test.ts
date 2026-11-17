import { describe, expect, it } from "vitest";

import type { HarvestedListing } from "@/src/adapters/types";
import { rawExtractionSchema, rawListingSchema } from "@/src/domain/listing";
import { withdrawnTwins } from "@/src/domain/withdrawn-twin";
import { extractionToHarvested } from "@/src/pipeline/extract";

// D-868: Berlin Tanzschule Traumtänzer (/tanzparty/, read 2026-11-11). The model gave the Awakening
// card's 18:00-20:00 on Sat 11-14 the title of the Ballhaus Tanzparty card above it. The title repeats
// (Sun 11-15 Ballhaus 18:00), so the D-270 widening read the times to the end of the page and the
// misread kept 18:00. A night whose own part writes a start is timed there only; the withdrawn copy
// beside the read's timed listing of one title and night is dropped.

const NOW = new Date("2026-11-11T08:00:00Z");

const PAGE = `Samstag, 14.11.2026
Ballhaus Tanzparty
6 Stunden Tanzspaß!
17:00 bis 23:00 Uhr
DJ Felix
Live-DJ 20 - 23 Uhr
Flughafen Tempelhof
Tanzschule Traumtänzer - Flughafen Tempelhof, Columbiadamm 8
Tischreservierung
Details
*.ics eintragen
Samstag, 14.11.2026
Awakening Your Queen
An Oriental Experience
18:00 bis 20:00 Uhr
Jamie
Eintritt 16,- €
Workshop & Bauchtanzshow
Mariendorf
Tanzschule Traumtänzer - Mariendorf, Großbeerenstraße 46-52,
Details
*.ics eintragen
Samstag, 14.11.2026
Tanzparty
Standard, Latein, Salsa, Discofox & Co.
20:00 bis 23:00 Uhr
Mariendorf
Tanzschule Traumtänzer - Mariendorf, Großbeerenstraße 46-52,
Details
*.ics eintragen
Sonntag, 15.11.2026
Ballhaus Tanzparty
Tanztee am Sonntag
18:00 bis 21:00 Uhr
Flughafen Tempelhof
Tanzschule Traumtänzer - Flughafen Tempelhof, Columbiadamm 8
Details
*.ics eintragen`;

function read(listings: Array<Record<string, unknown>>) {
  return extractionToHarvested(
    rawExtractionSchema.parse({
      page_kind: "list",
      language: "de",
      listings: listings.map((l) => ({
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        ...l,
      })),
    }),
    {
      pageUrl: "https://www.traumtaenzer.de/tanzparty/",
      fetchedAt: NOW,
      today: "2026-11-11",
      pageText: PAGE,
      countryCode: "DE",
    },
  );
}

const rows = (r: ReturnType<typeof read>) =>
  r.listings.map((l) => [l.listing.title, l.listing.local_date, l.listing.dancing_time]);

describe("a repeated title's night is timed from its own part (D-868)", () => {
  it("drops the misread Ballhaus 18:00 on 11-14 and keeps the real nights", () => {
    const r = read([
      {
        title: "Ballhaus Tanzparty",
        local_date: "2026-11-14",
        dancing_time: "17:00",
        end_time: "23:00",
      },
      {
        title: "Ballhaus Tanzparty",
        local_date: "2026-11-14",
        dancing_time: "18:00",
        end_time: "20:00",
      },
      {
        title: "Ballhaus Tanzparty",
        local_date: "2026-11-15",
        dancing_time: "18:00",
        end_time: "21:00",
      },
      { title: "Tanzparty", local_date: "2026-11-14", dancing_time: "20:00", end_time: "23:00" },
    ]);
    expect(rows(r)).toEqual([
      ["Ballhaus Tanzparty", "2026-11-14", "17:00"],
      ["Ballhaus Tanzparty", "2026-11-15", "18:00"],
      ["Tanzparty", "2026-11-14", "20:00"],
    ]);
    expect(r.notes.some((n) => n.includes("D-868"))).toBe(true);
  });

  it("withdraws a lone misread's time but keeps the listing (no timed twin)", () => {
    const r = read([
      {
        title: "Ballhaus Tanzparty",
        local_date: "2026-11-14",
        dancing_time: "18:00",
        end_time: "20:00",
      },
      {
        title: "Ballhaus Tanzparty",
        local_date: "2026-11-15",
        dancing_time: "18:00",
        end_time: "21:00",
      },
    ]);
    const sat = r.listings.find((l) => l.listing.local_date === "2026-11-14");
    expect(sat).toBeDefined();
    expect(sat?.listing.dancing_time).toBeNull();
    expect(sat?.timesWithdrawn).toBeDefined();
    expect(r.notes.some((n) => n.includes("D-868"))).toBe(false);
  });
});

// The rule on its own.
function h(
  title: string,
  date: string | null,
  time: string | null,
  extra: Partial<HarvestedListing> = {},
): HarvestedListing {
  return {
    listing: rawListingSchema.parse({
      title,
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      local_date: date,
      dancing_time: time,
    }),
    externalId: null,
    tz: null,
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://x.example/", fetchedAt: NOW, method: "feed" },
    ...extra,
  };
}
const withdrawn = { timesWithdrawn: { pageStarts: ["17:00"], pageEnds: [] } };

describe("withdrawnTwins (D-868)", () => {
  it("returns the withdrawn copy beside a timed listing of one title and night", () => {
    const timed = h("Ballhaus Tanzparty", "2026-11-14", "17:00");
    const twin = h("Ballhaus Tanzparty", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([timed, twin])).toEqual([twin]);
  });

  it("matches titles by case, accents and spacing", () => {
    const timed = h("Ballhaus  Tanzparty", "2026-11-14", "17:00");
    const twin = h("BALLHAUS TANZPARTY", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([twin, timed])).toEqual([twin]);
    const a = h("Café Tango", "2026-11-14", "20:00");
    const b = h("cafe tango", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([a, b])).toEqual([b]);
  });

  it("keeps a withdrawn listing with no timed twin", () => {
    const twin = h("Ballhaus Tanzparty", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([twin])).toEqual([]);
    // Another night's timed copy is not a twin.
    expect(withdrawnTwins([twin, h("Ballhaus Tanzparty", "2026-11-15", "18:00")])).toEqual([]);
    // Another title is not a twin.
    expect(withdrawnTwins([twin, h("Tanzparty", "2026-11-14", "20:00")])).toEqual([]);
    // Two withdrawn copies are not each other's twin.
    const twin2 = h("Ballhaus Tanzparty", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([twin, twin2])).toEqual([]);
  });

  it("needs the twin to have a start and the copy to be withdrawn", () => {
    // An untimed copy the read itself gave untimed (not withdrawn) stays.
    const untimed = h("Ballhaus Tanzparty", "2026-11-14", null);
    expect(withdrawnTwins([h("Ballhaus Tanzparty", "2026-11-14", "17:00"), untimed])).toEqual([]);
    // A twin with no start does not count.
    const twin = h("Ballhaus Tanzparty", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([twin, h("Ballhaus Tanzparty", "2026-11-14", null)])).toEqual([]);
  });

  it("counts doors and lesson starts too, and skips undated or recurring listings", () => {
    const doors = h("Milonga X", "2026-11-14", null);
    doors.listing.doors_time = "19:00";
    const twin = h("Milonga X", "2026-11-14", null, withdrawn);
    expect(withdrawnTwins([doors, twin])).toEqual([twin]);
    const undated = h("Milonga X", null, null, withdrawn);
    expect(withdrawnTwins([doors, undated])).toEqual([]);
    const rule = h("Milonga X", "2026-11-14", null, {
      ...withdrawn,
      recurrence: { rrule: "FREQ=WEEKLY;BYDAY=SA", dtstartLocal: "2026-11-14T19:00", exdates: [] },
    });
    expect(withdrawnTwins([doors, rule])).toEqual([]);
  });
});
