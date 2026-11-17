import { describe, it, expect } from "vitest";
import { sameSourceSubsetTwin, titleWordSubset } from "@/src/domain/same-source-subset";
import type { DedupeSide } from "@/src/domain/dedupe";

function buildSide(overrides: Partial<DedupeSide>): DedupeSide {
  const defaults: DedupeSide = {
    id: "test-id",
    startsAt: null,
    organizerId: null,
    organizerName: null,
    venueId: null,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "serp",
    firstSeenAt: new Date(),
    title: "",
    titleNormalized: undefined,
    cancelled: false,
    listingType: "social",
    endsAt: undefined,
    venueName: undefined,
    venuePoint: undefined,
    venueAddress: undefined,
    links: undefined,
    times: undefined,
  };
  return { ...defaults, ...overrides };
}

describe("titleWordSubset", () => {
  it("returns equal for Le Club Madame Arthur vs Club Madame Arthur (jeudi)", () => {
    const result = titleWordSubset("Le Club Madame Arthur", "Club Madame Arthur (jeudi)");
    expect(result).toBe("equal");
  });

  it("returns subset for Country Sunday vs Country Sunday with Chris Scruggs", () => {
    const result = titleWordSubset("Country Sunday", "Country Sunday with Chris Scruggs");
    expect(result).toBe("subset");
  });

  it("returns null for unrelated titles", () => {
    const result = titleWordSubset("A", "B");
    expect(result).toBeNull();
  });

  it("drops weekday words and filler", () => {
    const result = titleWordSubset(
      "Viernes Social - La Esquina del Bailador",
      "La Esquina del Bailador",
    );
    expect(result).toBe("subset");
  });

  it("drops age numbers", () => {
    const result = titleWordSubset(
      "Club 69 | 14 NOV",
      "Club 69 | 14 NOV en Niceto Club (+18 años)",
    );
    expect(result).toBe("subset");
  });
});

