// D-280: A venue written as "various venues" or "multiple neighborhoods" is no place.
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { isNoPlace, withoutNoPlaceVenue } from "@/src/pipeline/source-venue";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(
  venue: { name?: string | null; address?: string | null; url?: string | null },
  venueLocation: { lat: number; lng: number } | null = { lat: 19.4285, lng: -99.1595 },
): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Somos Casineros en Mexico",
    listing_type: "social",
    styles: ["salsa"],
    local_date: "2026-11-02",
    doors_time: "20:00",
    venue: { name: venue.name ?? null, address: venue.address ?? null, url: venue.url ?? null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Mexico_City",
    venueLocation,
    recurrence: null,
    provenance: { sourceUrl: "https://example.com", fetchedAt: new Date(), method: "feed" },
  };
}

describe("isNoPlace", () => {
  it("returns true for phrases that indicate no single place", () => {
    expect(isNoPlace("Various venues in Mexico City")).toBe(true);
    expect(isNoPlace("Multiple neighborhoods, Mexico City, CDMX, Mexico")).toBe(true);
    expect(isNoPlace("Varios lugares")).toBe(true);
    expect(isNoPlace("Por confirmar")).toBe(true);
    expect(isNoPlace("VARIOUS LOCATIONS")).toBe(true);
    expect(isNoPlace("various venues")).toBe(true);
    expect(isNoPlace("multiple neighborhoods")).toBe(true);
    expect(isNoPlace("a confirmar")).toBe(true);
    expect(isNoPlace("por definir")).toBe(true);
    expect(isNoPlace("varios locais")).toBe(true);
  });

  it("returns false for phrases that do not start with a no-place phrase", () => {
    expect(isNoPlace("Various Artists Bar")).toBe(false);
    expect(isNoPlace("Multiple Lounge")).toBe(false);
    expect(isNoPlace("Salon Los Angeles")).toBe(false);
    expect(isNoPlace("The Venue")).toBe(false);
    expect(isNoPlace("Bar Various Venues")).toBe(false); // phrase not at start
    expect(isNoPlace("")).toBe(false);
    expect(isNoPlace(null)).toBe(false);
    expect(isNoPlace(undefined)).toBe(false);
  });
});

describe("withoutNoPlaceVenue", () => {
  it("clears name, address, and location when venue name indicates no place", () => {
    const input = makeListing(
      {
        name: "Various venues in Mexico City",
        address: "Multiple neighborhoods, Mexico City, CDMX, Mexico",
        url: "https://salsavida.com/x",
      },
      { lat: 19.4285, lng: -99.1595 },
    );
    const result = withoutNoPlaceVenue(input);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBeNull();
    expect(result.listing.venue.url).toBe("https://salsavida.com/x");
    expect(result.venueLocation).toBeNull();
    expect(result.listing.title).toBe("Somos Casineros en Mexico");
    expect(result.listing.local_date).toBe("2026-11-02");
  });

  it("clears when only address indicates no place", () => {
    const input = makeListing(
      { name: "Salon Los Angeles", address: "Por confirmar", url: null },
      { lat: 19.4285, lng: -99.1595 },
    );
    const result = withoutNoPlaceVenue(input);
    expect(result.listing.venue.name).toBeNull();
    expect(result.listing.venue.address).toBeNull();
    expect(result.venueLocation).toBeNull();
  });

  it("returns unchanged when neither name nor address indicate no place", () => {
    const input = makeListing(
      { name: "Salon Los Angeles", address: "Lerdo 206, Guerrero, CDMX", url: null },
      { lat: 19.4285, lng: -99.1595 },
    );
    const result = withoutNoPlaceVenue(input);
    expect(result).toBe(input);
    expect(result.listing.venue.name).toBe("Salon Los Angeles");
    expect(result.listing.venue.address).toBe("Lerdo 206, Guerrero, CDMX");
    expect(result.venueLocation).toEqual({ lat: 19.4285, lng: -99.1595 });
  });
});
