// Venue's own page: a made-up title that only names the venue becomes the venue's name (D-299)

import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const reply = (listings: Array<Record<string, unknown>>) =>
  rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "club_night",
      styles: [],
      venue: { name: "A studio" },
      organizer: {},
      ...l,
    })),
  });

const read = (
  pageUrl: string,
  pageText: string,
  listings: Array<Record<string, unknown>>,
  venueLabel?: string,
) =>
  extractionToHarvested(reply(listings), {
    pageUrl,
    fetchedAt: new Date("2026-09-29T14:00:00Z"),
    today: "2026-09-29",
    pageText,
    countryCode: "US",
    venueLabel,
  });

const VOYEUR_PAGE = `The week begins on Thursday at Voyeur; a night for avid music lovers with Dj Sat One

Dance floor kicks off at Midnight

Doors Open 11PM - Party Until 4AM

On a Sunday night starting at 1AM, a packed dance floor is the showcase for the best of Philly's bar, food, and fashion future.

Voyeur is open...

Thursdays Midnight-3:20AM

Fridays and Saturdays 11PM-3:20AM

Sundays 1AM-3:20AM`;

const LA_OTRA_PAGE = `ABOUT US

Iconic latin nightlife destination , LA OTRA is an upscale bar and lounge in the Wynwood Arts District in Miami.

We are open from Thursday to Saturday, from 11pm until 5am, catering to a 21+ crowd looking for a night of dancing and socializing in the heart of Wynwood.`;

describe("venue's own page: made-up title becomes venue name", () => {
  it("Thursday Nights at Voyeur → Voyeur", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [{ title: "Thursday Nights at Voyeur", recurrence_text: "every Thursday" }],
      "Voyeur",
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Voyeur"]);
  });

  it("Weekend Nights at Voyeur → Voyeur", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [{ title: "Weekend Nights at Voyeur", recurrence_text: "every Friday and Saturday" }],
      "Voyeur",
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Voyeur"]);
  });

  it("Sunday Nights at Voyeur → Voyeur", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [{ title: "Sunday Nights at Voyeur", recurrence_text: "every Sunday" }],
      "Voyeur",
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Voyeur"]);
  });

  it("La Otra nightclub → La Otra (page writes LA OTRA)", () => {
    const result = read(
      "https://www.laotramiami.com/",
      LA_OTRA_PAGE,
      [{ title: "La Otra nightclub", recurrence_text: "every Thursday to Saturday" }],
      "La Otra",
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["La Otra"]);
  });

  it("Salsa Night at Voyeur → rejected (non-filler word 'salsa')", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [{ title: "Salsa Night at Voyeur", recurrence_text: "every Thursday" }],
      "Voyeur",
    );
    expect(result.rejected).toEqual([
      { title: "Salsa Night at Voyeur", reason: "the page does not write this title; not listed" },
    ]);
  });

  it("Thursday Nights → rejected (no label word)", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [{ title: "Thursday Nights", recurrence_text: "every Thursday" }],
      "Voyeur",
    );
    expect(result.rejected).toEqual([
      { title: "Thursday Nights", reason: "the page does not write this title; not listed" },
    ]);
  });

  it("no venueLabel → rejected", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [{ title: "Thursday Nights at Voyeur", recurrence_text: "every Thursday" }],
      // venueLabel omitted
    );
    expect(result.rejected).toEqual([
      {
        title: "Thursday Nights at Voyeur",
        reason: "the page does not write this title; not listed",
      },
    ]);
  });

  it("Tavern on Camac (Ascend) → Ascend (page writes Ascend, not Tavern on Camac)", () => {
    const page = `Ascend Lounge is open Thursday-Saturday 10pm-3am.`;
    const result = read(
      "https://example.com/",
      page,
      [{ title: "Ascend Nights", recurrence_text: "every Thursday" }],
      "Tavern on Camac (Ascend)",
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Ascend"]);
  });

  it("multiple Voyeur titles in one reply → all become Voyeur", () => {
    const result = read(
      "https://www.voyeurnightclub.com/",
      VOYEUR_PAGE,
      [
        { title: "Thursday Nights at Voyeur", recurrence_text: "every Thursday" },
        { title: "Weekend Nights at Voyeur", recurrence_text: "every Friday and Saturday" },
        { title: "Sunday Nights at Voyeur", recurrence_text: "every Sunday" },
      ],
      "Voyeur",
    );
    expect(result.rejected).toEqual([]);
    expect(result.listings.map((h) => h.listing.title)).toEqual(["Voyeur", "Voyeur", "Voyeur"]);
  });
});
