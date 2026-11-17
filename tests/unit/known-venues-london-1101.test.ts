// London known venues for full read 41327983492's "too vague" addresses (2026-11-01).
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listing(name: string | null, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Dance night",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-06",
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
    provenance: { sourceUrl: "https://www.5rhythms.com/classes/DanceKew-297191" },
  } as unknown as HarvestedListing;
}

const london = KNOWN_VENUES.london ?? [];

describe("London known venues (read 41327983492)", () => {
  it("places each venue the geocoder refused as too vague, as each source writes it", () => {
    const cases: [string, string, string][] = [
      [
        "Kew Community Centre",
        "The Avenue, Kew TW9 2AJ",
        "Kew Community Centre, St Luke's Church, The Avenue, London TW9 2AJ",
      ],
      [
        "Chestnut Grove School",
        "Boundaries Road entrance, Balham SW12 8JZ, London, United Kingdom",
        "Chestnut Grove School, Boundaries Road, London SW12 8JZ",
      ],
      [
        "URC Church",
        "Pond Square, Highgate, N6 6BA, London, United Kingdom",
        "Highgate United Reformed Church, Pond Square, London N6 6BA",
      ],
      [
        "St Luke",
        "St Luke, Hillmarton Road, London N7 9RE, London, United Kingdom",
        "St Luke's Church, Hillmarton Road, London N7 9RE",
      ],
      [
        "Marlborough Primary School",
        "Draycott Ave, Chelsea, London SW3 3AP, United Kingdom",
        "Marlborough Primary School, Draycott Avenue, London SW3 3AP",
      ],
      [
        "Acland Burghley School",
        "Entrance on Churchill Road, NW5 1AN London, United Kingdom",
        "Acland Burghley School, Churchill Road, London NW5 1AN",
      ],
      [
        "Arch535",
        "Arch 535, Orphans Yard, Brixton Station Rd, London SW9 8QB",
        "Arch 535, Orphans Yard, Brixton Station Road, London SW9 8QB",
      ],
      [
        "Club Silly (Bosi)",
        "Bureau Of Silly ideas, Arch 555, Valentia Place, London, SW9 8PJ",
        "18 Valentia Place, London SW9 8EP",
      ],
      [
        "The View From The Shard",
        "joiner street, se1 9QU",
        "The Shard, Joiner Street, London SE1 9QU",
      ],
      ["Kizuna", "Hanbury St, London E1 5JP", "Hanbury Street, London E1 5JP"],
      [
        "02 Hollywood Bowl",
        "Peninsula Square, Greenwich, London, SE10 0EN, United Kingdom",
        "Hollywood Bowl, Peninsula Square, London SE10 0EN",
      ],
      [
        "Block C",
        "E15 2SJ, London, Greater London, England, United Kingdom",
        "Block C, London E15 2SJ",
      ],
      [
        "Earls Court Salsa & Bachata Club",
        "Earls Court Salsa & Bachata Club Earls Court Road, London, W8 6QH, England",
        "Earls Court Salsa & Bachata Club, Earls Court Road, London W8 6QH",
      ],
    ];
    for (const [name, written, expected] of cases) {
      const placed = withKnownVenue(listing(name, written), london, "GB");
      expect(placed.listing.venue.address, name).toBe(expected);
      expect(placed.venueLocation, name).not.toBeNull();
    }
  });

  it("does not move a St Luke's in another postcode to Hillmarton Road", () => {
    const placed = withKnownVenue(
      listing("St Luke", "St Luke's Church, Sydney Street, London SW3 6NH"),
      london,
      "GB",
    );
    expect(placed.listing.venue.address).toBe("St Luke's Church, Sydney Street, London SW3 6NH");
  });
});
