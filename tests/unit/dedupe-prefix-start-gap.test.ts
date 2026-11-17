import { describe, expect, it } from "vitest";
import { sameNight, scorePair, type DedupeSide, type PairFacts } from "@/src/domain/dedupe";

// D-515: one weekly night at one venue, listed by two sources whose starts differ by up to 90 minutes, one title a
// whole-word prefix of the other, is one night (San Juan, read 41181147537): Viajando y Bailando's "Sábado
// Bailables" 8pm and Salsa Vida's "Sábado Bailables at Música Bar & Lounge" 9pm-2am; Viajando's "Sounds of Puerto
// Rico Saturdays @ El San Juan Hotel" 8pm and Salsa Vida's "Sounds of Puerto Rico Saturdays" 7pm-2am.

const at = (hhmm: string, day = "2026-10-31") => new Date(`${day}T${hhmm}:00-04:00`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("20:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-musica",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "social",
  endsAt: null,
  ...over,
});

// The trigram similarity of the two titles is well under the 0.9 same-night bar; the prefix rule holds.
const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.45,
  organizerSimilarity: null,
  titlePrefix: true,
  sameSource: false,
  ...over,
});

describe("prefix title, one venue, two sources, starts up to 90 minutes apart (D-515)", () => {
  it("Música Bar: Viajando 8pm (no end) and Salsa Vida 9pm-2am are one night", () => {
    const viajando = side({ id: "viajando", title: "Sábado Bailables", startsAt: at("20:00") });
    const salsaVida = side({
      id: "salsavida",
      title: "Sábado Bailables at Música Bar & Lounge",
      startsAt: at("21:00"),
      endsAt: at("02:00", "2026-11-01"),
    });
    expect(sameNight(viajando, salsaVida, facts())).toBe(true);
    expect(scorePair(viajando, salsaVida, facts()).decision).toBe("auto_merge");
  });

  it("Fairmont: Viajando 8pm (no end) and Salsa Vida 7pm-2am are one night", () => {
    const viajando = side({
      id: "viajando",
      venueId: "v-fairmont",
      title: "Sounds of Puerto Rico Saturdays @ El San Juan Hotel",
      startsAt: at("20:00"),
    });
    const salsaVida = side({
      id: "salsavida",
      venueId: "v-fairmont",
      title: "Sounds of Puerto Rico Saturdays",
      startsAt: at("19:00"),
      endsAt: at("02:00", "2026-11-01"),
    });
    expect(scorePair(viajando, salsaVida, facts()).decision).toBe("auto_merge");
  });

  it("exactly 90 minutes apart still merges", () => {
    const a = side({ id: "a", startsAt: at("20:00") });
    const b = side({ id: "b", startsAt: at("21:30") });
    expect(sameNight(a, b, facts())).toBe(true);
  });

  it("one source's two listings do not merge this way", () => {
    const a = side({ id: "a", startsAt: at("20:00") });
    const b = side({ id: "b", startsAt: at("21:00") });
    expect(sameNight(a, b, facts({ sameSource: true }))).toBe(false);
    expect(scorePair(a, b, facts({ sameSource: true })).decision).not.toBe("auto_merge");
  });

  it("unknown source sameness keeps the 15-minute rule", () => {
    const a = side({ id: "a", startsAt: at("20:00") });
    const b = side({ id: "b", startsAt: at("21:00") });
    expect(sameNight(a, b, facts({ sameSource: undefined }))).toBe(false);
  });

  it("a class at 8pm and a social at 9pm with a prefix title do not merge", () => {
    const cls = side({
      id: "cls",
      title: "Sábado Bailables",
      listingType: "class",
      startsAt: at("20:00"),
    });
    const social = side({
      id: "soc",
      title: "Sábado Bailables at Música Bar & Lounge",
      listingType: "social",
      startsAt: at("21:00"),
    });
    expect(sameNight(cls, social, facts())).toBe(false);
    expect(scorePair(cls, social, facts()).decision).not.toBe("auto_merge");
  });

  it("a class at 7pm and an untyped listing at 8pm with a prefix title do not merge", () => {
    const cls = side({
      id: "cls",
      title: "English - Tuesdays",
      listingType: "class",
      startsAt: at("19:00"),
    });
    const other = side({
      id: "oth",
      title: "English - Tuesdays Playford",
      listingType: "other",
      startsAt: at("20:00"),
    });
    expect(sameNight(cls, other, facts())).toBe(false);
    expect(scorePair(cls, other, facts()).decision).not.toBe("auto_merge");
  });

  it("starts 2 hours apart do not merge", () => {
    const a = side({ id: "a", startsAt: at("19:00") });
    const b = side({ id: "b", startsAt: at("21:00") });
    expect(sameNight(a, b, facts())).toBe(false);
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("listed ends 3 hours apart do not merge", () => {
    const a = side({ id: "a", startsAt: at("20:00"), endsAt: at("23:00") });
    const b = side({ id: "b", startsAt: at("21:00"), endsAt: at("02:00", "2026-11-01") });
    expect(sameNight(a, b, facts())).toBe(false);
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("different venues do not merge", () => {
    const a = side({ id: "a", venueId: "v1", startsAt: at("20:00") });
    const b = side({ id: "b", venueId: "v2", startsAt: at("21:00") });
    expect(sameNight(a, b, facts())).toBe(false);
  });

  it("no venue on either side does not merge", () => {
    const a = side({ id: "a", venueId: null, startsAt: at("20:00") });
    const b = side({ id: "b", venueId: null, startsAt: at("21:00") });
    expect(sameNight(a, b, facts())).toBe(false);
  });

  it("similar titles that are not a prefix keep the 15-minute rule", () => {
    const a = side({ id: "a", startsAt: at("20:00") });
    const b = side({ id: "b", startsAt: at("21:00") });
    expect(sameNight(a, b, facts({ titlePrefix: false }))).toBe(false);
  });
});
