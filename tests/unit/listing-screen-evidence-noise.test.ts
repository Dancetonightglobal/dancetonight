import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";

// D-845: two LA cards kept on 11-10 by a dance word in the one description sentence used as evidence (D-261):
// verbatim iCal DESCRIPTION sentences from run 42865224828 (cities-10 repro); styles [], type other.
const tz = "America/Los_Angeles";
const night = "2026-11-12";
const row = (title: string, sentence: string, hour: number) => ({
  title,
  styles: [] as string[],
  startsAt: new Date(`2026-11-12T${String(hour).padStart(2, "0")}:00:00-08:00`),
  nightDate: night,
  tz,
  evidenceText: `${title} ${sentence}`,
});
const mixed = { mixedCalendar: true, styles: [] };

describe("screenNoDance: dance words that are not evidence (D-845)", () => {
  it("screens the USC design panel whose credits name a School of Dance", () => {
    const r = screenNoDance(
      row(
        "Sun to Shade: Designing to Live Well in a Hotter Los Angeles",
        "Organized by Brianna Seabron (Gensler), Kevin Sherrod (Gensler, USC School of Architecture), Jennifer Lott (USC Kaufman School of Dance, USC Arts and Climate Collective), and Kiel Shaub (USC Physical Education).",
        16,
      ),
      mixed,
    );
    expect(r).not.toBeNull();
  });

  it("screens the Buffy sing-along whose blurb says she sings, dances", () => {
    const r = screenNoDance(
      row(
        "“Once More, With Feeling” Buffy, the Vampire Slayer Musical Episode Live!",
        "See Buffy slay all day as she sings, dances, and suffers demonic entrances!",
        19,
      ),
      mixed,
    );
    expect(r).not.toBeNull();
  });

  it("still keeps a row whose evidence really says dance", () => {
    expect(
      screenNoDance(row("Friday at the Echo", "An all-vinyl oldies dance party", 21), mixed),
    ).toBeNull();
  });
});
