import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";
import { KNOWN_VENUES } from "@/config/known-venues";
import { MARRAKESH_SOURCES } from "@/config/sources/marrakesh";

function makeListing({
  title = "Test Event",
  venueName = null,
  venueAddress = null,
  venueLocation = null,
}: {
  title?: string;
  venueName?: string | null;
  venueAddress?: string | null;
  venueLocation?: { lat: number; lng: number } | null;
}): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-10-11",
    doors_time: "20:00",
    venue: {
      name: venueName ?? null,
      address: venueAddress ?? null,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Africa/Casablanca",
    venueLocation,
    recurrence: null,
    provenance: {
      sourceUrl: "https://example.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("Marrakesh known venues (D-1100, read 42463050305)", () => {
  const venues = KNOWN_VENUES.marrakesh ?? [];

  it("every entry has a point inside the Marrakesh box and a 40000 Marrakech address", () => {
    expect(venues.length).toBeGreaterThanOrEqual(6);
    for (const venue of venues) {
      expect(venue.point).toBeDefined();
      expect(venue.point!.lat).toBeGreaterThan(31.55);
      expect(venue.point!.lat).toBeLessThan(31.7);
      expect(venue.point!.lng).toBeGreaterThan(-8.1);
      expect(venue.point!.lng).toBeLessThan(-7.9);
      expect(venue.address).toContain("40000 Marrakech");
    }
  });

  it("each venue page source's own address takes its checked point", () => {
    for (const source of MARRAKESH_SOURCES) {
      if (!source.venueAddress) continue;
      const entry = venues.find((v) => v.address === source.venueAddress);
      expect(entry, source.label).toBeDefined();
      const name = source.venueAddress.split(",")[0] ?? "";
      const out = withKnownVenue(
        makeListing({ venueName: name, venueAddress: source.venueAddress }),
        venues,
        "MA",
      );
      expect(out.venueLocation, source.label).toEqual(
        expect.objectContaining({ lat: entry!.point!.lat, lng: entry!.point!.lng }),
      );
    }
  });

  it("El Fenn rows from RA and from its own page take its point (read 42586138898)", () => {
    const fenn = venues.find((v) => v.names.includes("El Fenn"))!;
    for (const venue of [
      { venueName: "El Fenn", venueAddress: "El Fenn Hotel and Rooftop Bar" },
      { venueName: "Sol Sundays at El Fenn", venueAddress: fenn.address },
    ]) {
      const out = withKnownVenue(makeListing(venue), venues, "MA");
      expect(out.venueLocation, venue.venueName).toEqual(
        expect.objectContaining({ lat: fenn.point!.lat, lng: fenn.point!.lng }),
      );
    }
  });

  it("Comptoir Darna's dinner shows are not dance nights", () => {
    const comptoir = MARRAKESH_SOURCES.find((s) => s.label === "Souktronic at Comptoir Darna");
    expect(comptoir?.notDanceNights).toContain("Ballet de danse orientale");
  });
});
