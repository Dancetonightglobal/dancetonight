// London's unplaced rows from read 41085025249 (D-481).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import { LONDON_RETIRED, LONDON_SOURCES } from "@/config/sources/london";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue, withTitleVenue } from "@/src/pipeline/source-venue";

function listing(title: string, name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-10-30",
    doors_time: "21:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://dice.fm/" },
  } as unknown as HarvestedListing;
}

const london = KNOWN_VENUES.london ?? [];

describe("London known venues from read 41085025249 (D-481)", () => {
  it("places DICE's venues at their checked address and point", () => {
    const cases: readonly [string, string, string][] = [
      [
        "Egg LDN",
        "5-13 Vale Royal, N7 9AP, London, Greater London, England, United Kingdom",
        "5-13 Vale Royal, London N7 9AP",
      ],
      [
        "Outernet Live",
        "Denmark St, Charing Cross Rd, London WC2H 8LH, UK",
        "Denmark Street, London WC2H 8LH",
      ],
      [
        "Venue MOT Unit 18",
        "Venue MOT Unit 18, Orion Business Centre, Surrey Canal Rd, London SE14 5RT, UK",
        "Unit 18, Orion Business Centre, Surrey Canal Road, London SE14 5RT",
      ],
      [
        "77 London",
        "77 Welbeck Street, Westminster, London, W1G 0BB, United Kingdom",
        "77 Welbeck Street, London W1G 0BB",
      ],
      [
        "Boxhall City (London)",
        "1-27, The Arcade, Liverpool St, London EC2M 7PN",
        "1-27 The Arcade, Liverpool Street, London EC2M 7PN",
      ],
      [
        "Hackney Bridge",
        "Units 1-28, ECHO BUILDING Units 1-28, ECHO BUILDING, London E15 2SJ, UK",
        "Units 1-28, Echo Building, London E15 2SJ",
      ],
      [
        "Crate Brewery",
        "Unit 7, Queens Yard, Tower Hamlets, London, E9 5EN, United Kingdom",
        "Unit 7, Queens Yard, London E9 5EN",
      ],
      [
        "Club Silly",
        "18 Valentia Place, Lambeth, London, SW9 8EP, United Kingdom",
        "18 Valentia Place, London SW9 8EP",
      ],
      [
        "LA Lounge",
        "Bell Lane, Dock Road, London, E16 2AB",
        "Bell Lane, Dock Road, London E16 2AB",
      ],
    ];
    for (const [name, written, expected] of cases) {
      const result = withKnownVenue(listing("Night", name, written), london, "GB");
      expect(result.listing.venue.address, name).toBe(expected);
      expect(result.venueLocation, name).not.toBeNull();
    }
  });

  it("places address-only rows by their street", () => {
    const cases: readonly [string, string][] = [
      [
        "2 Armoury Way Wandsworth, London, SW18 1SH, United Kingdom",
        "2 Armoury Way, London SW18 1HQ",
      ],
      [
        "25 Old London Road, Kingston-on-Thames, KT2 6ND",
        "25 Old London Road, Kingston upon Thames KT2 6ND",
      ],
      ["41 Uxbridge road, Shepherd's Bush W12 8LH", "41 Uxbridge Road, London W12 8LH"],
      ["24-27 White Lion Street, Angel N1 9PD", "24-27 White Lion Street, London N1 9PD"],
      ["St. Thomas Street, London, United Kingdom", "St Thomas Street, London SE1 9RT"],
    ];
    for (const [written, expected] of cases) {
      const result = withKnownVenue(listing("Night", null, written), london, "GB");
      expect(result.listing.venue.address, written).toBe(expected);
      expect(result.venueLocation, written).not.toBeNull();
    }
  });

  it("places Ritmo Latino's 'Next to Metropolis Vauxhall' name and Guy's Bar's street-only address", () => {
    const ritmo = withKnownVenue(
      listing(
        "Bachata Tuesdays",
        "Ritmo Latino - Dance Studio and Event Space (Next to Metropolis Vauxhall)",
        "SE1 7TP",
      ),
      london,
      "GB",
    );
    expect(ritmo.listing.venue.address).toBe("72 Albert Embankment, London SE1 7TP");
    const guys = withKnownVenue(
      listing("TIMBA Y CASINO", "Guy's Bar", "St. Thomas Street, London, United Kingdom"),
      london,
      "GB",
    );
    expect(guys.listing.venue.address).toBe("St Thomas Street, London SE1 9RT");
  });

  it("names each Swing Patrol page's hall in its class titles, then places it", () => {
    const cases: readonly [string, string, string][] = [
      [
        "https://www.swingpatrol.co.uk/classes/waterloo/",
        "Intermediate Swing",
        "1 Coral Street, London SE1 7BE",
      ],
      [
        "https://www.swingpatrol.co.uk/classes/vauxhall/",
        "Advanced Lindy Hop",
        "Miles Street, London SW8 1RL",
      ],
      [
        "https://www.swingpatrol.co.uk/classes/angel/",
        "Intermediate Lindy Hop",
        "Exmouth Market, London EC1R 4QE",
      ],
      [
        "https://www.swingpatrol.co.uk/classes/harringay/",
        "Intermediate Swing",
        "600 Green Lanes, London N8 0RY",
      ],
    ];
    for (const [url, title, expected] of cases) {
      const seed = LONDON_SOURCES.find((s) => s.url === url);
      const named = withTitleVenue(listing(title, null, null), seed?.titleVenues);
      const result = withKnownVenue(named, london, "GB");
      expect(result.listing.venue.address, url).toBe(expected);
      expect(result.venueLocation, url).not.toBeNull();
    }
  });

  it("puts WCSUK's Farnham class at its point outside London", () => {
    const result = withKnownVenue(
      listing(
        "WCSUK Farnham Class",
        "Farnham Memorial Hall",
        "Farnham Memorial Hall West Street, Farnham, GU9, England",
      ),
      london,
      "GB",
    );
    expect(result.venueLocation?.lat).toBeLessThan(51.3);
  });

  it("does not move another Uxbridge Road venue to Tango Amistoso's hall", () => {
    const result = withKnownVenue(
      listing("Gig", "Bush Hall", "310 Uxbridge Road, London W12 7LJ"),
      london,
      "GB",
    );
    expect(result.listing.venue.address).toBe("310 Uxbridge Road, London W12 7LJ");
  });

  it("retires the Smooth Jazz Lounge's tour page", () => {
    expect(LONDON_RETIRED.some((r) => r.url === "https://www.thesmoothjazzlounge.com/events")).toBe(
      true,
    );
  });
});
