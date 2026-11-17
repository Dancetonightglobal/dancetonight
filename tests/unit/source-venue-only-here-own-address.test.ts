// D-829: an onlyHere venue page's rows that carry the venue's own street address are placed at the
// source's venue too. The Nashville Palace's Wix rows with location "Nashville Palace, 2611 McGavock Pike"
// made a second venue ("Merry Oaks") beside the seed's "The Nashville Palace" (Haysboro), 2026-11-10.
import { describe, expect, it } from "vitest";
import { rawListingSchema } from "@/src/domain/listing";
import { withVenueRooms } from "@/src/pipeline/source-venue";
import { sameStreetAddress } from "@/src/domain/dedupe";
import type { HarvestedListing } from "@/src/adapters/types";

function makeListing(venue: { name?: string | null; address?: string | null }): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Line Dance Lessons 21+",
    listing_type: "class",
    styles: ["line_dance"],
    local_date: "2026-11-13",
    doors_time: "19:30",
    venue: { name: venue.name ?? null, address: venue.address ?? null, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Chicago",
    venueLocation: null,
    recurrence: null,
    provenance: {
      sourceUrl: "https://www.thefamousnashvillepalace.com/calendar",
      fetchedAt: new Date(),
      method: "feed",
    },
  };
}

const seed = {
  label: "The Nashville Palace",
  venueAddress: "2611 McGavock Pike, Nashville, TN 37214",
  onlyHere: true,
};

describe("withVenueRooms, onlyHere and the venue's own street address (D-829)", () => {
  const placedWithoutAddress = withVenueRooms(makeListing({ name: "Nashville Palace" }), seed);

  it("places a row at the venue's own address like a row with no address", () => {
    const result = withVenueRooms(
      makeListing({ name: "Nashville Palace", address: "2611 McGavock Pike, Nashville, TN 37214" }),
      seed,
    );
    expect(result.listing.venue.name).toBe(placedWithoutAddress.listing.venue.name);
    expect(result.listing.venue.address).toBe(placedWithoutAddress.listing.venue.address);
  });

  it("matches the address written another way (Pk, a country tail)", () => {
    const result = withVenueRooms(
      makeListing({
        name: "Nashville Palace",
        address: "2611 McGavock Pk, Nashville, TN 37214, USA",
      }),
      seed,
    );
    expect(result.listing.venue.name).toBe(placedWithoutAddress.listing.venue.name);
  });

  it("keeps a row at another street address where it is", () => {
    const listing = makeListing({
      name: "Off-site Hall",
      address: "100 Broadway, Nashville, TN 37201",
    });
    const result = withVenueRooms(listing, seed);
    expect(result.listing.venue.name).toBe("Off-site Hall");
    expect(result.listing.venue.address).toBe("100 Broadway, Nashville, TN 37201");
  });

  it("changes nothing without onlyHere", () => {
    const listing = makeListing({
      name: "Nashville Palace",
      address: "2611 McGavock Pike, Nashville, TN 37214",
    });
    const result = withVenueRooms(listing, { ...seed, onlyHere: false });
    expect(result.listing.venue.name).toBe("Nashville Palace");
    expect(result.listing.venue.address).toBe("2611 McGavock Pike, Nashville, TN 37214");
  });

  it("changes nothing when the seed has no venueAddress", () => {
    const listing = makeListing({
      name: "Off-site Hall",
      address: "100 Broadway, Nashville, TN 37201",
    });
    const result = withVenueRooms(listing, { label: "The Nashville Palace", onlyHere: true });
    expect(result.listing.venue.name).toBe("Off-site Hall");
  });
});

describe("sameStreetAddress reads Pk as Pike (D-829)", () => {
  it("is true for McGavock Pk and McGavock Pike", () => {
    expect(
      sameStreetAddress(
        "2611 McGavock Pk, Nashville, TN 37214, USA",
        "2611 McGavock Pike, Nashville, TN 37214",
      ),
    ).toBe(true);
  });
});
