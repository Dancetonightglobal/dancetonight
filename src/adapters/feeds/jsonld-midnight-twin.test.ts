import { describe, expect, it } from "vitest";
import { jsonLdToListings } from "@/src/adapters/feeds/jsonld";

// D-854: berlin.de's Eierschale page lists the 11-21 Fruehtanz twice in its JSON-LD: once at the date's local
// midnight (2026-11-20T23:00Z = 00:00 Berlin, the date with no time) and once at its real 18:00 start. The midnight
// node was filed on night 11-20 (before 06:00 counts as the night before, D-004), so the two never met.
describe("jsonLdToListings: a local-midnight node gives way to its same-day timed twin (D-854)", () => {
  const ev = (name: string, startDate: string, url?: string) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name,
    startDate,
    ...(url ? { url } : {}),
    location: {
      "@type": "Place",
      name: "Eierschale Dahlem",
      address: "Podbielskiallee 50, 14195 Berlin",
    },
  });

  const baseOptions = {
    pageUrl: "https://www.berlin.de/tickets/party/fruehtanz-in-der-eierschale-dahlem-c30c838e/",
    fetchedAt: new Date("2026-11-11T08:00:00Z"),
    metroTz: "Europe/Berlin",
    countryCode: "DE",
    fromNight: "2026-11-11",
    days: 30,
  };

  const timeOf = (l: { listing: Record<string, unknown> } | undefined) =>
    l?.listing.doors_time ?? l?.listing.dancing_time ?? l?.listing.lesson_time ?? null;

  it("drops the midnight node when a same-title node starts later on that calendar day", () => {
    const blocks = [
      ev("Frühtanz in der Eierschale Dahlem", "2026-11-20T23:00:00.000000+00:00"),
      ev(
        "FrühTanz in der Eierschale Dahlem",
        "2026-11-21T17:00:00.000000+00:00",
        "https://www.berlin.de/tickets/party/fruehtanz-in-der-eierschale-dahlem/2026-11-21-fruehtanz/",
      ),
      ev("FrühTanz in der Eierschale Dahlem", "2026-12-05T17:00:00.000000+00:00"),
    ];
    const { listings, notes } = jsonLdToListings(blocks, baseOptions);
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.listing.local_date).sort()).toEqual(["2026-11-21", "2026-12-05"]);
    const nov21 = listings.find((l) => l.listing.local_date === "2026-11-21");
    expect(timeOf(nov21)).toBe("18:00");
    expect(listings.some((l) => l.listing.local_date === "2026-11-20")).toBe(false);
    expect(notes).toContain("1 midnight start(s) dropped for a same-day timed twin");
  });

  it("keeps a real midnight start that has no same-day twin", () => {
    const blocks = [
      ev("Club Night", "2026-11-20T23:00:00+00:00"),
      ev("Club Night", "2026-11-27T23:00:00+00:00"),
    ];
    const { listings, notes } = jsonLdToListings(blocks, baseOptions);
    expect(listings).toHaveLength(2);
    expect(listings.map((l) => l.listing.local_date).sort()).toEqual(["2026-11-20", "2026-11-27"]);
    expect(listings.every((l) => timeOf(l) === "00:00")).toBe(true);
    expect((notes ?? []).some((n) => n.includes("midnight start(s) dropped"))).toBe(false);
  });

  it("keeps the midnight node when the same-day node has another title", () => {
    const blocks = [
      ev("Late Techno", "2026-11-20T23:00:00+00:00"),
      ev("Tea Dance", "2026-11-21T17:00:00+00:00"),
    ];
    const { listings } = jsonLdToListings(blocks, baseOptions);
    expect(listings).toHaveLength(2);
  });

  it("keeps the midnight node when its twin is on the night before (an earlier evening start)", () => {
    // 20:00 on 11-20 and 00:00 on 11-21 are different calendar days: not a twin by this rule.
    const blocks = [
      ev("Long Night", "2026-11-20T19:00:00+00:00"),
      ev("Long Night", "2026-11-20T23:00:00+00:00"),
    ];
    const { listings } = jsonLdToListings(blocks, baseOptions);
    expect(listings).toHaveLength(2);
  });

  it("does not apply to a 00:30 start", () => {
    const blocks = [
      ev("Fruehtanz", "2026-11-20T23:30:00+00:00"),
      ev("Fruehtanz", "2026-11-21T17:00:00+00:00"),
    ];
    const { listings } = jsonLdToListings(blocks, baseOptions);
    expect(listings).toHaveLength(2);
  });
});
