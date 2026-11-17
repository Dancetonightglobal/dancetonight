// A title the model joins from a row's cells keeps the longest part the page writes (D-222).
import { describe, expect, it } from "vitest";

import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const NOW = new Date("2026-10-28T14:00:00Z");
const TONIGHT = "2026-10-28";

const read = (text: string, title: string) =>
  extractionToHarvested(
    rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [
        {
          title,
          listing_type: "social",
          styles: [],
          local_date: "2026-11-06",
          doors_time: "23:00",
          venue: { name: "Palais" },
          organizer: {},
        },
      ],
    }),
    {
      pageUrl: "https://example.com/",
      fetchedAt: NOW,
      today: TONIGHT,
      pageText: text,
      countryCode: "GB",
    },
  );

const PAGE = `What's on
Palais presents
6 Nov, 11pm
Axel Boman, CC:DISCO!
Palais presents
6 Nov, 11pm
Midland`;

describe("titles joined from a row's cells", () => {
  it("keeps the artist cell of 'Palais presents Axel Boman, CC:DISCO!'", () => {
    const result = read(PAGE, "Palais presents Axel Boman, CC:DISCO!");
    expect(result.rejected).toEqual([]);
    expect(result.listings[0]?.listing.title).toBe("Axel Boman, CC:DISCO!");
  });

  it("splits at a colon and a dash", () => {
    expect(read(PAGE, "Palais: Midland").listings[0]?.listing.title).toBe("Midland");
    expect(read(PAGE, "Palais presents - Midland").listings[0]?.listing.title).toBe("Midland");
  });

  it("still rejects a title no part of which the page writes", () => {
    const result = read(PAGE, "Club Night presents Someone Else");
    expect(result.listings).toEqual([]);
    expect(result.rejected[0]?.reason).toBe("the page does not write this title; not listed");
  });

  it("does not keep a part shorter than four characters", () => {
    const result = read("Palais presents\nAB\n6 Nov, 11pm", "Club Night presents AB");
    expect(result.listings).toEqual([]);
  });
});
