import { describe, expect, it } from "vitest";
import { scorePair } from "@/src/domain/dedupe";
import type { DedupeSide, PairFacts } from "@/src/domain/dedupe";

describe("RA-DICE dedupe", () => {
  const baseSide = (
    id: string,
    venueId: string | null,
    startsAt: Date | null,
    title: string,
    ticketUrl: string,
    trust: "ticketing" | "directory" | "first_party",
  ): DedupeSide => ({
    id,
    startsAt,
    organizerId: null,
    organizerName: null,
    venueId,
    ticketUrl,
    canonicalUrl: null,
    trust,
    firstSeenAt: new Date("2026-10-01T00:00:00Z"),
    title,
    cancelled: false,
  });

  const facts: PairFacts = {
    titleSimilarity: 0.8,
    organizerSimilarity: null,
  };

  it("auto-merges RA and DICE at same venue, same start, similar titles", () => {
    const ra = baseSide(
      "ra1",
      "venue123",
      new Date("2026-11-01T02:00:00Z"),
      "Daft Disko Halloween: Miami",
      "https://ra.co/events/2537063",
      "ticketing",
    );
    const dice = baseSide(
      "dice1",
      "venue123",
      new Date("2026-11-01T02:00:00Z"),
      "Daft Disko Halloween",
      "https://dice.fm/event/abc123",
      "ticketing",
    );
    const scored = scorePair(ra, dice, facts);
    // If this fails, STOP and report it.
    expect(scored.decision).toBe("auto_merge");
  });

  it("does not auto-merge when different venue", () => {
    const ra = baseSide(
      "ra2",
      "venue123",
      new Date("2026-11-01T02:00:00Z"),
      "Daft Disko Halloween: Miami",
      "https://ra.co/events/2537063",
      "ticketing",
    );
    const dice = baseSide(
      "dice2",
      "venue456",
      new Date("2026-11-01T02:00:00Z"),
      "Daft Disko Halloween",
      "https://dice.fm/event/abc123",
      "ticketing",
    );
    const scored = scorePair(ra, dice, facts);
    expect(scored.decision).not.toBe("auto_merge");
  });
});
