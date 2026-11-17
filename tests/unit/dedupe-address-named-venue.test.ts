// D-790: daily site check 2026-11-07, London. "CLUB MIX" at a venue row named by its own street address
// ("49 Ridley Rd, London E8 2NP", ridleyroadmarketbar.com, 20:00) and "Club Mix till 4am!" at Ridley Road
// Market Bar ("49 Ridley Road; London E8 2NP", DICE, 18:00), 63 m apart: two cards for one night.
// A venue row whose name is the other row's street address is one place within SAME_ADDRESS_NAMED_METRES;
// a ";" ends the street line like a ","; and a closing-time tail ("till 4am") does not make a title differ.
import { describe, expect, it } from "vitest";

import { onePlace, sameStreetAddress, type DedupeSide } from "@/src/domain/dedupe";
import { oneTitleStartsApart, withoutClosingTime } from "@/src/domain/title-starts-apart";

function side(overrides: Partial<DedupeSide>): DedupeSide {
  return {
    id: "x",
    startsAt: new Date("2026-11-07T20:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId: "v-x",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    listingType: "club_night",
    endsAt: null,
    cancelled: false,
    ...overrides,
  };
}

// 0.00057 degrees of latitude is about 63 m; 0.0036 about 400 m.
const site = side({
  id: "site",
  venueId: "v-49",
  venueName: "49 Ridley Rd, London E8 2NP",
  venueAddress: "49 Ridley Rd, London E8 2NP",
  venuePoint: { lat: 51.549, lng: -0.075 },
  title: "CLUB MIX",
  titleNormalized: "club mix",
});
const dice = side({
  id: "dice",
  venueId: "v-rrmb",
  venueName: "Ridley Road Market Bar",
  venueAddress: "49 Ridley Road; London E8 2NP",
  venuePoint: { lat: 51.54957, lng: -0.075 },
  startsAt: new Date("2026-11-07T18:00:00Z"),
  title: "Club Mix till 4am!",
  titleNormalized: "club mix till 4am",
});

describe("sameStreetAddress: a semicolon ends the street line (D-790)", () => {
  it("49 Ridley Rd, ... and 49 Ridley Road; ... are one street address", () => {
    expect(sameStreetAddress("49 Ridley Rd, London E8 2NP", "49 Ridley Road; London E8 2NP")).toBe(
      true,
    );
  });
  it("another house number on the same street is not", () => {
    expect(sameStreetAddress("51 Ridley Rd, London E8 2NP", "49 Ridley Road; London E8 2NP")).toBe(
      false,
    );
  });
});

describe("onePlace: a venue row named by the other's street address (D-790)", () => {
  it("49 Ridley Rd and Ridley Road Market Bar 63 m apart are one place (both orders)", () => {
    expect(onePlace(site, dice)).toBe(true);
    expect(onePlace(dice, site)).toBe(true);
  });
  it("still one place with no stored address on the address-named row", () => {
    expect(onePlace({ ...site, venueAddress: undefined }, dice)).toBe(true);
  });
  it("not past SAME_ADDRESS_NAMED_METRES (400 m)", () => {
    expect(onePlace(site, { ...dice, venuePoint: { lat: 51.5526, lng: -0.075 } })).toBe(false);
  });
  it("not when the name is another house number", () => {
    expect(
      onePlace(
        { ...site, venueName: "51 Ridley Rd, London E8 2NP", venueAddress: undefined },
        dice,
      ),
    ).toBe(false);
  });
  it("a named venue at another address is not made one place by a street-address name elsewhere", () => {
    const other = {
      ...dice,
      venueName: "Dalston Superstore",
      venueAddress: "117 Kingsland High St, London E8 2PB",
    };
    expect(onePlace(site, other)).toBe(false);
  });
});

describe("withoutClosingTime (D-790)", () => {
  it.each([
    ["club mix till 4am", "club mix"],
    ["club mix till 4 am", "club mix"],
    ["salsa night until late", "salsa night"],
    ["bachata til 2 30am", "bachata"],
    ["kizomba till close", "kizomba"],
    ["club mix", "club mix"],
    ["till dawn", "till dawn"],
    ["dance till you drop", "dance till you drop"],
  ])("%s -> %s", (input, out) => {
    expect(withoutClosingTime(input)).toBe(out);
  });
});

describe("oneTitleStartsApart: a closing-time tail is the same title (D-790)", () => {
  it("CLUB MIX at 20:00 and Club Mix till 4am! at 18:00 are one night (both orders)", () => {
    expect(oneTitleStartsApart(site, dice)).toBe(true);
    expect(oneTitleStartsApart(dice, site)).toBe(true);
  });
  it("a generic title with a tail stays apart (Salsa vs Salsa till late)", () => {
    const a = { ...site, venueId: "v-49", title: "Salsa", titleNormalized: "salsa" };
    const b = {
      ...dice,
      venueId: "v-49",
      title: "Salsa till late",
      titleNormalized: "salsa till late",
    };
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });
  it("other words after the shared title still differ", () => {
    const b = { ...dice, title: "Club Mix Afterparty", titleNormalized: "club mix afterparty" };
    expect(oneTitleStartsApart(site, b)).toBe(false);
  });
});
