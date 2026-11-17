import { describe, expect, it } from "vitest";
import { NYC_SOURCES } from "@/config/sources/nyc";
import { screenNoDance } from "@/src/domain/listing-screen";

// The Monster's calendar lists piano bar sets and drag shows beside its dance nights (D-589, NYC 11-03).
describe("The Monster (Spunk) is a mixed calendar with its own dance nights", () => {
  const seed = NYC_SOURCES.find((s) => s.url === "https://www.spunknyc.com/monster-reservations")!;
  const tz = "America/New_York";
  const at = (title: string, iso: string, nightDate: string) =>
    screenNoDance({ title, styles: [], startsAt: new Date(iso), nightDate, tz }, seed);

  it("is a mixed calendar", () => {
    expect(seed.mixedCalendar).toBe(true);
  });

  it.each([
    ["At the Piano with Martin St Lawrence", "2026-11-03T23:00:00Z", "2026-11-03"],
    ["Curtains UP! with Jada Valenciaga", "2026-11-04T02:00:00Z", "2026-11-03"],
    ["Glamageddon: Deploy the Divas", "2026-11-05T02:30:00Z", "2026-11-04"],
  ])("leaves out %s", (title, iso, night) => {
    expect(at(title, iso, night)).not.toBeNull();
  });

  it.each([
    ["SPUNK: with Fifi Dubois & DJ Nicky Boombox", "2026-11-06T03:00:00Z", "2026-11-05"],
    ["B2B BASSMENT with Jools & Mandy", "2026-11-07T03:00:00Z", "2026-11-06"],
    ["Sunday Tea Dance", "2026-11-08T22:00:00Z", "2026-11-08"],
    ["Bitches Love the 90s - with Tiffany & Clarice", "2026-11-10T03:00:00Z", "2026-11-09"],
  ])("keeps %s", (title, iso, night) => {
    expect(at(title, iso, night)).toBeNull();
  });
});
