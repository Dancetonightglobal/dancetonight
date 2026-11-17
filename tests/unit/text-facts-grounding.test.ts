// Grounding a model read in its page (D-073): how a title or phrase is found on a page, and which
// dates a block of text writes.

import { describe, expect, it } from "vitest";

import {
  findPhrase,
  foldForMatch,
  foldPage,
  statesAnyDate,
  statesDateInSpan,
} from "@/src/domain/text-facts";

describe("foldForMatch", () => {
  it("keeps letters and digits of any script, and folds the rest to single spaces", () => {
    expect(foldForMatch("Esa! Milonga")).toBe("esa milonga");
    expect(foldForMatch("English – Tuesdays")).toBe(foldForMatch("English - Tuesdays"));
    expect(foldForMatch("Café Tango №5")).toBe("cafe tango no5");
    expect(foldForMatch("Милонга «Звезда»")).toBe("милонга звезда");
    // NFKD splits a voiced kana into its base and a mark, and the mark is dropped: both sides of a
    // comparison fold the same way.
    expect(foldForMatch("東京タンゴ 2026")).toBe("東京タンコ 2026");
  });
});

describe("findPhrase", () => {
  const page = foldPage(
    [
      "Social Event Details",
      "N oche De Descarga",
      "Date: Every 3rd Saturday of the month",
      "Victoria’s Practica [https://www.theronda.us/event/victoria-s-practica-2026-10-03-b8384ec8]",
      "Salsa Groove: Dance Class & Happy Hour 6:00 pm [https://sobs.com/events/salsa-groove-10-2-26/]",
      "Милонга Звезда",
    ].join("\n"),
  );

  it("finds a phrase the page writes word for word, folded", () => {
    expect(findPhrase(page, "Salsa Groove: Dance Class & Happy Hour")).toBe("exact");
    expect(findPhrase(page, "every 3rd saturday of the month")).toBe("exact");
    expect(findPhrase(page, "Victoria's Practica")).toBe("exact");
    expect(findPhrase(page, "Милонга Звезда")).toBe("exact");
  });

  it("finds the same letters split into words differently", () => {
    expect(findPhrase(page, "Noche De Descarga")).toBe("spacing");
    expect(findPhrase(page, "Victorias Practica")).toBe("spacing");
  });

  it("finds nothing looser: a word missing, added, changed, or only inside a word", () => {
    expect(findPhrase(page, "Noche Descarga")).toBeNull();
    expect(findPhrase(page, "Salsa Groove Dance Class")).toBe("exact");
    expect(findPhrase(page, "Salsa Groove: Dance Class & Happy Hours")).toBeNull();
    expect(findPhrase(page, "Every Thursday")).toBeNull();
    // "alsa groove" starts inside the page's word "salsa".
    expect(findPhrase(page, "alsa Groove")).toBeNull();
    expect(findPhrase(page, "")).toBeNull();
  });

  it("does not find a title in a link's address", () => {
    expect(findPhrase(page, "salsa groove 10 2 26")).toBeNull();
    expect(findPhrase(page, "the ronda")).toBeNull();
  });
});

describe("the dates a block writes", () => {
  it("tells a block that writes some date from one that names only weekdays", () => {
    for (const text of [
      "Fri, Oct 30 • 8:30 PM",
      "30 October",
      "10/30",
      "30.10.2026",
      "2026-10-30",
    ]) {
      expect(statesAnyDate(text, "en"), text).toBe(true);
    }
    for (const text of ["Every Friday, 8:30 PM", "Doors 9:30", "$15 at the door", "Sat 8pm"]) {
      expect(statesAnyDate(text, "en"), text).toBe(false);
    }
    expect(statesAnyDate("sábado 3 de octubre", "es")).toBe(true);
  });

  it("reads a span of days that holds a night", () => {
    expect(statesDateInSpan("Oct 1st-5th, 2026", "2026-10-02", "en")).toBe(true);
    expect(statesDateInSpan("October 1 - 5", "2026-10-06", "en")).toBe(false);
    expect(statesDateInSpan("Oct 30 – Nov 2", "2026-11-01", "en")).toBe(true);
    expect(statesDateInSpan("Dec 30 to Jan 2", "2027-01-01", "en")).toBe(true);
    expect(statesDateInSpan("Dec 30 to Jan 2", "2026-12-15", "en")).toBe(false);
    expect(statesDateInSpan("Oct 2", "2026-10-02", "en")).toBe(false);
  });
});
