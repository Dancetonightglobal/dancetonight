import { describe, expect, it } from "vitest";
import { onePlace, oneVenueOneStart, scorePair, type DedupeSide } from "@/src/domain/dedupe";

// D-504: one place written as two venue rows. Lisbon read 41125544576: "B.leza, Cais da Ribeira
// Nova, Armazém B, Cais do Sodré, Lisboa" and "B.Leza Clube" at one point (0 m), one start; "Jazzy
// Dance Studios" and "Jazzy Dance Studios, Av. Brasília 254, Santos, Lisboa" 12 m apart. Every
// one-venue-one-start rule needed one venue id, so the pairs were never merged nor reported.

const BLEZA = { lat: 38.7054835, lng: -9.1473475 };

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: new Date("2026-10-30T22:00:00Z"),
  organizerId: null,
  organizerName: null,
  venueId: "v1",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "unofficial",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  ...over,
});

const twoRows = (nameA: string, nameB: string, pointB = BLEZA) => [
  side({ id: "a", venueId: "v1", venueName: nameA, venuePoint: BLEZA }),
  side({ id: "b", venueId: "v2", venueName: nameB, venuePoint: pointB }),
];

describe("onePlace", () => {
  it("one venue id is one place, with or without names and points", () => {
    expect(onePlace(side({ id: "a" }), side({ id: "b" }))).toBe(true);
  });

  it("no venue id on either side is never one place", () => {
    expect(onePlace(side({ id: "a", venueId: null }), side({ id: "b", venueId: null }))).toBe(
      false,
    );
    expect(onePlace(side({ id: "a", venueId: null }), side({ id: "b" }))).toBe(false);
  });

  it("two rows at one point whose names start with one telling word (B.Leza)", () => {
    const [a, b] = twoRows(
      "B.leza, Cais da Ribeira Nova, Armazém B, Cais do Sodré, Lisboa",
      "B.Leza Clube",
    );
    expect(onePlace(a!, b!)).toBe(true);
    expect(onePlace(b!, a!)).toBe(true);
  });

  it("12 m and 40 m apart count (Jazzy, Time Out Market)", () => {
    const [a, b] = twoRows(
      "Jazzy Dance Studios",
      "Jazzy Dance Studios, Av. Brasília 254, Santos, Lisboa",
      {
        lat: 38.7054835 + 0.0001,
        lng: -9.1473475,
      },
    ); // ~11 m north
    expect(onePlace(a!, b!)).toBe(true);
    const [c, d] = twoRows("Time Out Market, Cais do Sodré", "Time Out Market Lisboa", {
      lat: 38.7054835 + 0.00036,
      lng: -9.1473475,
    }); // ~40 m north
    expect(onePlace(c!, d!)).toBe(true);
  });

  it("more than 50 m apart is not one place, whatever the names", () => {
    const [a, b] = twoRows("Jazzy Dance Studios", "Jazzy Dance Studios Estrela", {
      lat: 38.7054835 + 0.0006,
      lng: -9.1473475,
    }); // ~67 m north
    expect(onePlace(a!, b!)).toBe(false);
  });

  it("a missing point or name on either side is not one place", () => {
    const a = side({ id: "a", venueId: "v1", venueName: "B.Leza Clube", venuePoint: BLEZA });
    expect(onePlace(a, side({ id: "b", venueId: "v2", venueName: "B.Leza Clube" }))).toBe(false);
    expect(onePlace(a, side({ id: "b", venueId: "v2", venuePoint: BLEZA }))).toBe(false);
  });

  it("neighbours at one point with different names are two places", () => {
    const [a, b] = twoRows("Pensão Amor", "Musicbox Lisboa");
    expect(onePlace(a!, b!)).toBe(false);
  });

  it("a shared generic first word is not enough: the first telling word must match", () => {
    expect(onePlace(...(twoRows("Bar Alfa", "Bar Beta") as [DedupeSide, DedupeSide]))).toBe(false);
    expect(onePlace(...(twoRows("Club Noir", "Club Rouge") as [DedupeSide, DedupeSide]))).toBe(
      false,
    );
    expect(
      onePlace(...(twoRows("Casa Amarela", "Casa Independente") as [DedupeSide, DedupeSide])),
    ).toBe(false);
    expect(
      onePlace(...(twoRows("The Dance Studio", "Dance Studio Two") as [DedupeSide, DedupeSide])),
    ).toBe(false);
  });

  it("generic words before the telling word must match too, and a leading 'The' is ignored", () => {
    expect(
      onePlace(
        ...(twoRows("Casa Amarela", "Casa Amarela, Laranjeiro") as [DedupeSide, DedupeSide]),
      ),
    ).toBe(true);
    expect(
      onePlace(...(twoRows("The Fillmore", "Fillmore Philadelphia") as [DedupeSide, DedupeSide])),
    ).toBe(true);
    expect(onePlace(...(twoRows("Bar Alfa", "Alfa") as [DedupeSide, DedupeSide]))).toBe(false);
  });
});

describe("oneVenueOneStart uses onePlace (D-504)", () => {
  it("two venue rows of one place, one start -> true", () => {
    const [a, b] = twoRows("B.leza, Cais da Ribeira Nova", "B.Leza Clube");
    expect(oneVenueOneStart(a!, b!)).toBe(true);
  });

  it("still needs both starts within 15 minutes", () => {
    const [a, b] = twoRows("B.leza, Cais da Ribeira Nova", "B.Leza Clube");
    expect(oneVenueOneStart(a!, { ...b!, startsAt: new Date("2026-10-30T23:00:00Z") })).toBe(false);
    expect(oneVenueOneStart(a!, { ...b!, startsAt: null })).toBe(false);
  });

  it("scorePair merges the B.Leza pair through the D-271 words-within rule", () => {
    const [a0, b0] = twoRows("B.leza, Cais da Ribeira Nova", "B.Leza Clube");
    const a = { ...a0!, title: "El Suston: La Tremenda Sonora, Largo da Cumbia" };
    const b = { ...b0!, title: "EL SÚSTON * La Tremenda Sonora * Largo da Cumbia 30/10 B.LEZA" };
    expect(scorePair(a, b, { titleSimilarity: 0.6, organizerSimilarity: null }).decision).toBe(
      "auto_merge",
    );
  });

  it("scorePair does not merge two places' unlike titles", () => {
    const [a0, b0] = twoRows("Pensão Amor", "Musicbox Lisboa");
    const a = { ...a0!, title: "El Suston: La Tremenda Sonora" };
    const b = { ...b0!, title: "EL SÚSTON * La Tremenda Sonora * 30/10" };
    expect(scorePair(a, b, { titleSimilarity: 0.6, organizerSimilarity: null }).decision).not.toBe(
      "auto_merge",
    );
  });
});
