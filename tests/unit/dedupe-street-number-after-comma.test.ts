import { describe, expect, it } from "vitest";

import { onePlace, sameStreetAddress, type DedupeSide } from "@/src/domain/dedupe";
import { oneTitleStartsApart } from "@/src/domain/title-starts-apart";

function side(
  id: string,
  venueId: string,
  venueName: string,
  venueAddress: string,
  lat: number,
  startsAt: string,
): DedupeSide {
  return {
    id,
    title: "Simulacro Colectivo x Mandrágora",
    titleNormalized: "simulacro colectivo x mandragora",
    listingType: "party",
    startsAt: new Date(startsAt),
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-04T00:00:00Z"),
    venueName,
    venueAddress,
    venuePoint: { lat, lng: 2.1347 },
  };
}

// The prod rows (2026-11-10): 0.00252 degrees of latitude is about 280 m.
const ra = side(
  "ra",
  "v-2a9b3645",
  "Sala Upload",
  "Av. Francesc Ferrer i Guàrdia, 13, 08038 Barcelona",
  41.37,
  "2026-11-13T19:00:00Z",
);
const dice = side(
  "dice",
  "v-6ed500af",
  "Sala Upload Barcelona",
  "Av. de Francesc Ferrer i Guàrdia, 13, Barcelona, 08038",
  41.37252,
  "2026-11-13T18:00:00Z",
);

describe("Sala Upload: one place, one night (D-841)", () => {
  it("the two venue rows 280 m apart are one place", () => {
    expect(onePlace(ra, dice)).toBe(true);
    expect(onePlace(dice, ra)).toBe(true);
  });

  it("RA 8pm and DICE 7pm of one title there are one night (D-769)", () => {
    expect(oneTitleStartsApart(ra, dice)).toBe(true);
  });
});

// D-841: Spanish and Catalan addresses put the house number after a comma ("Av. Francesc Ferrer i Guàrdia, 13"),
// and one source writes "Av. de ..." where the other writes "Av. ...": two Sala Upload rows were two places, so
// RA 8pm and DICE 7pm "Simulacro Colectivo x Mandrágora" were two cards (Barcelona, daily 2026-11-10, C).

describe("sameStreetAddress: number after the comma, connective words", () => {
  it("joins a bare house number after the comma to the street", () => {
    expect(
      sameStreetAddress(
        "Av. Francesc Ferrer i Guàrdia, 13, 08038 Barcelona",
        "Av. de Francesc Ferrer i Guàrdia, 13, Barcelona, 08038",
      ),
    ).toBe(true);
    expect(
      sameStreetAddress("Carrer de Pujades, 12, Barcelona", "Carrer Pujades, 12, 08005 Barcelona"),
    ).toBe(true);
    expect(sameStreetAddress("Calle del Pez, 3, Madrid", "Calle Pez, 3, 28004 Madrid")).toBe(true);
  });

  it("still tells apart different numbers or streets", () => {
    expect(
      sameStreetAddress(
        "Av. Francesc Ferrer i Guàrdia, 13, Barcelona",
        "Av. Francesc Ferrer i Guàrdia, 15, Barcelona",
      ),
    ).toBe(false);
    expect(
      sameStreetAddress("Carrer de Pujades, 12, Barcelona", "Carrer de Pallars, 12, Barcelona"),
    ).toBe(false);
  });

  it("still needs a house number", () => {
    expect(
      sameStreetAddress(
        "Av. Francesc Ferrer i Guàrdia, Barcelona",
        "Av. Francesc Ferrer i Guàrdia, Barcelona",
      ),
    ).toBe(false);
    // A postcode after the comma is not a house number.
    expect(
      sameStreetAddress("Carrer de Pujades, 08005 Barcelona", "Carrer Pujades, 08005 Barcelona"),
    ).toBe(false);
  });

  it("keeps the number-first forms working", () => {
    expect(
      sameStreetAddress(
        "2826 Steinway St, Astoria, NY 11103",
        "2826 Steinway St, Astoria, NY, 11103-3332",
      ),
    ).toBe(true);
    expect(sameStreetAddress("49 Ridley Rd, London E8 2NP", "49 Ridley Road; London E8 2NP")).toBe(
      true,
    );
  });
});
