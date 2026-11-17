// D-904: TangoDANS area-only addresses take the checked venue when the area matches.
import { describe, expect, it } from "vitest";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import { KNOWN_VENUES } from "@/config/known-venues";
import { rawListingSchema } from "@/src/domain/listing";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(
  title: string,
  venue: { name?: string | null; address?: string | null },
  venueLocation?: { lat: number; lng: number } | null,
): HarvestedListing {
  const raw = rawListingSchema.parse({
    title,
    listing_type: "social",
    styles: ["tango"],
    local_date: "2026-10-11",
    doors_time: "20:00",
    venue: {
      name: venue.name ?? null,
      address: venue.address ?? null,
      url: null,
    },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/Istanbul",
    venueLocation: venueLocation ?? null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://tangodans.com",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

describe("withKnownVenue for TangoDANS area-only addresses", () => {
  const istanbulVenues = KNOWN_VENUES.istanbul;

  // Helper to find entry by first name
  function findEntry(firstName: string) {
    const entry = istanbulVenues?.find((v) => v.names[0] === firstName);
    if (!entry) throw new Error(`Entry not found: ${firstName}`);
    return entry;
  }

  it("Tango Mia Milonga with Taksim / İstanbul takes Tango Mia address and point", () => {
    const listing = makeListing("Tango Mia", {
      name: "Tango Mia Milonga",
      address: "Taksim / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    const entry = findEntry("Tango Mia");
    // Name is kept as written (not canonical), but address and point are updated
    expect(result.listing.venue.name).toBe("Tango Mia Milonga");
    expect(result.listing.venue.address).toBe(entry.address);
    expect(result.venueLocation).toEqual({ lat: 41.0341764, lng: 28.9775777 });
  });

  it("Milonga 333 with Taksim / İstanbul takes 333 Milonga address and point", () => {
    const listing = makeListing("333 Milonga", {
      name: "Milonga 333",
      address: "Taksim / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    const entry = findEntry("333 Milonga");
    // Name is kept as written (not canonical), but address and point are updated
    expect(result.listing.venue.name).toBe("Milonga 333");
    expect(result.listing.venue.address).toBe(entry.address);
    expect(result.venueLocation).toEqual(entry.point);
  });

  it("Milonga Tormenta with Kadıköy / İstanbul takes Tormenta address and point", () => {
    const listing = makeListing("Milonga Tormenta", {
      name: "Milonga Tormenta",
      address: "Kadıköy / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    const entry = findEntry("Milonga Tormenta");
    expect(result.listing.venue.name).toBe("Milonga Tormenta");
    expect(result.listing.venue.address).toBe(entry.address);
    expect(result.venueLocation).toEqual(entry.point);
  });

  it("Zeytuna Tango Milongası with Beyoğlu / İstanbul takes Zeytuna address and point", () => {
    const listing = makeListing("Zeytuna", {
      name: "Zeytuna Tango Milongası",
      address: "Beyoğlu / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    const entry = findEntry("Zeytuna Cezayir'de");
    // Name is kept as written (not canonical), but address and point are updated
    expect(result.listing.venue.name).toBe("Zeytuna Tango Milongası");
    expect(result.listing.venue.address).toBe(entry.address);
    expect(result.venueLocation).toEqual(entry.point);
  });

  it("Milongahane with Beşiktaş / İstanbul takes Bora Erdem address and point", () => {
    const listing = makeListing("Milongahane", {
      name: "Milongahane / Bora Erdem Dans Cafe",
      address: "Beşiktaş / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    const entry = findEntry("Bora Erdem Dans Cafe");
    // Name is kept as written (not canonical), but address and point are updated
    expect(result.listing.venue.name).toBe("Milongahane / Bora Erdem Dans Cafe");
    expect(result.listing.venue.address).toBe(entry.address);
    expect(result.venueLocation).toEqual(entry.point);
  });

  it("Tangoist Stüdyo with Taksim / İstanbul takes Tangoist address and point", () => {
    const listing = makeListing("Tangoist", {
      name: "Tangoist Stüdyo Milongası",
      address: "Taksim / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    const entry = findEntry("Tangoist");
    // Name is kept as written (not canonical), but address and point are updated
    expect(result.listing.venue.name).toBe("Tangoist Stüdyo Milongası");
    expect(result.listing.venue.address).toBe(entry.address);
    expect(result.venueLocation).toEqual(entry.point);
  });

  it("Milonga Tormenta with wrong area Taksim / İstanbul keeps the vague address", () => {
    const listing = makeListing("Milonga Tormenta", {
      name: "Milonga Tormenta",
      address: "Taksim / İstanbul",
    });
    const result = withKnownVenue(listing, istanbulVenues, "TR");
    // Should NOT match because the area is wrong
    expect(result.listing.venue.name).toBe("Milonga Tormenta");
    expect(result.listing.venue.address).toBe("Taksim / İstanbul");
    expect(result.venueLocation).toBeNull();
  });
});
