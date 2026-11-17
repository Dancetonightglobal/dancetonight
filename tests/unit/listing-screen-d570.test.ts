// D-570, D-571: dance shows, sports, children's programs (owner, 2026-11-02).
import { describe, expect, it } from "vitest";
import { screenTitle, screenStoredRow } from "@/src/domain/listing-screen";

describe("screenTitle dance shows, sports, children's programs (D-570, D-571)", () => {
  it("screens sports", () => {
    // For "CQMini Hoopers Basketball", either sport or children's program is acceptable
    const cases = [
      {
        title: "CQMini Hoopers Basketball (Ages 3.54) – Sundays 9:30am-10:15pm – Fall 2026",
        possibleReasons: [
          "a sport, not a dance (D-571)",
          "a children's program (the owner lists none, D-571)",
        ],
      },
      {
        title: "Adult Pickleball Drop-In",
        possibleReasons: ["a sport, not a dance (D-571)"],
      },
      {
        title: "Martial Arts for Adults",
        possibleReasons: ["a sport, not a dance (D-571)"],
      },
      {
        title: "Chess Club Night",
        possibleReasons: ["a sport, not a dance (D-571)"],
      },
    ] as const;
    for (const { title, possibleReasons } of cases) {
      const result = screenTitle(title);
      expect(result, title).not.toBeNull();
      expect(possibleReasons).toContain(result?.reason);
    }
  });

  it("keeps titles that name a dance alongside sport", () => {
    for (const title of [
      "Golf Swing Dance Party", // contains "swing" (dance style)
      "Salsa Basketball Night", // contains "salsa" (dance style)
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("screens children's programs", () => {
    // For "CQ – Tiny Tumblers", either sport or children's program is acceptable
    const cases = [
      {
        title: "CQ – Tiny Tumblers (12-18 months) – Mondays – 10:00-10:45am",
        possibleReasons: [
          "a children's program (the owner lists none, D-571)",
          "a sport, not a dance (D-571)",
        ],
      },
      {
        title: "Kids Hip Hop Class",
        possibleReasons: ["a children's program (the owner lists none, D-571)"],
      },
      {
        title: "Ballet (Ages 4-6)",
        possibleReasons: ["a children's program (the owner lists none, D-571)"],
      },
      {
        title: "Creative Movement for 3-5 year olds",
        possibleReasons: ["a children's program (the owner lists none, D-571)"],
      },
      {
        title: "Youth Ballroom Team Practice",
        possibleReasons: ["a children's program (the owner lists none, D-571)"],
      },
    ] as const;
    for (const { title, possibleReasons } of cases) {
      const result = screenTitle(title);
      expect(result, title).not.toBeNull();
      expect(possibleReasons).toContain(result?.reason);
    }
  });

  it("drops children's programs even with a dance style (D-571)", () => {
    // Teen Salsa should be dropped (D-571)
    const result = screenTitle("Teen Salsa");
    expect(result).not.toBeNull();
    expect(result?.reason).toBe("a children's program (the owner lists none, D-571)");
    // A kids' dance class is a children's program too (D-571 replaces the old "kept" case).
    expect(screenTitle("Kids Salsa Class")?.reason).toBe(
      "a children's program (the owner lists none, D-571)",
    );
    for (const title of ["Baby Ballet (12-18 months)", "Creative Movement for 3-5 year olds"]) {
      expect(screenTitle(title)?.reason, title).toBe(
        "a children's program (the owner lists none, D-571)",
      );
    }
    // Times are not ages: "8-11pm", "Salsa 9 to 1".
    expect(screenTitle("Salsa Night 8-11pm")).toBeNull();
  });

  it("keeps DJ line-ups, names and joinable nights the live preview caught (2026-11-02)", () => {
    for (const title of [
      "Friday Frankhan: DJ Tennis, Kybba",
      "Junkie Kid",
      "Kid Chocolate & The Free POC",
      "Private Funktion: Nina Yamada, Offie Mag DJs, Hiren Parmar & Eman Pav",
      "Bike Easy Annual Second Line & Post-Ride Performance by Sweet Crude",
      "Tower - album premiere + afterparty",
      "Lindy Hop Performance Team with Alejandro & Anna",
      "Rittenhouse · Suzanne Roberts Theatre Fall Series 2026",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("keeps titles with kid words but with exceptions", () => {
    for (const title of [
      "Salsa Night, kids welcome",
      "Bachata Social (kids under 12 free)",
      "Swing Dance Party with Live Performance",
      "Ages 18+ Salsa Night",
      "All Ages Swing Dance",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("screens dance shows", () => {
    for (const [title, reason] of [
      [
        "Nritya Arpan: A Kathak & Kuchipudi Classical Dance Presentation",
        "a dance show, not a dance people join (D-570)",
      ],
      ["Spring Dance Recital", "a dance show, not a dance people join (D-570)"],
      ["Tango Theatre Premiere", "a dance show, not a dance people join (D-570)"],
    ] as const) {
      const result = screenTitle(title);
      expect(result, title).not.toBeNull();
      expect(result?.reason, title).toBe(reason);
    }
  });

  it("keeps titles with show words but also join words", () => {
    for (const title of [
      "Swing Dance Party with Live Performance",
      "Flamenco: Espectaculo de Baile", // contains "baile" (join word)
      "Kizomba Class + Social",
      "Contra Dance Concert", // concert is not a show word
      "Milonga & Tango Performance", // contains "milonga" (join word)
      "Salsa Night",
    ]) {
      expect(screenTitle(title), title).toBeNull();
    }
  });

  it("screenStoredRow returns show reason for dance show", () => {
    const reason = screenStoredRow(
      {
        title: "Spring Dance Recital",
        styles: [],
        startsAt: null,
        nightDate: "2026-11-02",
        tz: "America/New_York",
      },
      {},
    );
    expect(reason).toBe("a dance show, not a dance people join (D-570)");
  });
});
