import { describe, expect, it } from "vitest";
import { jsonLdToListings } from "@/src/adapters/feeds/jsonld";

describe("jsonLdToListings with card times (D-276)", () => {
  const PAGE = `Today - Thursday, October 29, 2026
Beginner
Salsa Level 2 @ Essence Dance Academy
Oct 29, 2026
7:00 PM
Essence Dance Academy
$40
Details
Social
Live Dance Music Thursdays @ Red Coral Lounge
Oct 29, 2026
– Oct 30, 2026
8:00 PM
Red Coral Lounge at SJ Marriott Resort
Details
Social
Noche de Salsa @ Vaca Brava
Oct 29, 2026
Vaca Brava
Details`;

  const ev = (name: string, startDate: string) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name,
    startDate,
    endDate: startDate,
    location: {
      "@type": "Place",
      name: "Somewhere",
      address: "1309 Ashford Ave, San Juan, PR 00907",
    },
  });
  const BLOCKS = [
    ev("Salsa Level 2 @ Essence Dance Academy", "2026-10-29"),
    ev("Live Dance Music Thursdays @ Red Coral Lounge", "2026-10-29"),
    ev("Noche de Salsa @ Vaca Brava", "2026-10-29"),
  ];

  const baseOptions = {
    pageUrl: "https://www.danceus.org/events/salsa/puerto-rico-salsa-calendar/",
    fetchedAt: new Date("2026-10-29T12:00:00Z"),
    metroTz: "America/Puerto_Rico",
    countryCode: "PR",
    fromNight: "2026-10-29",
    days: 14,
  };

  it("extracts times from page cards for date-only JSON-LD events", () => {
    const { listings } = jsonLdToListings(BLOCKS, { ...baseOptions, pageText: PAGE });
    expect(listings).toHaveLength(3);

    const essence = listings.find(
      (l) => l.listing.title === "Salsa Level 2 @ Essence Dance Academy",
    );
    const redCoral = listings.find(
      (l) => l.listing.title === "Live Dance Music Thursdays @ Red Coral Lounge",
    );
    const vacaBrava = listings.find((l) => l.listing.title === "Noche de Salsa @ Vaca Brava");

    // Essence has time 7:00 PM -> 19:00
    expect(
      essence?.listing.doors_time ?? essence?.listing.dancing_time ?? essence?.listing.lesson_time,
    ).toBe("19:00");
    // Red Coral has time 8:00 PM -> 20:00
    expect(
      redCoral?.listing.doors_time ??
        redCoral?.listing.dancing_time ??
        redCoral?.listing.lesson_time,
    ).toBe("20:00");
    // Vaca Brava has no time on card -> null
    expect(
      vacaBrava?.listing.doors_time ??
        vacaBrava?.listing.dancing_time ??
        vacaBrava?.listing.lesson_time,
    ).toBeNull();

    // Red Coral's evidence includes note
    expect(redCoral?.listing.evidence.start).toMatch(/; time from its own card on the page/);
  });

  it("without pageText leaves all untimed", () => {
    const { listings } = jsonLdToListings(BLOCKS, baseOptions);
    expect(listings).toHaveLength(3);
    for (const l of listings) {
      expect(l.listing.doors_time ?? l.listing.dancing_time ?? l.listing.lesson_time).toBeNull();
    }
  });

  it("keeps ISO start with time even when card says different", () => {
    const PAGE_WITH_8PM =
      PAGE + "\nSocial\nLive Salsa @ Cafe Ocho\nOct 29, 2026\n8:00 PM\nCafe Ocho\nDetails";
    const blocksWithTime = [
      ...BLOCKS,
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Live Salsa @ Cafe Ocho",
        startDate: "2026-10-29T21:30:00-04:00",
        endDate: "2026-10-29T21:30:00-04:00",
        location: {
          "@type": "Place",
          name: "Cafe Ocho",
          address: "1309 Ashford Ave, San Juan, PR 00907",
        },
      },
    ];
    const { listings } = jsonLdToListings(blocksWithTime, {
      ...baseOptions,
      pageText: PAGE_WITH_8PM,
    });
    const cafeOcho = listings.find((l) => l.listing.title === "Live Salsa @ Cafe Ocho");
    // Should keep 21:30 from ISO, not 20:00 from card
    expect(
      cafeOcho?.listing.doors_time ??
        cafeOcho?.listing.dancing_time ??
        cafeOcho?.listing.lesson_time,
    ).toBe("21:30");
  });

  it("ignores card time before 06:00", () => {
    const PAGE_EARLY = `Today - Thursday, October 29, 2026
Social
After-Hours Salsa @ Red Coral Lounge
Oct 29, 2026
2:00 AM
Red Coral Lounge
Details`;
    const blocksEarly = [
      {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "After-Hours Salsa @ Red Coral Lounge",
        startDate: "2026-10-29",
        endDate: "2026-10-29",
        location: {
          "@type": "Place",
          name: "Red Coral Lounge",
          address: "1309 Ashford Ave, San Juan, PR 00907",
        },
      },
    ];
    const { listings } = jsonLdToListings(blocksEarly, { ...baseOptions, pageText: PAGE_EARLY });
    const afterHours = listings[0];
    // 2:00 AM is before 06:00, should stay untimed
    expect(
      afterHours?.listing.doors_time ??
        afterHours?.listing.dancing_time ??
        afterHours?.listing.lesson_time,
    ).toBeNull();
  });
});
