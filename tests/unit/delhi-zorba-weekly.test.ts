// Zorba the Buddha's own weekly pages list their nights as fixed weekly nights (coverage's OK, 2026-11-08).
import { describe, expect, it } from "vitest";

import { DELHI_SOURCES } from "@/config/sources/delhi";
import { fixedNightListings } from "@/src/domain/fixed-nights";

// The pages' own schedule markup, as fetched on 2026-11-08.
const DRUMS_PAGE =
  "<p><strong>Schedule (Every Sunday):</strong></p><ul><li><strong>Drums and Dance (Beverages Included):</strong> " +
  "5:00 PM &#8211; 6:30 PM</li><li><strong>Budding Artists Performances:</strong> 6:30 PM – 7:30 PM</li></ul>";
const CIRCLE_PAGE =
  "<p><strong>Schedule (Every Thursday):</strong></p><ul><li><strong>Circle of Mystical Dances:</strong> " +
  "6:30 PM – 8:00 PM</li><li><strong>Organic Vegetarian Buffet Dinner:</strong> 8:00 PM – 9:00 PM</li></ul>";

function seed(url: string) {
  const found = DELHI_SOURCES.find((s) => s.url === url);
  expect(found?.fixedNights?.length).toBe(1);
  return found!;
}

function listings(url: string, pageText: string) {
  const s = seed(url);
  return fixedNightListings(s.fixedNights ?? [], {
    pageText,
    pageUrl: url,
    fetchedAt: new Date("2026-11-08T03:00:00Z"),
    fromNight: "2026-11-08",
    currency: "INR",
    sourceStyles: [...s.styles],
    venueName: s.label,
    venueAddress: s.venueAddress ?? null,
    zone: "Asia/Kolkata",
  }).listings;
}

describe("Zorba the Buddha's weekly nights", () => {
  it("lists Drums & Dance on Sundays at 5pm while the page writes its line", () => {
    const rows = listings(
      "https://zorbathebuddha.org/programs/weekly-events/drums-dance/",
      DRUMS_PAGE,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.listing.title).toBe("Drums & Dance at Zorba the Buddha");
    expect(rows[0]!.listing.local_date).toBe("2026-11-08");
    expect(rows[0]!.listing.doors_time).toBe("17:00");
  });

  it("lists the Circle of Mystical Dances on Thursdays at 6:30pm", () => {
    const rows = listings(
      "https://zorbathebuddha.org/programs/weekly-events/circle-of-mystical-dances/",
      CIRCLE_PAGE,
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.listing.local_date).toBe("2026-11-12");
    expect(rows[0]!.listing.doors_time).toBe("18:30");
  });

  it("lists nothing once the page stops writing the line", () => {
    const rows = listings(
      "https://zorbathebuddha.org/programs/weekly-events/drums-dance/",
      "<p>Schedule to be announced</p>",
    );
    expect(rows).toEqual([]);
  });
});