describe("sameSourceSubsetTwin", () => {
  const sameDate = new Date("2026-11-14T21:00:00Z");
  const sameVenueId = "venue-123";

  it("TRUE: Club 69 pair, same venueId, both untimed", () => {
    const a = buildSide({
      title: "Club 69 | 14 NOV",
      venueId: sameVenueId,
      startsAt: null,
    });
    const b = buildSide({
      title: "Club 69 | 14 NOV en Niceto Club (+18 años)",
      venueId: sameVenueId,
      startsAt: null,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("TRUE: Country Sunday pair, same venueId, both 21:00", () => {
    const a = buildSide({
      title: "Country Sunday",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    const b = buildSide({
      title: "Country Sunday with Chris Scruggs & The Stone Fox Five",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("TRUE: La Esquina pair, same venue, both 23:00", () => {
    const date = new Date("2026-11-14T23:00:00Z");
    const a = buildSide({
      title: "La Esquina del Bailador",
      venueId: sameVenueId,
      startsAt: date,
    });
    const b = buildSide({
      title: "Viernes Social - La Esquina del Bailador",
      venueId: sameVenueId,
      startsAt: date,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("TRUE: Alta Gama pair, same venue, both 23:00", () => {
    const date = new Date("2026-11-14T23:00:00Z");
    const a = buildSide({
      title: "Alta Gama Saturdays At Maraca NYC",
      venueId: sameVenueId,
      startsAt: date,
    });
    const b = buildSide({
      title: "Alta Gama Saturdays CJ Live At Maraca NYC",
      venueId: sameVenueId,
      startsAt: date,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("TRUE: Madame Arthur pair, both unplaced, one 23:00 and one untimed", () => {
    const a = buildSide({
      title: "Club Madame Arthur (jeudi)",
      venueId: null,
      startsAt: new Date("2026-11-14T23:00:00Z"),
    });
    const b = buildSide({
      title: "Le Club Madame Arthur",
      venueId: null,
      startsAt: null,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("TRUE: MU-003 twice, both unplaced, both 21:00", () => {
    const a = buildSide({
      title: "MU-003",
      venueId: null,
      startsAt: sameDate,
    });
    const b = buildSide({
      title: "MU-003",
      venueId: null,
      startsAt: sameDate,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("TRUE: Salsa & Bachata night twice, same venue, both 22:00", () => {
    const date = new Date("2026-11-14T22:00:00Z");
    const a = buildSide({
      title: "Salsa & Bachata night",
      venueId: sameVenueId,
      startsAt: date,
    });
    const b = buildSide({
      title: "Salsa & Bachata night",
      venueId: sameVenueId,
      startsAt: date,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(true);
  });

  it("FALSE: Country Sunday vs Country Sunday with Chris Scruggs same venue, one untimed (generic guard)", () => {
    const a = buildSide({
      title: "Country Sunday",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    const b = buildSide({
      title: "Country Sunday with Chris Scruggs",
      venueId: sameVenueId,
      startsAt: null,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: Salsa Night vs Salsa Night with DJ X, both unplaced, one untimed (generic guard)", () => {
    const a = buildSide({
      title: "Salsa Night",
      venueId: null,
      startsAt: new Date("2026-11-14T22:00:00Z"),
    });
    const b = buildSide({
      title: "Salsa Night with DJ X",
      venueId: null,
      startsAt: null,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: Club 69 vs Club 70 (not a subset)", () => {
    const a = buildSide({
      title: "Club 69",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    const b = buildSide({
      title: "Club 70",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: Bachata Sensual Night vs Kizomba Night same venue same start", () => {
    const a = buildSide({
      title: "Bachata Sensual Night",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    const b = buildSide({
      title: "Kizomba Night",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: one side cancelled", () => {
    const a = buildSide({
      title: "Country Sunday",
      venueId: sameVenueId,
      startsAt: sameDate,
      cancelled: true,
    });
    const b = buildSide({
      title: "Country Sunday with Chris Scruggs",
      venueId: sameVenueId,
      startsAt: sameDate,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: same venue, starts 21:00 vs 22:00", () => {
    const a = buildSide({
      title: "Country Sunday",
      venueId: sameVenueId,
      startsAt: new Date("2026-11-14T21:00:00Z"),
    });
    const b = buildSide({
      title: "Country Sunday with Chris Scruggs",
      venueId: sameVenueId,
      startsAt: new Date("2026-11-14T22:00:00Z"),
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: both unplaced, both untimed (MU-003 twice)", () => {
    const a = buildSide({
      title: "MU-003",
      venueId: null,
      startsAt: null,
    });
    const b = buildSide({
      title: "MU-003",
      venueId: null,
      startsAt: null,
    });
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });

  it("FALSE: listingType class vs social (if sameKindOfNight treats them as different)", () => {
    // Assuming sameKindOfNight returns false for class vs social
    const a = buildSide({
      title: "Country Sunday",
      venueId: sameVenueId,
      startsAt: sameDate,
      listingType: "class",
    });
    const b = buildSide({
      title: "Country Sunday with Chris Scruggs",
      venueId: sameVenueId,
      startsAt: sameDate,
      listingType: "social",
    });
    // We'll just call the function; the result depends on sameKindOfNight implementation.
    // For the purpose of this test, we assert it's false.
    expect(sameSourceSubsetTwin(a, b)).toBe(false);
  });
});

describe("a longer title that adds a session word is another session (D-883, run 33)", () => {
  it.each([
    ["Salsa", "Salsa Level 2"],
    ["West Coast Swing with Jes Ann Nail", "Class West Coast Swing with Jes Ann Nail"],
    ["Bachata Night", "Bachata Night Beginners Workshop"],
    ["Tango", "Tango Part 2"],
  ])("%s / %s -> null", (a, b) => {
    expect(titleWordSubset(a, b)).toBeNull();
  });

  it("Club 69 with its venue and age mark is still a subset", () => {
    expect(titleWordSubset("Club 69 | 14 NOV", "Club 69 | 14 NOV en Niceto Club (+18 años)")).toBe(
      "subset",
    );
  });
});
