import { describe, expect, it } from "vitest";
import { onePlace, scorePair, sameStreetAddress, type DedupeSide } from "@/src/domain/dedupe";

// D-591: one place written as two venue rows whose names share no first telling word. Buenos Aires,
// 2026-11-04: "Salsa Arriba - 04/10/26" (quehacemos, venue "La Paz Arriba") and "Salsa Arriba - Salsa
// Arriba" (dancetomic, venue "Salsa Arriba"), one start, one point (0 m), one address "Av. Callao
// 1082". D-504's name rule ("paz" vs "salsa") kept them apart. Two rows within SAME_ADDRESS_METRES
// (25 m) with one street address (a house number in its first part) are one place.

const CALLAO = { lat: -34.5968, lng: -58.3929 };
const ADDR = "Av. Callao 1082, C1023AAQ CABA, Argentina";

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: new Date("2026-11-04T22:30:00Z"),
  organizerId: null,
  organizerName: null,
  venueId: "v1",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "unofficial",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  ...over,
});

/** A point `m` metres north of CALLAO. */
const north = (m: number) => ({ lat: CALLAO.lat + m / 111_320, lng: CALLAO.lng });

const pair = (
  addrA: string | undefined,
  addrB: string | undefined,
  pointB = CALLAO,
  names: [string, string] = ["La Paz Arriba", "Salsa Arriba"],
): [DedupeSide, DedupeSide] => [
  side({ id: "a", venueId: "v1", venueName: names[0], venuePoint: CALLAO, venueAddress: addrA }),
  side({ id: "b", venueId: "v2", venueName: names[1], venuePoint: pointB, venueAddress: addrB }),
];

describe("sameStreetAddress", () => {
  it("one address written alike is one street address", () => {
    expect(sameStreetAddress(ADDR, ADDR)).toBe(true);
  });

  it("ignores case, accents, punctuation and spacing", () => {
    expect(sameStreetAddress(ADDR, "av callao 1082 ,  c1023aaq caba,  ARGENTINA")).toBe(true);
    expect(sameStreetAddress("Rua da Alegria 12, Lisboa", "Rua da Alegría 12 - Lisboa")).toBe(true);
  });

  it("different house numbers or streets are different addresses", () => {
    expect(sameStreetAddress(ADDR, "Av. Callao 1084, C1023AAQ CABA, Argentina")).toBe(false);
    expect(sameStreetAddress(ADDR, "Av. Corrientes 1082, C1023AAQ CABA, Argentina")).toBe(false);
  });

  it("an address with no house number in its first part is no street address", () => {
    // A city or street centroid: many venues share it.
    expect(sameStreetAddress("Buenos Aires, Argentina", "Buenos Aires, Argentina")).toBe(false);
    expect(sameStreetAddress("Av. Callao, Buenos Aires", "Av. Callao, Buenos Aires")).toBe(false);
    expect(sameStreetAddress("London EC1V 9NH, UK", "London EC1V 9NH, UK")).toBe(false);
  });

  it("missing or blank addresses are never one", () => {
    expect(sameStreetAddress(undefined, ADDR)).toBe(false);
    expect(sameStreetAddress(ADDR, undefined)).toBe(false);
    expect(sameStreetAddress("", "")).toBe(false);
    expect(sameStreetAddress("  ", "  ")).toBe(false);
  });
});

describe("onePlace: one street address (D-591)", () => {
  it("two venue rows at one address and one point are one place, names unalike", () => {
    const [a, b] = pair(ADDR, ADDR);
    expect(onePlace(a, b)).toBe(true);
    expect(onePlace(b, a)).toBe(true);
  });

  it("one address written differently is still one place", () => {
    const [a, b] = pair(ADDR, "av callao 1082, c1023aaq caba, argentina", north(10));
    expect(onePlace(a, b)).toBe(true);
  });

  it("one address up to 25 m apart is one place; farther is not", () => {
    expect(onePlace(...pair(ADDR, ADDR, north(20)))).toBe(true);
    expect(onePlace(...pair(ADDR, ADDR, north(40)))).toBe(false);
  });

  it("different addresses close together with unalike names stay two places", () => {
    const [a, b] = pair(ADDR, "Av. Callao 1090, C1023AAQ CABA, Argentina", north(5));
    expect(onePlace(a, b)).toBe(false);
  });

  it("a centroid address shared by two rows is not one place", () => {
    const [a, b] = pair("Buenos Aires, Argentina", "Buenos Aires, Argentina");
    expect(onePlace(a, b)).toBe(false);
  });

  it("one side without an address falls back to the name rule", () => {
    expect(onePlace(...pair(ADDR, undefined))).toBe(false);
    // D-504 still holds without addresses.
    const [a, b] = pair(undefined, undefined, CALLAO, ["B.leza", "B.Leza Clube"]);
    expect(onePlace(a, b)).toBe(true);
  });

  it("no point on a side is never one place by address", () => {
    const a = side({ id: "a", venueId: "v1", venueName: "La Paz Arriba", venueAddress: ADDR });
    const b = side({
      id: "b",
      venueId: "v2",
      venueName: "Salsa Arriba",
      venuePoint: CALLAO,
      venueAddress: ADDR,
    });
    expect(onePlace(a, b)).toBe(false);
  });

  it("no venue id is never one place", () => {
    const [a, b] = pair(ADDR, ADDR);
    expect(onePlace({ ...a, venueId: null }, b)).toBe(false);
  });
});

describe("scorePair: the Salsa Arriba pair (D-591)", () => {
  it("merges the two sources' copies at one address and one start", () => {
    const [a0, b0] = pair(ADDR, ADDR);
    const a = { ...a0, title: "Salsa Arriba - 04/10/26" };
    const b = { ...b0, title: "Salsa Arriba - Salsa Arriba" };
    expect(
      scorePair(a, b, { titleSimilarity: 0.45, organizerSimilarity: null, sameSource: false })
        .decision,
    ).toBe("auto_merge");
  });

  it("without one address the stored titles are not merged", () => {
    const [a0, b0] = pair(ADDR, "Av. Callao 1090, C1023AAQ CABA, Argentina");
    const a = { ...a0, title: "Salsa Arriba - 04/10/26" };
    const b = { ...b0, title: "Salsa Arriba - Salsa Arriba" };
    expect(
      scorePair(a, b, { titleSimilarity: 0.45, organizerSimilarity: null, sameSource: false })
        .decision,
    ).not.toBe("auto_merge");
  });
});
