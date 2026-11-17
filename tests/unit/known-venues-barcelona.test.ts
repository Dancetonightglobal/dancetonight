// Barcelona's known venues against the addresses their sources really write.
import { describe, expect, it } from "vitest";

import { KNOWN_VENUES } from "@/config/known-venues";
import type { HarvestedListing } from "@/src/adapters/types";
import { rawListingSchema } from "@/src/domain/listing";
import { withKnownVenue } from "@/src/pipeline/source-venue";

function listingNamed(name: string): HarvestedListing {
  const raw = rawListingSchema.parse({
    title: "Test Event",
    listing_type: "social",
    styles: ["club"],
    local_date: "2026-10-30",
    doors_time: "20:00",
    venue: { name, address: null, url: null },
    organizer: { name: null, url: null },
  });
  return {
    listing: raw,
    externalId: "test:1",
    tz: "Europe/Madrid",
    venueLocation: null,
    recurrence: null,
    provenance: { sourceUrl: "https://dice.fm/" },
  } as unknown as HarvestedListing;
}

describe("Barcelona known venues", () => {
  it.each([
    ["Sala Upload", "Avinguda de Francesc Ferrer i Guàrdia 13, 08038 Barcelona"],
    ["Paral·lel 62", "Avinguda del Paral·lel 62, 08001 Barcelona"],
    ["Village Underground Barcelona", "Carrer del Cobalt 12, 08907 L'Hospitalet de Llobregat"],
    ["Ocaña", "Plaça Reial 13-15, 08002 Barcelona"],
    ["Four Corners", "Avinguda Diagonal 205, 08018 Barcelona"],
    ["Moog", "Carrer de l'Arc del Teatre 3, 08002 Barcelona"],
    ["Sala Vivaldi", "Carrer de Llança 5, 08015 Barcelona"],
    ["Safestay Rooftop", "Passeig de Gràcia 33, 08007 Barcelona"],
    ["Puerto Bahia Club de Mar", "Passeig del Mare Nostrum 61, 08918 Badalona"],
  ])("places %s at its known address", (name, expectedAddress) => {
    const result = withKnownVenue(listingNamed(name), KNOWN_VENUES.barcelona ?? [], "ES");
    expect(result.listing.venue.address).toBe(expectedAddress);
  });

  it("puts Village Underground Barcelona at its checked point, inside the metro's L'Hospitalet", () => {
    const entry = (KNOWN_VENUES.barcelona ?? []).find((v) =>
      v.names.includes("Village Underground Barcelona"),
    );
    expect(entry?.point).toEqual({ lat: 41.35916, lng: 2.11089 });
  });
});
