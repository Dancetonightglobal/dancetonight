import { describe, expect, it } from "vitest";
import { screenNoDance, DANCE_WORDS_REGEX } from "@/src/domain/listing-screen";
import { matchStyles, normalizeForMatch } from "@/config/styles";

describe("afrolatina/afrolatino as dance words", () => {
  const TZ = "Europe/Lisbon";
  const NIGHT = "2026-11-01";
  const at = (hour: number) => new Date(Date.UTC(2026, 10, 1, hour)); // Lisbon is on UTC (WET) in November
  const listing = (title: string, hour = 20) => ({
    title,
    styles: [] as string[],
    startsAt: at(hour),
    nightDate: NIGHT,
    tz: TZ,
  });

  const mixedOnly = { mixedCalendar: true, styles: [] as string[] };

  it("keeps 'Festa Afrolatina' (mixed Afro-Latin social)", () => {
    const result = screenNoDance(
      listing("DanSunday | 5º Aniversário & FILIPE TAVARES B-DAY | 01 NOV | Festa Afrolatina"),
      mixedOnly,
    );
    expect(result).toBeNull();
  });

  it("keeps 'Noite Afro-Latina' (hyphenated)", () => {
    const result = screenNoDance(listing("Noite Afro-Latina"), mixedOnly);
    expect(result).toBeNull();
  });

  it("screens a concert billing without dance words", () => {
    // Use a known screened title from the dance-nights test
    const result = screenNoDance(listing("Deathcharge with Come to Ruin"), mixedOnly);
    expect(result).not.toBeNull();
  });

  it("does not set a style for 'Festa Afrolatina'", () => {
    const normalized = normalizeForMatch("Festa Afrolatina");
    const matched = matchStyles(normalized);
    expect(matched.styles).toEqual([]);
  });

  it("does not over-match 'Festa Latina'", () => {
    expect(DANCE_WORDS_REGEX.test("Festa Latina")).toBe(false);
  });
});
