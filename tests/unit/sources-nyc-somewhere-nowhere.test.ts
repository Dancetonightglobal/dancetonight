import { describe, expect, it } from "vitest";
import { NYC_SOURCES } from "@/config/sources/nyc";
import { screenNoDance } from "@/src/domain/listing-screen";

// Somewhere Nowhere's calendar lists comedy, jazz and Sinatra sets beside its club nights (coverage-94, NYC 11-04).
describe("Somewhere Nowhere is a mixed calendar with its own dance nights", () => {
  const seed = NYC_SOURCES.find((s) => s.url === "https://www.somewherenowherenyc.com/events")!;
  const tz = "America/New_York";
  const at = (title: string, iso: string, nightDate: string) =>
    screenNoDance({ title, styles: [], startsAt: new Date(iso), nightDate, tz }, seed);

  it("is a mixed calendar", () => {
    expect(seed.mixedCalendar).toBe(true);
  });

  it.each([
    ["Gotham Jazz", "2026-11-04T22:00:00Z", "2026-11-04"],
    ["Somewhere Funny, Nowhere Serious!", "2026-11-07T01:00:00Z", "2026-11-06"],
    ["Sinatra Under The Stars", "2026-11-06T00:00:00Z", "2026-11-05"],
  ])("leaves out %s", (title, iso, night) => {
    expect(at(title, iso, night)).not.toBeNull();
  });

  it.each([
    ["Suave Saturdays", "2026-11-14T22:00:00Z", "2026-11-14"],
    ["Suave Saturdays (Latin-Inspired Sunset Party)", "2026-11-28T22:00:00Z", "2026-11-28"],
    ["Haus of Joon Presents: Jad Halal", "2026-11-08T04:00:00Z", "2026-11-07"],
    ["Loco Carnaval: TBA", "2026-11-16T04:00:00Z", "2026-11-15"],
  ])("keeps %s", (title, iso, night) => {
    expect(at(title, iso, night)).toBeNull();
  });
});
