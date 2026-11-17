import { describe, expect, it } from "vitest";
import {
  differentLevels,
  scorePair,
  sharedTitleStems,
  type DedupeSide,
  type PairFacts,
} from "@/src/domain/dedupe";

const at = (hhmm: string, day = "2026-10-31") => new Date(`${day}T${hhmm}:00+03:00`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: at("21:00"),
  organizerId: null,
  organizerName: null,
  venueId: "v-highbar",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "dj_night",
  endsAt: null,
  venueName: "High Bar New York",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.2,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

describe("sharedTitleStems", () => {
  it("counts shared distinctive stems", () => {
    const a = "HALLOWEEN HAUNTED ROOFTOP PARTY - Latin & Reggaeton Party";
    const b = "HALLOWEEN HAUNTING. ON THE ROOF - Rooftop Latin & Reggaeton Dance Party @Highbar";
    // "hallo" (halloween), "haunt" (haunted/haunting) - both length >=4, not generic, not ignored
    // "reggaeton" is in SHARED_STEM_IGNORE_WORDS, so excluded
    expect(sharedTitleStems(a, b, "High Bar New York")).toBe(2);
  });

  it("ignores venue name words", () => {
    const a = "Ammos Night Party";
    const b = "Ammos Lounge Takeover";
    // "ammos" is venue word, "night" and "lounge" are ignored words, "party" ignored
    // "takeover" length >=4, not generic, not ignored -> stem "takeo"
    // Only "takeover" in second title, none in first -> 0
    expect(sharedTitleStems(a, b, "Ammos Estiatorio")).toBe(0);
  });

  it("handles accents and punctuation", () => {
    const a = "Fiesta Caliente";
    const b = "fiésta calíente";
    // "fiesta" -> "fiest", "caliente" -> "calie" (first 5)
    expect(sharedTitleStems(a, b, undefined)).toBe(2);
  });

  it("drops short words (<4)", () => {
    const a = "Salsa Halloween";
    const b = "Halloween Bachata";
    // "salsa" generic, "bachata" generic, "halloween" -> "hallo" (not generic, not ignored)
    expect(sharedTitleStems(a, b, undefined)).toBe(1);
  });

  it("drops ignored words", () => {
    const a = "Special Dance Party";
    const b = "Official Dance Night";
    // "special", "official", "dance", "party", "night" all ignored
    expect(sharedTitleStems(a, b, undefined)).toBe(0);
  });
});

describe("D-549: one venue, one start, two sources, two shared stems", () => {
  it("High Bar pair (Eventbrite vs tickeri) -> auto_merge", () => {
    const a = side({
      id: "eb",
      title: "HALLOWEEN HAUNTED ROOFTOP PARTY - Latin & Reggaeton Party",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    const b = side({
      id: "tickeri",
      title: "HALLOWEEN HAUNTING. ON THE ROOF - Rooftop Latin & Reggaeton Dance Party @Highbar",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it("High Bar pair (Eventbrite vs RA) -> auto_merge", () => {
    const a = side({
      id: "eb",
      title: "HALLOWEEN HAUNTED ROOFTOP PARTY - Latin & Reggaeton Party",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    const b = side({
      id: "ra",
      title: "The Haunting on the Roof - Halloween Rooftop #1 Skyline Views NYC",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it("High Bar pair (tickeri vs RA) -> auto_merge", () => {
    const a = side({
      id: "tickeri",
      title: "HALLOWEEN HAUNTING. ON THE ROOF - Rooftop Latin & Reggaeton Dance Party @Highbar",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    const b = side({
      id: "ra",
      title: "The Haunting on the Roof - Halloween Rooftop #1 Skyline Views NYC",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it.each([
    ["Bachata Beginner Footwork Class", "Bachata Intermediate Footwork Class", undefined],
    ["Salsa Level 1 Footwork Shines", "Salsa Level 2 Footwork Shines", undefined],
    ["Kizomba Fundamentals Urban Kiz", "Kizomba Advanced Urban Kiz", "class"],
    ["Halloween Workshop Spooky Styling", "Halloween Workshop Spooky Turns", undefined],
  ])("parallel class levels stay apart: %s / %s", (titleA, titleB, listingType) => {
    const a = side({
      id: "studio-site",
      title: titleA,
      startsAt: at("20:00"),
      venueId: "v-studio",
      venueName: "Studio Uno",
      ...(listingType ? { listingType } : {}),
    });
    const b = side({
      id: "eventbrite",
      title: titleB,
      startsAt: at("20:00"),
      venueId: "v-studio",
      venueName: "Studio Uno",
      ...(listingType ? { listingType } : {}),
    });
    expect(scorePair(a, b, facts({ titleSimilarity: 0.3 })).decision).not.toBe("auto_merge");
  });

  it("Ammos pair -> auto_merge", () => {
    const a = side({
      id: "source1",
      title: "Halloween Costume Party at Ammos Lounge",
      startsAt: at("22:00"),
      venueId: "v-ammos",
      venueName: "Ammos Estiatorio",
    });
    const b = side({
      id: "source2",
      title: "HALLOWEEN. - NYC MIDTOWN MASSACRE COSTUME PARTY",
      startsAt: at("22:00"),
      venueId: "v-ammos",
      venueName: "Ammos Estiatorio",
    });
    expect(scorePair(a, b, facts()).decision).toBe("auto_merge");
  });

  it("same source -> not merged by this rule", () => {
    const a = side({
      id: "same1",
      title: "HALLOWEEN HAUNTED ROOFTOP PARTY - Latin & Reggaeton Party",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    const b = side({
      id: "same2",
      title: "HALLOWEEN HAUNTING. ON THE ROOF - Rooftop Latin & Reggaeton Dance Party @Highbar",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    // sameSource true, low title similarity, other rules don't fire -> distinct
    expect(scorePair(a, b, facts({ sameSource: true })).decision).toBe("distinct");
  });

  it("starts 30 min apart -> not merged", () => {
    const a = side({
      id: "eb",
      title: "HALLOWEEN HAUNTED ROOFTOP PARTY - Latin & Reggaeton Party",
      startsAt: at("21:00"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    const b = side({
      id: "tickeri",
      title: "HALLOWEEN HAUNTING. ON THE ROOF - Rooftop Latin & Reggaeton Dance Party @Highbar",
      startsAt: at("21:30"),
      venueId: "v-highbar",
      venueName: "High Bar New York",
    });
    // oneVenueOneStart requires within 15 min, so rule fails
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("only one shared stem -> not merged", () => {
    const a = side({
      id: "a",
      title: "Salsa Halloween",
      startsAt: at("21:00"),
      venueId: "v-venue",
      venueName: "Some Venue",
    });
    const b = side({
      id: "b",
      title: "Halloween Bachata",
      startsAt: at("21:00"),
      venueId: "v-venue",
      venueName: "Some Venue",
    });
    // Only "halloween" shared, salsa/bachata generic -> 1 stem < 2
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });

  it("class vs social -> not merged", () => {
    const a = side({
      id: "class",
      title: "Halloween Dance Class",
      startsAt: at("21:00"),
      venueId: "v-venue",
      venueName: "Some Venue",
      listingType: "class",
    });
    const b = side({
      id: "social",
      title: "Halloween Dance Party",
      startsAt: at("21:00"),
      venueId: "v-venue",
      venueName: "Some Venue",
      listingType: "dj_night",
    });
    // Different listing types
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });
});

describe("course levels never auto-merge", () => {
  it.each([
    ["Salsa Level 1", "Salsa Level 2", true],
    ["Bachata Beginners", "Bachata Intermediate", true],
    ["Tango L1", "Tango L2", true],
    ["Salsa Nivel 1 On1", "Salsa nivel 1 on1", false],
    ["Beginner Bachata", "Bachata for Beginners", false],
    ["Salsa Level 1", "Salsa Social", false],
  ])("differentLevels(%s, %s) = %s", (a, b, expected) => {
    expect(differentLevels(a, b)).toBe(expected);
  });

  it("vetoes even a near-identical title at one venue and start", () => {
    const a = side({
      id: "x",
      title: "Salsa Level 1 Footwork Shines",
      startsAt: at("20:00"),
      venueId: "v",
      venueName: "Studio Uno",
    });
    const b = side({
      id: "y",
      title: "Salsa Level 2 Footwork Shines",
      startsAt: at("20:00"),
      venueId: "v",
      venueName: "Studio Uno",
    });
    expect(scorePair(a, b, facts({ titleSimilarity: 0.95 })).decision).not.toBe("auto_merge");
  });
});

describe("performer billings stay with the model review", () => {
  it("does not merge two headliners at one venue and start", () => {
    const a = side({
      id: "x",
      title: "Gypsy Jazz with Diego",
      startsAt: at("22:00"),
      venueId: "v",
      venueName: "Venue V",
    });
    const b = side({
      id: "y",
      title: "Gypsy Jazz with Ana",
      startsAt: at("22:00"),
      venueId: "v",
      venueName: "Venue V",
    });
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });
});
