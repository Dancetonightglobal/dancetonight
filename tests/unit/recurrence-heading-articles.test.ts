// Weekday headings with articles: Cubana Café's "LES MARDIS & JEUDIS" (Paris, D-073).
import { describe, expect, it } from "vitest";
import { foldPage, recurrenceNearTitle, weekdaysNearTitle } from "@/src/domain/text-facts";

describe("weekday headings with articles", () => {
  it("accepts French 'LES MARDIS & JEUDIS' as a heading", () => {
    const text = `TOUS LES JOURS
Happy Hour de 16h à 20h

TOUS LES LUNDIS
Ouvert jusqu’à 3h du matin

LES MARDIS & JEUDIS
Dansez comme à Cuba jusqu’à 4h du mat’!

TOUS LES MERCREDIS
Concert en fonction des soirées`;
    const page = foldPage(text);
    // The phrase "les mardis et jeudis" should be accepted because the heading provides weekdays.
    expect(recurrenceNearTitle(page, "Dansez comme à Cuba", "les mardis et jeudis", "fr")).toBe(
      true,
    );
    expect(recurrenceNearTitle(page, "Dansez comme à Cuba", "Les mardis & jeudis", "fr")).toBe(
      true,
    );
    expect(
      recurrenceNearTitle(page, "Dansez comme à Cuba", "every Tuesday and Thursday", "fr"),
    ).toBe(true);
    // Should not accept a different weekday.
    expect(recurrenceNearTitle(page, "Dansez comme à Cuba", "les vendredis", "fr")).toBe(false);
    // weekdaysNearTitle should contain TU and TH.
    const weekdays = weekdaysNearTitle(page, "Dansez comme à Cuba", "fr");
    expect(weekdays.has("TU")).toBe(true);
    expect(weekdays.has("TH")).toBe(true);
    expect(weekdays.has("FR")).toBe(false);
  });

  it("accepts Spanish 'LOS MARTES Y JUEVES' as a heading", () => {
    const text = `LOS MARTES Y JUEVES
Noche de salsa cubana`;
    const page = foldPage(text);
    expect(recurrenceNearTitle(page, "Noche de salsa cubana", "los martes y jueves", "es")).toBe(
      true,
    );
    const weekdays = weekdaysNearTitle(page, "Noche de salsa cubana", "es");
    expect(weekdays.has("TU")).toBe(true);
    expect(weekdays.has("TH")).toBe(true);
  });

  it("accepts Portuguese 'AS TERÇAS E QUINTAS' as a heading", () => {
    const text = `AS TERÇAS E QUINTAS
Forró na praça`;
    const page = foldPage(text);
    expect(recurrenceNearTitle(page, "Forró na praça", "terças e quintas", "pt")).toBe(true);
    const weekdays = weekdaysNearTitle(page, "Forró na praça", "pt");
    expect(weekdays.has("TU")).toBe(true);
    expect(weekdays.has("TH")).toBe(true);
  });

  it("rejects a line with 'every' as a heading (non-weekly mode)", () => {
    const text = `Salsa Club
Every Thursday, 9pm

Bachata Night
DJ all night`;
    const page = foldPage(text);
    // The heading "Every Thursday, 9pm" is not a weekday heading (contains DETAIL_WORDS).
    expect(recurrenceNearTitle(page, "Bachata Night", "every Thursday", "en")).toBe(false);
  });
});
