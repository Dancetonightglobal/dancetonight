import { describe, expect, it } from "vitest";
import { genrePrefixedTitle, scorePair } from "@/src/domain/dedupe";
import type { DedupeSide, PairFacts } from "@/src/domain/dedupe";

describe("genrePrefixedTitle", () => {
  it("returns true for known genre-prefixed pairs", () => {
    expect(genrePrefixedTitle("Bass G JONES", "G JONES")).toBe(true);
    expect(genrePrefixedTitle("G JONES", "Bass G JONES")).toBe(true);
    expect(genrePrefixedTitle("House MEDUZA", "MEDUZA")).toBe(true);
    expect(genrePrefixedTitle("Dubstep MAD DUBZ", "MAD DUBZ")).toBe(true);
    expect(genrePrefixedTitle("Hard Techno TRYM", "TRYM")).toBe(true);
    expect(genrePrefixedTitle("Tech House ODD MOB", "ODD MOB")).toBe(true);
  });

  it("returns false for generic remainder", () => {
    expect(genrePrefixedTitle("House Party", "Party")).toBe(false);
  });

  it("returns false when extra word not in genre set", () => {
    expect(genrePrefixedTitle("Salsa G JONES", "G JONES")).toBe(false);
  });

  it("returns false when extra words count > 2", () => {
    expect(genrePrefixedTitle("House Techno Disco MEDUZA", "MEDUZA")).toBe(false);
  });

  it("returns false when lengths equal", () => {
    expect(genrePrefixedTitle("MEDUZA", "MEDUZA")).toBe(false);
  });

  it("returns false when one title empty", () => {
    expect(genrePrefixedTitle("", "MEDUZA")).toBe(false);
    expect(genrePrefixedTitle("MEDUZA", "")).toBe(false);
  });

  it("returns false when the shorter keeps no 3+ letter non-generic word, or the rest differs", () => {
    expect(genrePrefixedTitle("House A", "A")).toBe(false);
    expect(genrePrefixedTitle("Bass G JONES", "G JONES B2B KAYTRANADA")).toBe(false);
  });
});

describe("scorePair with genrePrefixedTitle", () => {
  const baseSide = (
    id: string,
    venueId: string | null,
    startsAt: Date | null,
    title: string,
  ): DedupeSide => ({
    id,
    startsAt,
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "directory",
    firstSeenAt: new Date("2026-10-01T00:00:00Z"),
    title,
    cancelled: false,
  });

  const facts: PairFacts = {
    titleSimilarity: 0.3,
    organizerSimilarity: null,
  };

  it("auto-merges when same venue, same start, genre-prefixed titles", () => {
    const a = baseSide("id1", "venue123", new Date("2026-11-01T01:30:00Z"), "Bass G JONES");
    const b = baseSide("id2", "venue123", new Date("2026-11-01T01:30:00Z"), "G JONES");
    const scored = scorePair(a, b, facts);
    expect(scored.decision).toBe("auto_merge");
  });

  it("does not auto-merge when different venue", () => {
    const a = baseSide("id1", "venue123", new Date("2026-11-01T01:30:00Z"), "Bass G JONES");
    const b = baseSide("id2", "venue456", new Date("2026-11-01T01:30:00Z"), "G JONES");
    const scored = scorePair(a, b, facts);
    expect(scored.decision).not.toBe("auto_merge");
  });

  it("does not auto-merge when starts far apart", () => {
    const a = baseSide("id1", "venue123", new Date("2026-11-01T01:30:00Z"), "Bass G JONES");
    const b = baseSide("id2", "venue123", new Date("2026-11-01T04:30:00Z"), "G JONES");
    const scored = scorePair(a, b, facts);
    expect(scored.decision).not.toBe("auto_merge");
  });
});
