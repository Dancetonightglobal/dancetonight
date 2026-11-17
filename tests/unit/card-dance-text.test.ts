import { describe, it, expect } from "vitest";
import type { SeedSource } from "@/config/sources/nyc";
import { isDanceCardInText } from "@/src/pipeline/card-title";

describe("isDanceCardInText", () => {
  const card: SeedSource["cardTitle"] = {
    prefix:
      /^93\s+(?:CLUB|LIVE)\s+[A-Za-z]+day\s+\d{1,2}\s+[A-Za-z]{3,9}\s+\d{1,2}(?::\d{2})?\s*[ap]m(?:\s*-\s*\d{1,2}(?::\d{2})?\s*[ap]m)?/i,
    rooms: ["Main Room", "Live Room", "The Courtyard"],
    tails: ["House", "18+"],
    danceCard: /^93\s+CLUB\b/i,
  };

  const pageText = `93 LIVE Wednesday 18 Nov 7:30 pm - 11 PM / Live Room EFG London Jazz Festival Jazz Soul 18+ Buy Tickets
93 CLUB Saturday 28 Nov 3:30 pm - 11 PM / Main Room / The Courtyard Kinky Malinki Ibiza Reunion Balearics House 18+ Buy Tickets
93 LIVE Thursday 26 Nov 7 pm - 11 PM / Live Room PWEI.40 (POP WILL EAT ITSELF) Electro 18+`;

  it("returns true for cleaned club night title", () => {
    expect(isDanceCardInText("Kinky Malinki Ibiza Reunion", pageText, card)).toBe(true);
  });

  it("returns true for title with different case and extra spaces", () => {
    expect(isDanceCardInText("kinky   malinki ibiza reunion", pageText, card)).toBe(true);
  });

  it("returns false for live gig title", () => {
    expect(isDanceCardInText("EFG London Jazz Festival", pageText, card)).toBe(false);
  });

  it("returns false for another live gig title", () => {
    expect(isDanceCardInText("PWEI.40 (POP WILL EAT ITSELF)", pageText, card)).toBe(false);
  });

  it("returns false for title not on page", () => {
    expect(isDanceCardInText("Not On The Page", pageText, card)).toBe(false);
  });

  it("returns false when card is undefined", () => {
    expect(isDanceCardInText("Kinky Malinki Ibiza Reunion", pageText, undefined)).toBe(false);
  });

  it("returns false when card has no danceCard", () => {
    const cardWithoutDance = { ...card, danceCard: undefined };
    expect(isDanceCardInText("Kinky Malinki Ibiza Reunion", pageText, cardWithoutDance)).toBe(
      false,
    );
  });

  it("returns false when pageText is empty", () => {
    expect(isDanceCardInText("Kinky Malinki Ibiza Reunion", "", card)).toBe(false);
  });

  it("returns false when title is too short", () => {
    expect(isDanceCardInText("abc", pageText, card)).toBe(false);
  });

  it("returns false when prefix is more than 300 characters away", () => {
    // Create a page text where a 93 CLUB prefix is followed by 320 "x " characters, then the title
    const prefix = "93 CLUB Saturday 28 Nov 3:30 pm - 11 PM / Main Room / The Courtyard ";
    const padding = "x ".repeat(160); // 320 characters total
    const customPageText = prefix + padding + "Kinky Malinki Ibiza Reunion";
    // The title is in the page, but the nearest prefix is more than 300 characters away
    expect(isDanceCardInText("Kinky Malinki Ibiza Reunion", customPageText, card)).toBe(false);
  });
});
