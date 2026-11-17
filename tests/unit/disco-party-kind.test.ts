// D-865: on a mixed calendar a disco night with a decade ("DISCO 80's", Tokyo MAHARAJA 2026-11-11), "disco
// classics", italo or nu disco is a party kind; bare "disco" (Spanish/Portuguese for an album) is not.
import { describe, expect, it } from "vitest";

import { PARTY_KIND_REGEX, screenNoDance } from "@/src/domain/listing-screen";
import { normalizeForMatch } from "@/config/styles";

const at = (title: string) => ({
  title,
  styles: [] as string[],
  startsAt: new Date("2026-11-13T10:00:00Z"), // 19:00 in Tokyo, before club hours
  nightDate: "2026-11-13",
  tz: "Asia/Tokyo",
});
const mixed = { mixedCalendar: true };

describe("disco party kinds on a mixed calendar (D-865)", () => {
  it.each([
    "DISCO 80's",
    "DISCO 80s",
    "80s Disco",
    "70's disco",
    "Disco Fever 80's",
    "90s Dance Disco",
    "DISCO CLASSICS",
    "Italo Disco",
    "Nu Disco Sessions",
  ])("keeps %s", (title) => {
    expect(PARTY_KIND_REGEX.test(normalizeForMatch(title))).toBe(true);
    expect(screenNoDance(at(title), mixed)).toBeNull();
  });

  it.each([
    "Disco",
    "Presentacion del disco",
    "Lancamento do novo disco",
    "Rock Night",
    "Disco 1999 tour",
  ])("still screens %s", (title) => {
    expect(PARTY_KIND_REGEX.test(normalizeForMatch(title))).toBe(false);
  });

  it("keeps a decade disco far from the word only within two words", () => {
    expect(PARTY_KIND_REGEX.test(normalizeForMatch("disco one two three 80s"))).toBe(false);
    expect(PARTY_KIND_REGEX.test(normalizeForMatch("disco one two 80s"))).toBe(true);
  });
});
