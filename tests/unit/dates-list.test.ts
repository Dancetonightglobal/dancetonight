import { describe, expect, it } from "vitest";
import { withListedDates } from "@/src/domain/dates-list";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";
import { readBlockTimes } from "@/src/domain/stated-times";

const NEWHAM = `Newham's Tea Dances
Newham's grand tea dances - an opportunity to salsa, waltz, rumba and socialise the afternoon away. Refreshments included in the admission price.
Please contact Stratford Library 02033730826
Monday 12 October 2026
Wednesday 11 November 2026
Monday 7 December 2026
Monday 11 January 2027
*Time:
Dance Lessons start from 12.30noon – 1.30pm
*Tea Dance Time starts from: 1.30pm – 4.30pm
Date:
17 Mar 2026.
Location:
Old Town Hall Stratford 29 The Broadway, E15 4BQ
Cost:
£3 Newham Residents`;

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "Old Town Hall Stratford" },
      organizer: {},
      ...l,
    })),
  });
}

describe("withListedDates", () => {
  const octToNovNights = [
    "2026-10-30",
    "2026-10-31",
    "2026-11-01",
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
    "2026-11-09",
    "2026-11-10",
    "2026-11-11",
    "2026-11-12",
  ];
  const decNights = [
    "2026-12-01",
    "2026-12-02",
    "2026-12-03",
    "2026-12-04",
    "2026-12-05",
    "2026-12-06",
    "2026-12-07",
    "2026-12-08",
    "2026-12-09",
    "2026-12-10",
    "2026-12-11",
    "2026-12-12",
    "2026-12-13",
    "2026-12-14",
  ];

  it("Newham page, model listing dated 2026-03-17: adds one copy for 2026-11-11", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    const result = withListedDates(harvested.listings, NEWHAM, octToNovNights, "en");

    expect(result.added).toBe(1);
    expect(result.listings).toHaveLength(2);
    const added = result.listings[1];
    expect(added?.listing.local_date).toBe("2026-11-11");
    // Times may be withdrawn by the pipeline, so they could be null.
    // The copy should reflect the template's state.
    expect(added?.listing.dancing_time).toBeNull();
    expect(added?.listing.end_time).toBeNull();
    expect(added?.listing.recurrence_text).toBeNull();
    expect(added?.externalId).toBeNull();
    // Original listing unchanged.
    expect(result.listings[0]?.listing.local_date).toBe("2026-03-17");
  });

  it("Same page, Dec window: adds one copy for 2026-12-07", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    const result = withListedDates(harvested.listings, NEWHAM, decNights, "en");

    expect(result.added).toBe(1);
    expect(result.listings).toHaveLength(2);
    const added = result.listings[1];
    expect(added?.listing.local_date).toBe("2026-12-07");
    // Times may be withdrawn.
    expect(added?.listing.dancing_time).toBeNull();
    expect(added?.listing.end_time).toBeNull();
  });

  it("Model already gave 2026-11-11: nothing added", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-11-11",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    const result = withListedDates(harvested.listings, NEWHAM, octToNovNights, "en");

    expect(result.added).toBe(0);
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0]?.listing.local_date).toBe("2026-11-11");
  });

  it("Listing with recurrence_text: nothing added", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: null,
          recurrence_text: "every Monday",
          dancing_time: "13:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );
    const withRule = harvested.listings.map((h) => ({
      ...h,
      listing: { ...h.listing, recurrence_text: "every Monday" },
    }));
    const result = withListedDates(withRule, NEWHAM, octToNovNights, "en");
    expect(result.added).toBe(0);
    expect(result.listings).toEqual(withRule);
  });

  it("Page with a single date line: unchanged", () => {
    const singleDatePage = `Event Title
Monday 12 October 2026
Time: 2pm`;
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Event Title",
          local_date: "2026-10-12",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: singleDatePage,
        countryCode: "GB",
      },
    );

    const result = withListedDates(harvested.listings, singleDatePage, octToNovNights, "en");

    expect(result.added).toBe(0);
    expect(result.listings).toHaveLength(1);
  });

  it("Empty listings: returns empty", () => {
    const result = withListedDates([], NEWHAM, octToNovNights, "en");
    expect(result.added).toBe(0);
    expect(result.listings).toEqual([]);
  });

  it("Does not mutate input", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    const original = structuredClone(harvested.listings);
    const result = withListedDates(harvested.listings, NEWHAM, octToNovNights, "en");

    // Original array unchanged.
    expect(harvested.listings).toEqual(original);
    // New array is different.
    expect(result.listings).not.toBe(harvested.listings);
    // Ensure deep equality for the first element.
    expect(result.listings[0]).toEqual(original[0]);
  });

  it('reads "12.30noon" as 12:30 (Newham\'s lesson)', () => {
    const times = readBlockTimes("Dance Lessons start from 12.30noon – 1.30pm", "en");
    expect(times[0]?.value).toBe("12:30");
    expect(times[1]?.value).toBe("13:30");
  });

  it("D-492: copies take times from group when template field is null", () => {
    const nights = [
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ];
    // Create two same-title listings for 2026-03-17
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          lesson_time: "12:30",
          dancing_time: null,
          end_time: "16:30",
        },
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          lesson_time: "12:30",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    const result = withListedDates(harvested.listings, NEWHAM, nights, "en");

    expect(result.added).toBe(1);
    expect(result.listings).toHaveLength(3);
    const added = result.listings[2];
    expect(added?.listing.local_date).toBe("2026-11-11");
    // Template (first listing) had dancing_time null, so copy should take from second listing
    expect(added?.listing.dancing_time).toBe("13:30");
    expect(added?.listing.lesson_time).toBe("12:30");
    expect(added?.listing.end_time).toBe("16:30");
    // Original listings unchanged
    expect(result.listings[0]?.listing.dancing_time).toBeNull();
    expect(result.listings[1]?.listing.dancing_time).toBe("13:30");
  });

  it("D-492: copy keeps template's dancing_time when it already has one", () => {
    const nights = [
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
      "2026-11-10",
      "2026-11-11",
      "2026-11-12",
    ];
    // First listing has dancing_time "14:00", second has "13:30"
    const harvested = extractionToHarvested(
      reply([
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          dancing_time: "14:00",
          end_time: "16:30",
        },
        {
          title: "Newham's Tea Dances",
          local_date: "2026-03-17",
          dancing_time: "13:30",
          end_time: "16:30",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: NEWHAM,
        countryCode: "GB",
      },
    );

    // The page does not write 14:00, so grounding withdraws it and the withdrawn copy beside the
    // timed 13:30 one is dropped (D-868): build the 14:00 template from the copy that stands.
    expect(harvested.listings).toHaveLength(1);
    const first = harvested.listings[0]!;
    const listings = [
      { ...first, listing: { ...first.listing, dancing_time: "14:00" } },
      ...harvested.listings,
    ];
    const result = withListedDates(listings, NEWHAM, nights, "en");

    expect(result.added).toBe(1);
    const added = result.listings[2];
    // Template's dancing_time is "14:00", should be kept
    expect(added?.listing.dancing_time).toBe("14:00");
    expect(added?.listing.end_time).toBe("16:30");
  });
});
