import { describe, expect, it } from "vitest";

import { titleNamesVenueElsewhere } from "@/src/domain/title-elsewhere";

// 2026-11-14 is a Saturday; 2026-11-11 is a Wednesday.
const SAT = "2026-11-14";
const WED = "2026-11-11";

describe("titleNamesVenueElsewhere (D-863)", () => {
  it("drops an RA row titled for another city's club on another weekday (LA daily 2026-11-11)", () => {
    expect(
      titleNamesVenueElsewhere("Sports Night Wednesday at SCALA London", SAT, ["Los Angeles"]),
    ).toBe("London");
  });

  it("matches plural weekdays, multi-word cities and trailing punctuation, case-insensitively", () => {
    expect(
      titleNamesVenueElsewhere("Salsa Fridays at the Blue Room new york!", SAT, ["Miami"]),
    ).toBe("New York");
    expect(
      titleNamesVenueElsewhere("Tango Tuesdays at Salon Canning, Buenos Aires.", SAT, ["Paris"]),
    ).toBe("Buenos Aires");
  });

  it("folds accents in the title", () => {
    expect(
      titleNamesVenueElsewhere("Noche Lunes at Club Cuba Medellín", SAT, ["Miami"]),
    ).toBeNull();
    expect(titleNamesVenueElsewhere("Monday Bachata at Café Mambo Medellín", SAT, ["Miami"])).toBe(
      "Medellin",
    );
  });

  it("keeps the row when the weekday matches the night", () => {
    expect(
      titleNamesVenueElsewhere("Sports Night Wednesday at SCALA London", WED, ["Los Angeles"]),
    ).toBeNull();
  });

  it("keeps the row when the title names no weekday", () => {
    expect(
      titleNamesVenueElsewhere("Sports Night at SCALA London", SAT, ["Los Angeles"]),
    ).toBeNull();
  });

  it("keeps the row when the title names two different weekdays", () => {
    expect(
      titleNamesVenueElsewhere("Wednesday and Thursday Swing at Jazz Cafe London", SAT, [
        "Los Angeles",
      ]),
    ).toBeNull();
  });

  it("keeps the row when the city is the metro's own", () => {
    expect(
      titleNamesVenueElsewhere("Sports Night Wednesday at SCALA London", SAT, ["London"]),
    ).toBeNull();
    expect(
      titleNamesVenueElsewhere("Sports Night Wednesday at SCALA london", SAT, ["London"]),
    ).toBeNull();
    // A metro's other names are its own too.
    expect(
      titleNamesVenueElsewhere("Disco Wednesday at Elsewhere Brooklyn", SAT, ["New York"]),
    ).toBeNull();
    expect(titleNamesVenueElsewhere("Disco Wednesday at Elsewhere Brooklyn", SAT, ["Miami"])).toBe(
      "Brooklyn",
    );
  });

  it("keeps the row when the city is not at the end after 'at'", () => {
    // Café de Paris is a London club: the city word is not the title's last word.
    expect(
      titleNamesVenueElsewhere("Swing Wednesday at Cafe de Paris Ballroom", SAT, ["London"]),
    ).toBeNull();
    expect(titleNamesVenueElsewhere("London Calling Wednesday", SAT, ["Los Angeles"])).toBeNull();
    expect(titleNamesVenueElsewhere("Wednesday Night London", SAT, ["Los Angeles"])).toBeNull();
  });

  it("allows at most four words between 'at' and the city", () => {
    expect(
      titleNamesVenueElsewhere("Wednesday at one two three four five London", SAT, ["Los Angeles"]),
    ).toBeNull();
    expect(
      titleNamesVenueElsewhere("Wednesday at one two three four London", SAT, ["Los Angeles"]),
    ).toBe("London");
  });

  it("does not match a city that only ends a longer word", () => {
    expect(titleNamesVenueElsewhere("Wednesday at Club Neoparis", SAT, ["London"])).toBeNull();
  });

  it("returns null for an empty title or a bad night date", () => {
    expect(titleNamesVenueElsewhere("", SAT, ["Los Angeles"])).toBeNull();
    expect(
      titleNamesVenueElsewhere("Sports Night Wednesday at SCALA London", "11/14/2026", [
        "Los Angeles",
      ]),
    ).toBeNull();
  });
});
