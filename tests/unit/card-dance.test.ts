import { describe, it, expect } from "vitest";
import { isDanceCard } from "@/src/pipeline/card-title";

describe("isDanceCard", () => {
  it("returns false when card is undefined", () => {
    expect(isDanceCard("93 CLUB Saturday 28 Nov", undefined)).toBe(false);
  });

  it("returns false when card has no danceCard", () => {
    const card = {
      prefix: /^93\s+(CLUB|LIVE)\b/i,
      rooms: ["Main Room", "Live Room"],
      tails: ["House", "Techno"],
    };
    expect(isDanceCard("93 CLUB Saturday 28 Nov", card)).toBe(false);
  });

  it("returns true for club night with danceCard match", () => {
    const card = {
      prefix: /^93\s+(CLUB|LIVE)\b/i,
      rooms: ["Main Room", "Live Room", "The Courtyard", "Members Bar", "Rooftop Terrace"],
      tails: ["Balearics", "House", "18+"],
      danceCard: /^93\s+CLUB\b/i,
    };
    const title =
      "93 CLUB Saturday 28 Nov 3:30 pm - 11 PM / Main Room / The Courtyard Kinky Malinki Ibiza Reunion Balearics House 18+";
    expect(isDanceCard(title, card)).toBe(true);
  });

  it("returns false for live gig with danceCard", () => {
    const card = {
      prefix: /^93\s+(CLUB|LIVE)\b/i,
      rooms: ["Main Room", "Live Room"],
      tails: ["House", "Techno"],
      danceCard: /^93\s+CLUB\b/i,
    };
    const title = "93 LIVE Wednesday 18 Nov 7:30 pm - 11 PM / Live Room EFG London Jazz Festival";
    expect(isDanceCard(title, card)).toBe(false);
  });

  it("returns false for already cleaned title without marker", () => {
    const card = {
      prefix: /^93\s+(CLUB|LIVE)\b/i,
      rooms: ["Main Room", "Live Room"],
      tails: ["House", "Techno"],
      danceCard: /^93\s+CLUB\b/i,
    };
    const title = "Kinky Malinki Ibiza Reunion";
    expect(isDanceCard(title, card)).toBe(false);
  });

  it("handles g-flagged regex correctly on repeated calls", () => {
    const card = {
      prefix: /^93\s+(CLUB|LIVE)\b/i,
      rooms: ["Main Room", "Live Room"],
      tails: ["House", "Techno"],
      danceCard: /93 CLUB/g,
    };
    const title = "93 CLUB Saturday 28 Nov 3:30 pm - 11 PM / Main Room Kinky Malinki";
    // Call three times in a row - should all return true
    expect(isDanceCard(title, card)).toBe(true);
    expect(isDanceCard(title, card)).toBe(true);
    expect(isDanceCard(title, card)).toBe(true);
  });
});
