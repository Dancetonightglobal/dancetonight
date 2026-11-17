import { describe, expect, it } from "vitest";
import { screenNoDance, isNamedDanceNight } from "@/src/domain/listing-screen";

describe("isNamedDanceNight", () => {
  it("matches case-insensitively and ignores punctuation", () => {
    expect(isNamedDanceNight("CHAMBRE NOIR", ["Chambre Noir"])).toBe(true);
    expect(isNamedDanceNight("Heatwave!", ["Heatwave"])).toBe(true);
    expect(isNamedDanceNight("Heatwave!", ["Heatwave!"])).toBe(true);
  });

  it("requires exact normalized match", () => {
    expect(isNamedDanceNight("Chambre Noir: Halloween", ["Chambre Noir"])).toBe(false);
    expect(isNamedDanceNight("Chambre Noir", ["Chambre Noir: Halloween"])).toBe(false);
  });

  it("handles empty or undefined danceNights", () => {
    expect(isNamedDanceNight("X", undefined)).toBe(false);
    expect(isNamedDanceNight("X", [])).toBe(false);
    expect(isNamedDanceNight("X", [""])).toBe(false);
    expect(isNamedDanceNight("", [""])).toBe(false);
  });

  it("an entry ending in * matches titles its whole words open", () => {
    expect(isNamedDanceNight("Polenta 6 NOV en Niceto Club (+18 años)", ["Polenta *"])).toBe(true);
    expect(isNamedDanceNight("Club 69 | 31 OCT HALLOWEEN", ["Club 69*"])).toBe(true);
    expect(isNamedDanceNight("Club 69", ["Club 69 *"])).toBe(true);
    expect(isNamedDanceNight("Polentas del Sur en vivo", ["Polenta *"])).toBe(false);
    expect(isNamedDanceNight("Concierto: Club 69 tributo", ["Club 69 *"])).toBe(false);
    expect(isNamedDanceNight("Polenta 6 NOV", ["Polenta"])).toBe(false);
    expect(isNamedDanceNight("Anything", ["*"])).toBe(false);
  });

  it("ignores leading/trailing spaces", () => {
    expect(isNamedDanceNight("  CHAMBRE NOIR  ", [" Chambre Noir "])).toBe(true);
  });
});

describe("screenNoDance with danceNights", () => {
  const TZ = "America/New_York";
  const NIGHT = "2026-11-06";
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 6, hour + 5)); // EST
  const listing = (title: string, hour = 20) => ({
    title,
    styles: [] as string[],
    startsAt: at(hour),
    nightDate: NIGHT,
    tz: TZ,
  });

  const mixedOnly = { mixedCalendar: true, styles: [] as string[] };
  const mixedWithDanceNights = {
    mixedCalendar: true,
    styles: [] as string[],
    danceNights: ["Chambre Noir"],
  };

  it("keeps a named dance night on a mixed calendar", () => {
    expect(screenNoDance(listing("CHAMBRE NOIR"), mixedOnly)).not.toBeNull();
    // With danceNights, it also passes
    expect(screenNoDance(listing("CHAMBRE NOIR"), mixedWithDanceNights)).toBeNull();
  });

  it("still screens other titles", () => {
    // Use a band billing that is screened on a mixed calendar without bandsForDancers
    expect(
      screenNoDance(listing("Deathcharge with Come to Ruin"), mixedWithDanceNights),
    ).not.toBeNull();
  });

  it("does nothing on a non-mixed source", () => {
    const nonMixed = {
      mixedCalendar: false,
      styles: [] as string[],
      danceNights: ["Chambre Noir"],
    };
    expect(screenNoDance(listing("CHAMBRE NOIR"), nonMixed)).toBeNull();
    expect(screenNoDance(listing("Some Concert"), nonMixed)).toBeNull();
  });
});
