import { screenTitle } from "@/src/domain/listing-screen";
import { describe, it, expect } from "vitest";

// NYC 11-03: watch parties, listening sessions, push-up challenges and bare status labels are not
// dances on any calendar unless the title names a dance style (D-589).
describe("screenTitle watch parties, listening sessions, challenges, status labels (D-589)", () => {
  it.each([
    "Election Night Watch Party",
    "Rolling for Democracy - Election Day Viewing Party (skate)",
    "Deep Listening",
    "Cleo Reed: Listening & Dialogue",
    "Album Listening Session",
    "Listening Party: New Record",
    "22 Pushup Challenge",
    "Push-Up Challenge",
    "Open",
    "ELECTION DAY",
    "Election Night",
  ])("screens %s", (title) => {
    const result = screenTitle(title);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe("not_dance_scope");
    expect(result!.reason).toContain("D-589");
  });

  it.each([
    "Salsa Watch Party & Social",
    "Bachata Listening Party",
    "Open Decks",
    "Open Floor",
    "Open Format Night",
    "Election Night Salsa Social",
    "Deep House Sunday",
    "Spunk Saturday",
    "Tango Mondays",
  ])("does not screen %s with D-589 reason", (title) => {
    const result = screenTitle(title);
    if (result !== null) expect(result.reason).not.toContain("D-589");
  });
});
