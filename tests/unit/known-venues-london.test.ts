// London's known venues against the addresses their sources really write.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { LONDON_SOURCES } from "@/config/sources/london";
import { withKnownVenue, withTitleVenue } from "@/src/pipeline/source-venue";

function listingNamed(name: string): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "ECSTATIC DANCE LONDON - Cacao Dance Tribe",
    listing_type: "social",
    styles: ["ecstatic"],
    local_date: "2026-10-30",
    doors_time: "19:00",
    venue: { name, address: null, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/London",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://ecstaticdancelondon.com/events/" },
  } as unknown as HarvestedListing;
}

describe("London known venues", () => {
  it("places Ecstatic Dance London's directions-only LOCATION at Croftdown Road", () => {
    // The feed's LOCATION, which the iCalendar reader stores as the venue name (2026-10-28).
    const location =
      "13 Minutes from Gospel Oak Station or 11 minutes from Tufnell Park Station (VENUE ADDRESS in order CONFIRMATION EMAIL, please SCROLL DOWN in the email to 'Additional Information'), Between 51 & 53 Croftdown Road, London, England, NW5 1EL, United Kingdom";
    const result = withKnownVenue(listingNamed(location), KNOWN_VENUES.london ?? [], "GB");
    expect(result.listing.venue.address).toBe("53 Croftdown Road, London NW5 1HE");
    expect(result.listing.venue.name).toBe("Ecstatic Dance London, Croftdown Road");
  });

  it("places London Milongas' area-and-postcode venues at their checked street addresses (D-217)", () => {
    const cases: readonly [string, string, string][] = [
      ["Westminster Boating Base", "Pimlico SW1V 3JY", "136 Grosvenor Road, London SW1V 3JY"],
      ["St. Paul's Church, Marylebone", "NW1 6NJ", "5 Rossmore Road, London NW1 6NJ"],
      ["City Academy Studio", "Farringdon EC1R 5EG", "10 Herbal Hill, London EC1R 5EG"],
      ["New Unity Hall", "Angel N1 2TZ", "277A Upper Street, London N1 2TZ"],
    ];
    for (const [name, written, expected] of cases) {
      const listing = listingNamed(name);
      listing.listing.venue.address = written;
      const result = withKnownVenue(listing, KNOWN_VENUES.london ?? [], "GB");
      expect(result.listing.venue.address).toBe(expected);
    }
  });

  it("places Tango Amistoso's hall names at the Claremont Project", () => {
    const result = withKnownVenue(
      listingNamed("Angel/Islington Upper Hall"),
      KNOWN_VENUES.london ?? [],
      "GB",
    );
    expect(result.listing.venue.address).toBe("24-27 White Lion Street, London N1 9PD");
  });

  it("places Swing Out London's area-only venues, DILF's RAES and London Milongas' halls (D-218)", () => {
    const cases: readonly [string, string | null, string][] = [
      ["Jamboree", "King's Cross", "6 St Chad's Place, London WC1X 9HH"],
      ["The Hammersmith Club", "Hammersmith", "11 Rutland Grove, London W6 9DH"],
      ["Dog and Fox", "Wimbledon", "24 High Street, London SW19 5EA"],
      ["The Corner House", "Surbiton", "116 Douglas Road, Surbiton KT6 7SB"],
      ["Unity Hall", "Islington", "277A Upper Street, London N1 2TZ"],
      [
        "RAES ( Previously O'MEARA)",
        "6 O’MEARA STREET, LONDON BRIDGE., SE1 1TE",
        "6 O'Meara Street, London SE1 1TE",
      ],
      [
        "St John's Community Centre",
        "Crossharbour E14 3NE",
        "37-43 Glengall Grove, London E14 3NE",
      ],
      ["10 Herbal Hill", null, "10 Herbal Hill, London EC1R 5EG"],
      ["Wickham Hall", "West Wickham BR4 0JX", "Sussex Road, West Wickham BR4 0JX"],
    ];
    for (const [name, written, expected] of cases) {
      const listing = listingNamed(name);
      listing.listing.venue.address = written;
      const result = withKnownVenue(listing, KNOWN_VENUES.london ?? [], "GB");
      expect(result.listing.venue.address, name).toBe(expected);
    }
  });

  it("places Tango Amistoso's and DILF's no-place rows by title, then at the checked address (D-218)", () => {
    const seedFor = (url: string) => LONDON_SOURCES.find((seed) => seed.url === url)?.titleVenues;
    const cases: readonly [string, string, string][] = [
      [
        "https://www.tango-amistoso.co.uk/weekly-schedule/",
        "Milonga Maitri with DJ Caterina Giannini",
        "10 Herbal Hill, London EC1R 5EG",
      ],
      [
        "https://www.tango-amistoso.co.uk/weekly-schedule/",
        "Milonga Simpatica with DJ Mauro Alejandro Mol",
        "24-27 White Lion Street, London N1 9PD",
      ],
      [
        "https://www.tickettailor.com/events/dilf",
        "DILF LONDON - DARK RITES MASQUERADE",
        "6 O'Meara Street, London SE1 1TE",
      ],
    ];
    for (const [url, title, expected] of cases) {
      const listing = listingNamed("");
      listing.listing.title = title;
      listing.listing.venue.name = null;
      const titled = withTitleVenue(listing, seedFor(url));
      const result = withKnownVenue(titled, KNOWN_VENUES.london ?? [], "GB");
      expect(result.listing.venue.address, title).toBe(expected);
    }
  });
});
