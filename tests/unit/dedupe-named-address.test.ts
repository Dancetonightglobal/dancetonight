// D-765: daily site check 2026-11-06. London "B&M Presents: Therapy Sessions London" on 11-07 at 11pm came
// from ra.co (venue "Oslo Hackney", "1a Amhurst Road, Hackney, ...") and Skiddle (venue "Oslo Hackney
// London", "1A Amhurst Road, London, ..."): one club, but its two rows were geocoded 171 m apart, past
// SAME_ADDRESS_METRES (25) and ONE_PLACE_METRES (50). Two rows at one street line whose names begin with the
// same telling word are one place within SAME_ADDRESS_NAMED_METRES.
import { describe, expect, it } from "vitest";

import { SAME_ADDRESS_NAMED_METRES } from "@/config/dedupe";
import { onePlace, type DedupeSide } from "@/src/domain/dedupe";

function side(
  id: string,
  venueId: string,
  venueName: string,
  venueAddress: string,
  lat: number,
): DedupeSide {
  return {
    id,
    startsAt: new Date("2026-11-07T23:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    venueName,
    venueAddress,
    venuePoint: { lat, lng: -0.0559 },
  };
}

// 0.00154 degrees of latitude is about 171 m; 0.0036 about 400 m.
const ra = side("ra", "v-oslo", "Oslo Hackney", "1a Amhurst Road, Hackney, London E8 1LL", 51.5476);

describe("onePlace: one street line, one name, geocoded apart (D-765)", () => {
  it("allows a few hundred metres", () => {
    expect(SAME_ADDRESS_NAMED_METRES).toBeGreaterThanOrEqual(200);
    expect(SAME_ADDRESS_NAMED_METRES).toBeLessThanOrEqual(300);
  });

  it("Oslo Hackney and Oslo Hackney London 171 m apart at 1a Amhurst Road are one place", () => {
    const skiddle = side(
      "sk",
      "v-oslo-london",
      "Oslo Hackney London",
      "1A Amhurst Road, London, E8 1LL",
      51.54914,
    );
    expect(onePlace(ra, skiddle)).toBe(true);
    expect(onePlace(skiddle, ra)).toBe(true);
  });

  it("two names at one street line 171 m apart stay two places", () => {
    const other = side("o", "v-other", "Moth Club", "1a Amhurst Road, London, E8 1LL", 51.54914);
    expect(onePlace(ra, other)).toBe(false);
  });

  it("one name at two street lines stays two places", () => {
    const other = side("o", "v-o2", "Oslo Hackney", "12 Mare Street, London E8", 51.54914);
    expect(onePlace(ra, other)).toBe(false);
  });

  it("one name and street line past the limit stays two places", () => {
    const far = side("f", "v-far", "Oslo Hackney", "1A Amhurst Road, London", 51.5512);
    expect(onePlace(ra, far)).toBe(false);
  });

  it("a street line with no house number joins nothing", () => {
    const a = side("a", "v-a", "Oslo Hackney", "Amhurst Road, Hackney", 51.5476);
    const b = side("b", "v-b", "Oslo Hackney London", "Amhurst Road, London", 51.54914);
    expect(onePlace(a, b)).toBe(false);
  });
});
