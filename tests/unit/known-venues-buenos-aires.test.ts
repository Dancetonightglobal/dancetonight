// Buenos Aires' known venues carry hand-checked points (D-260): the geocoder gave no building-level answer
// for Club Gricel, El Beso or Crobar in the full read of 2026-10-29.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listingAt(name: string, address: string | null): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Milonga",
    listing_type: "social",
    styles: ["tango"],
    local_date: "2026-10-30",
    doors_time: "21:00",
    venue: { name, address, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "America/Argentina/Buenos_Aires",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://clubgricel.com.ar/programacion/" },
  } as unknown as HarvestedListing;
}

const known = KNOWN_VENUES["buenos-aires"] ?? [];

describe("Buenos Aires known venues", () => {
  it.each([
    ["Club Gricel", null, -34.6238507, -58.4070502],
    ["Club Gricel", "La Rioja 1180, CABA", -34.6238507, -58.4070502],
    ["El Beso", null, -34.6041407, -58.39399],
    ["Cachirulo (El Beso)", "Riobamba 416, CABA", -34.6041407, -58.39399],
    ["Crobar", null, -34.5692392, -58.420215],
    ["Crobar", "Buenos Aires, AR", -34.5692392, -58.420215],
    ["Crobar Studio", "Buenos Aires, AR", -34.5692392, -58.420215],
  ])("places %s (address %s) at its checked point", (name, address, lat, lng) => {
    const result = withKnownVenue(listingAt(name, address), known, "AR");
    expect(result.venueLocation).toEqual({ lat, lng });
  });

  it("gives Crobar its checked address", () => {
    const result = withKnownVenue(listingAt("Crobar", null), known, "AR");
    expect(result.listing.venue.address).toBe(
      "Av. Marcelino Freyre s/n, Paseo de la Infanta, Palermo, Buenos Aires",
    );
  });

  it("gives Crobar's town-only JSON-LD address the checked address", () => {
    const result = withKnownVenue(listingAt("Crobar", "Buenos Aires, AR"), known, "AR");
    expect(result.listing.venue.address).toBe(
      "Av. Marcelino Freyre s/n, Paseo de la Infanta, Palermo, Buenos Aires",
    );
  });
});
