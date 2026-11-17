import { describe, expect, it } from "vitest";
import { withListedDates } from "@/src/domain/dates-list";
import { rawExtractionSchema } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";
import type { HarvestedListing } from "@/src/adapters/types";

function reply(listings: Array<Record<string, unknown>>) {
  return rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      venue: { name: "Fringe Dairy" },
      organizer: {},
      ...l,
    })),
  });
}

const SWING_PAGE = `November Weekly Swing Dance Social
- Wed 04-11-2026, 8:00 PM - 3 h
- Wed 11-11-2026, 8:00 PM - 3 h
- Wed 18-11-2026, 8:00 PM - 3 h
- Wed 25-11-2026, 8:00 PM - 3 h
Wed 04-11-2026, 8:00 PM - 3 h
more time slots &raquo; [https://www.hkfringeclub.com/en/whatson/2777-November+Weekly+Swing+Dance+Social.html]
Fringe Dairy
Regular: HKD100
[https://www.hkfringeclub.com/en/whatson/2736-Own+You+Stage.html]
Own You Stage | Music Edition
Hong Kong Fringe Club
- Mon 09-11-2026, 8:00 PM - 2 h
- Sat 28-11-2026, 8:00 PM - 2 h`;

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

describe("withListedDates row step", () => {
  const defaultNights = Array.from({ length: 14 }, (_, i) => {
    const date = new Date("2026-10-31");
    date.setDate(date.getDate() + i);
    return date.toISOString().slice(0, 10);
  });

  it("Swing page, model gives one listing dated 2026-11-04 dancing 20:00 end 23:00: added 1 copy for 2026-11-11", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          dancing_time: "20:00",
          end_time: "23:00",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: SWING_PAGE,
        countryCode: "HK",
      },
    );

    const result = withListedDates(harvested.listings, SWING_PAGE, defaultNights, "en");

    expect(result.added).toBe(1);
    expect(result.listings).toHaveLength(2);
    const added = result.listings[1];
    expect(added?.listing.local_date).toBe("2026-11-11");
    expect(added?.listing.dancing_time).toBe("20:00");
    expect(added?.listing.end_time).toBe("23:00");
    // No copy for 11-09 (Own You Stage) or 11-18/11-25 (outside window)
  });

  it("Same with 28-night window (2026-10-31 .. 2026-11-27): copies for 11-11, 11-18, 11-25", () => {
    const nights28 = Array.from({ length: 28 }, (_, i) => {
      const date = new Date("2026-10-31");
      date.setDate(date.getDate() + i);
      return date.toISOString().slice(0, 10);
    });

    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          dancing_time: "20:00",
          end_time: "23:00",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: SWING_PAGE,
        countryCode: "HK",
      },
    );

    const result = withListedDates(harvested.listings, SWING_PAGE, nights28, "en");

    expect(result.added).toBe(3);
    expect(result.listings).toHaveLength(4);
    const addedDates = result.listings.slice(1).map((l) => l.listing.local_date);
    expect(addedDates).toEqual(["2026-11-11", "2026-11-18", "2026-11-25"]);
  });

  it("Mixed times: rows with different durations", () => {
    const page = `November Weekly Swing Dance Social
- Wed 04-11-2026, 8:00 PM - 3 h
- Wed 11-11-2026, 7:30 PM - 4 h`;

    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          dancing_time: "20:00",
          end_time: "23:00",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: page,
        countryCode: "HK",
      },
    );

    const result = withListedDates(harvested.listings, page, defaultNights, "en");

    expect(result.added).toBe(1);
    const added = result.listings[1];
    expect(added?.listing.local_date).toBe("2026-11-11");
    // 7:30 PM + 4 hours = 23:30
    expect(added?.listing.dancing_time).toBe("19:30");
    expect(added?.listing.end_time).toBe("23:30");
  });

  it("Row with no end: copy end_time null", () => {
    const page = `November Weekly Swing Dance Social
- Wed 11-11-2026, 8:00 PM`;

    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          dancing_time: "20:00",
          end_time: "23:00",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: page,
        countryCode: "HK",
      },
    );

    const result = withListedDates(harvested.listings, page, defaultNights, "en");

    expect(result.added).toBe(1);
    const added = result.listings[1];
    expect(added?.listing.local_date).toBe("2026-11-11");
    expect(added?.listing.dancing_time).toBe("20:00");
    expect(added?.listing.end_time).toBeNull();
  });

  it("Bare headings still work (NEWHAM text)", () => {
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

    const result = withListedDates(harvested.listings, NEWHAM, nights, "en");

    expect(result.added).toBe(1);
    expect(result.listings).toHaveLength(2);
    const added = result.listings[1];
    expect(added?.listing.local_date).toBe("2026-11-11");
    // Times may be withdrawn by the pipeline
    expect(added?.listing.dancing_time).toBeNull();
    expect(added?.listing.end_time).toBeNull();
  });

  it("Listing with recurrence_text gets no row copies", () => {
    const page = `November Weekly Swing Dance Social
- Wed 11-11-2026, 8:00 PM - 3 h`;

    // A harvested listing written by hand (only the fields withListedDates reads).
    const listing = {
      listing: {
        title: "November Weekly Swing Dance Social",
        local_date: "2026-11-04",
        recurrence_text: "weekly",
        dancing_time: "20:00",
        end_time: "23:00",
        doors_time: null,
        lesson_time: null,
        styles: [],
        venue: { name: "Fringe Dairy", address: null, url: null },
        organizer: { name: null, url: null },
        listing_type: "social",
        evidence: {},
        confidence: {},
      },
      externalId: null,
    } as unknown as HarvestedListing;

    const result = withListedDates([listing], page, defaultNights, "en");

    expect(result.added).toBe(0);
    expect(result.listings).toHaveLength(1);
  });

  it("A recurrence_text that only lists the rows' dates still gets row copies (production read, 2026-10-31)", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          dancing_time: "20:00",
          end_time: "23:00",
          recurrence_text: "Wed 04-11-2026, Wed 11-11-2026, Wed 18-11-2026, Wed 25-11-2026",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-31T14:18:38Z"),
        today: "2026-10-31",
        pageText: SWING_PAGE,
        countryCode: "HK",
      },
    );

    const result = withListedDates(harvested.listings, SWING_PAGE, defaultNights, "en-HK");

    expect(result.added).toBe(1);
    const added = result.listings.find((l) => l.listing.local_date === "2026-11-11");
    expect(added?.listing.dancing_time).toBe("20:00");
    expect(added?.listing.end_time).toBe("23:00");
    expect(added?.listing.recurrence_text).toBeNull();
  });

  it("Model already gave 11-04 and 11-11: nothing added", () => {
    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          dancing_time: "20:00",
          end_time: "23:00",
        },
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-11",
          dancing_time: "20:00",
          end_time: "23:00",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: SWING_PAGE,
        countryCode: "HK",
      },
    );

    const result = withListedDates(harvested.listings, SWING_PAGE, defaultNights, "en");

    expect(result.added).toBe(0);
    expect(result.listings).toHaveLength(2);
  });
  it("A row copy takes only the row's start: the template's lesson is another night's", () => {
    const page = `November Weekly Swing Dance Social
- Wed 04-11-2026, 7:00 PM - 4 h
- Wed 11-11-2026, 7:30 PM - 3 h`;
    const harvested = extractionToHarvested(
      reply([
        {
          title: "November Weekly Swing Dance Social",
          local_date: "2026-11-04",
          lesson_time: "19:00",
          dancing_time: "20:00",
          end_time: "23:00",
        },
      ]),
      {
        pageUrl: "https://example.com",
        fetchedAt: new Date("2026-10-29T14:00:00Z"),
        today: "2026-10-29",
        pageText: page,
        countryCode: "HK",
      },
    );
    const result = withListedDates(harvested.listings, page, defaultNights, "en");
    expect(result.added).toBe(1);
    const copy = result.listings[1]?.listing;
    expect(copy?.local_date).toBe("2026-11-11");
    expect(copy?.dancing_time).toBe("19:30");
    expect(copy?.lesson_time).toBeNull();
    expect(copy?.doors_time).toBeNull();
    expect(copy?.end_time).toBe("22:30");
    expect(result.listings[0]).toBe(harvested.listings[0]);
  });
});
