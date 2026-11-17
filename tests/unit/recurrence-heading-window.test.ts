// The window under a weekday heading ends at the next one (Cubana Café, Paris, D-073).
import { describe, expect, it } from "vitest";
import { foldPage, recurrenceNearTitle, weekdaysNearTitle } from "@/src/domain/text-facts";

describe("window under a weekday heading", () => {
  it("stops at the next weekday heading when title is directly under one", () => {
    const text = `TOUS LES JOURS
Happy Hour de 16h à 20h

TOUS LES LUNDIS
Ouvert jusqu’à 3h du matin

LES MARDIS & JEUDIS
Dansez comme à Cuba jusqu’à 4h du mat’!

TOUS LES MERCREDIS
Concert en fonction des soirées

LES VENDREDIS
Salsa avec DJ`;
    const page = foldPage(text);
    // Should not accept a different weekday heading that follows.
    expect(recurrenceNearTitle(page, "Dansez comme à Cuba", "les mercredis", "fr")).toBe(false);
    expect(recurrenceNearTitle(page, "Dansez comme à Cuba", "les vendredis", "fr")).toBe(false);
    // Should accept its own heading.
    expect(recurrenceNearTitle(page, "Dansez comme à Cuba", "les mardis et jeudis", "fr")).toBe(
      true,
    );
    const weekdays = weekdaysNearTitle(page, "Dansez comme à Cuba", "fr");
    expect(weekdays.has("TU")).toBe(true);
    expect(weekdays.has("TH")).toBe(true);
    expect(weekdays.has("WE")).toBe(false);
    expect(weekdays.has("FR")).toBe(false);
  });

  it("unchanged layout: title not under a weekday heading", () => {
    const text = `Salsa Night
Great DJs all night
Every Tuesday`;
    const page = foldPage(text);
    // The title is not directly under a weekday heading, so the window should include "Every Tuesday".
    expect(recurrenceNearTitle(page, "Salsa Night", "every Tuesday", "en")).toBe(true);
  });
});
