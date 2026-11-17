import { describe, it, expect } from "vitest";
import type { HarvestedListing } from "@/src/adapters/types";
import { cardTitleName, withCardTitle } from "@/src/pipeline/card-title";
import { LONDON_SOURCES } from "@/config/sources/london";
import { rawListingSchema } from "@/src/domain/listing";

describe("card-title", () => {
  // Find the 93 Feet East seed
  const seed = LONDON_SOURCES.find((s) => s.url === "https://www.93feeteast.co.uk/");
  if (!seed) throw new Error("93 Feet East seed not found");
  const card = seed.cardTitle;
  if (!card) throw new Error("cardTitle not defined in seed");

  it("returns undefined for no card", () => {
    expect(cardTitleName("some title", undefined)).toBeUndefined();
  });

  it("returns undefined for title without prefix", () => {
    expect(cardTitleName("The Halloween Disco at 93 Feet East", card)).toBeUndefined();
    expect(cardTitleName("BOAT CLUB HALLOWEEN 2026", card)).toBeUndefined();
  });

  it("returns null for date-only card", () => {
    const result = cardTitleName("93 CLUB Saturday 31 Oct 9 pm", card);
    expect(result).toBeNull();
  });

  it("cleans prefix and rooms and tails", () => {
    const cases = [
      {
        input:
          "93 LIVE Friday 06 Nov 8 pm - 12 AM / Live Room 93 Live Presents: Lo Fidelity Allstars 90s Dance Electronic",
        expected: "93 Live Presents: Lo Fidelity Allstars",
      },
      {
        input:
          "93 CLUB Saturday 07 Nov 4 pm - 1:30 AM / Members Bar / Rooftop Terrace Escapada Returns House",
        expected: "Escapada Returns",
      },
      {
        input:
          "93 CLUB Sunday 08 Nov 3:30 pm - 10:30 PM / Main Room / The Courtyard AFTERJAM [05]: LONDON Deep House Tech House",
        expected: "AFTERJAM [05]: LONDON",
      },
      {
        input:
          "93 CLUB Friday 13 Nov 7 pm - 1 AM / Live Room Twenty One Pilots Appreciation Party (London) ALTERNATIVE ROCK Synth Pop",
        expected: "Twenty One Pilots Appreciation Party (London)",
      },
      {
        input:
          "93 CLUB Saturday 14 Nov 4 pm - 1 AM / Venue Takeover Deep into Soul x Djoon House Soulful House",
        expected: "Deep into Soul x Djoon",
      },
      // An age tag at the end (2026-10-29).
      {
        input:
          "93 CLUB Saturday 31 Oct 9 pm - 1:30 AM / Members Bar / Members Bar The Halloween Disco at 93 Feet East Disco 18+",
        expected: "The Halloween Disco at 93 Feet East",
      },
      {
        input:
          "93 CLUB Saturday 07 Nov 4 pm - 1:30 AM / Members Bar / Rooftop Terrace Escapada Returns House 18+",
        expected: "Escapada Returns",
      },
      {
        input:
          "93 CLUB Sunday 08 Nov 3:30 pm - 10:30 PM / Main Room / The Courtyard AFTERJAM [05]: LONDON Deep House Tech House 18+",
        expected: "AFTERJAM [05]: LONDON",
      },
    ];

    for (const { input, expected } of cases) {
      const result = cardTitleName(input, card);
      expect(result).toBe(expected);
    }
  });

  describe("withCardTitle", () => {
    const makeListing = (title: string): HarvestedListing => {
      const raw = rawListingSchema.parse({
        title,
        listing_type: "social",
        styles: ["salsa"],
        local_date: "2026-10-31",
        doors_time: "20:00",
        venue: { name: null, address: null, url: null },
        organizer: { name: null, url: null },
      });
      return {
        listing: raw,
        externalId: "test:1",
        tz: "Europe/London",
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://www.93feeteast.co.uk/",
          fetchedAt: new Date(),
          method: "feed",
        },
      };
    };

    it("returns same listing when card undefined", () => {
      const listing = makeListing("Some event");
      const result = withCardTitle(listing, undefined);
      expect(result).toBe(listing);
    });

    it("returns null when title becomes empty", () => {
      const listing = makeListing("93 CLUB Saturday 31 Oct 9 pm");
      const result = withCardTitle(listing, card);
      expect(result).toBeNull();
    });

    it("returns cleaned listing when prefix matched", () => {
      const input =
        "93 LIVE Friday 06 Nov 8 pm - 12 AM / Live Room 93 Live Presents: Lo Fidelity Allstars 90s Dance Electronic";
      const listing = makeListing(input);
      const result = withCardTitle(listing, card);
      expect(result).not.toBeNull();
      if (result && typeof result === "object") {
        expect(result.listing.title).toBe("93 Live Presents: Lo Fidelity Allstars");
        // Ensure other properties are preserved
        expect(result.listing.local_date).toBe("2026-10-31");
      }
    });

    it("returns same listing when prefix not matched", () => {
      const listing = makeListing("The Halloween Disco at 93 Feet East");
      const result = withCardTitle(listing, card);
      expect(result).toBe(listing);
    });
  });
});
