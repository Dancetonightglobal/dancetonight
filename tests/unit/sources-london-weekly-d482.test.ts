// London's weekly-schedule owners: Ceroc, Salsateca, SwingdanceUK (D-482).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { LONDON_SOURCES } from "@/config/sources/london";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue, withSourceVenue } from "@/src/pipeline/source-venue";

function listing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Weekly class and freestyle",
    listing_type: "class",
    styles: ["salsa"],
    local_date: "2026-11-04",
    doors_time: "19:30",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://www.ceroc.com/" },
  } as unknown as HarvestedListing;
}

const london = KNOWN_VENUES.london ?? [];
const weekly = LONDON_SOURCES.filter(
  (s) =>
    s.url.startsWith("https://www.ceroc.com/24/131/") ||
    s.url.startsWith("https://www.salsateca.co.uk/"),
);

describe("London weekly-schedule owners (D-482)", () => {
  it("reads Ceroc's 8 London venues and Salsateca's 9 nights as weekly grids at one hall each", () => {
    expect(weekly.filter((s) => s.label === "Ceroc")).toHaveLength(8);
    expect(weekly.filter((s) => s.label === "Salsateca")).toHaveLength(9);
    for (const s of weekly) {
      expect(s.weeklyGrid, s.url).toBe(true);
      expect(s.onlyHere, s.url).toBe(true);
      expect(s.venuePage, s.url).toBeUndefined();
      expect(s.venueAddress, s.url).toBeTruthy();
    }
    expect(new Set(weekly.map((s) => s.url)).size).toBe(weekly.length);
  });

  it("pins Salsateca's pages to the model reader (D-484)", () => {
    for (const s of weekly) {
      if (s.label === "Salsateca") {
        expect(s.platform, s.url).toBe("probed");
      } else if (s.label === "Ceroc") {
        expect(s.platform, s.url).toBeUndefined();
      }
    }
  });

  it("places a row with no place at its page's hall, with a point", () => {
    for (const s of weekly) {
      const filled = withSourceVenue(listing(null, null), s);
      const placed = withKnownVenue(filled, london, "GB");
      expect(placed.listing.venue.address, s.url).toBe(s.venueAddress);
      expect(placed.venueLocation, s.url).not.toBeNull();
    }
  });

  it("places the hall as the organiser writes it", () => {
    const cases: readonly [string, string, string][] = [
      [
        "Edith Neville Primary School",
        "Purchese Street, St Pancras, London, NW1 1RW",
        "Edith Neville Primary School, Purchese Street, London NW1 1RW",
      ],
      [
        "Harris Academy",
        "Middle Park Avenue, Eltham, London, SE9 5EQ",
        "Harris Academy, Middle Park Avenue, London SE9 5EQ",
      ],
      [
        "Warren Centre",
        "Northumberland House, Basement 1-8, London W1T 5JU",
        "Warren Centre, Northumberland House, London W1T 5JU",
      ],
      [
        "St Mary Moorfields Hall",
        "4-5 Eldon St, EC2M 7LS London",
        "4-5 Eldon Street, London EC2M 7LS",
      ],
      [
        "Christ Church Hall",
        "27 Blackfriars Rd, London SE1 8NY",
        "27 Blackfriars Road, London SE1 8NY",
      ],
      [
        "City Sport",
        "Studio 1, City Sport, 124 Goswell Rd, London, EC1V 7DP",
        "124 Goswell Road, London EC1V 7DP",
      ],
    ];
    for (const [name, written, expected] of cases) {
      const placed = withKnownVenue(listing(name, written), london, "GB");
      expect(placed.listing.venue.address, name).toBe(expected);
      expect(placed.venueLocation, name).not.toBeNull();
    }
  });

  it("no longer reads SwingdanceUK's classes page (retired, D-487)", () => {
    const s = LONDON_SOURCES.find((x) => x.url === "https://swingdanceuk.com/classes/workshops/");
    expect(s).toBeUndefined();
  });
});
