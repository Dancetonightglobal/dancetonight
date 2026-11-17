// D-771 (Berlin 11-07 read): Ticketmaster kept "Digitalism - OPTIMISM TOUR 2026" (Soda Club) and "Overmono - Pure
// Devotion - World Tour" (Huxley's), both 8pm with no end, as Dance/Electronic club nights with no style. D-757's
// live-show screen only screens a club row (dj_night), so both stayed. A Ticketmaster club night that names no style
// is now tagged dj_night, as RA, Skiddle and Bugece tag theirs. "Listening Experience" and "First Listening" are
// listening sessions (D-589).

import { describe, expect, it } from "vitest";

import { danceRelevance } from "@/src/adapters/apis/ticketmaster";
import { screenNoDance, screenTitle } from "@/src/domain/listing-screen";

const ELECTRONIC = { segment: "Music", genre: "Dance/Electronic", subGenre: null };

function row(title: string, styles: string[], hh: number) {
  return {
    title,
    styles,
    startsAt: new Date(Date.UTC(2026, 10, 12, hh - 1, 0)),
    endsAt: null,
    nightDate: "2026-11-12",
    tz: "Europe/Berlin",
  };
}

describe("Ticketmaster club nights with no style are DJ nights (D-771)", () => {
  it.each(["Digitalism - OPTIMISM TOUR 2026", "Overmono - Pure Devotion - World Tour"])(
    "tags %s dj_night, and D-757 screens it at 8pm",
    (title) => {
      const relevance = danceRelevance(title, ELECTRONIC);
      expect(relevance).toMatchObject({ keep: true, type: "club_night", styles: ["dj_night"] });
      const result = screenNoDance(row(title, relevance.styles, 20), {});
      expect(result?.kind).toBe("not_a_dance");
      expect(result?.reason).toContain("D-757");
    },
  );

  it("tags a headliner-classified club night dj_night too", () => {
    const relevance = danceRelevance(
      "Dusky",
      { segment: "Music", genre: "Other", subGenre: null },
      null,
      ELECTRONIC,
    );
    expect(relevance.styles).toEqual(["dj_night"]);
  });

  it("keeps a named style instead of dj_night", () => {
    expect(danceRelevance("Techno Tuesday", ELECTRONIC).styles).toEqual(["techno"]);
  });

  it("keeps the same tour row when it starts at 10pm or later", () => {
    const relevance = danceRelevance("Digitalism - OPTIMISM TOUR 2026", ELECTRONIC);
    expect(
      screenNoDance(row("Digitalism - OPTIMISM TOUR 2026", relevance.styles, 23), {}),
    ).toBeNull();
  });

  it("still keeps a no-style live row from another source (a studio's own page)", () => {
    expect(screenNoDance(row("Jazz Trio Live", [], 20), {})).toBeNull();
  });
});

describe("listening sessions (D-771)", () => {
  it.each(["THEO CROKER: AFTER DARK, FIRST LISTENING", "BREAK THE CYCLE Listening Experience"])(
    "screens %s",
    (title) => {
      expect(screenTitle(title)).not.toBeNull();
    },
  );

  it("keeps a listening title that names a dance style", () => {
    expect(screenTitle("Salsa Listening Experience & Social")).toBeNull();
  });
});
