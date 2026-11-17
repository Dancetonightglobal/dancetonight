import { describe, expect, it } from "vitest";

import {
  listingTypeFromText,
  pricePhrase,
  quoteAround,
  readClock,
  timesFromText,
  placeStartTime,
} from "@/src/domain/text-facts";

describe("listingTypeFromText", () => {
  it.each([
    ["Salsa Social at Copacabana", "social"],
    ["Beginner Bachata Class", "class"],
    ["Thursday Milonga", "social"],
    ["Tango Practica", "practica"],
    ["Lindy Hop jam", "jam"],
    ["West Coast Swing lesson + social", "social"],
    ["DJ night: reggaeton", "club_night"],
    ["Swing dance in the park", "outdoor_public"],
    ["Boston Tango Marathon", "festival_session"],
    ["Soirée rock", "social"],
  ])("reads %s as %s", (title, type) => {
    expect(listingTypeFromText(title).type).toBe(type);
  });

  it("says other, with no evidence, when the words do not say", () => {
    expect(listingTypeFromText("Weekly meetup")).toEqual({ type: "other", evidence: null });
  });

  it("reads the description when the title does not say", () => {
    expect(
      listingTypeFromText("Thursdays at the Loft", "A beginner class for new dancers").type,
    ).toBe("class");
  });

  it("reads a party as a social when a partner-dance style is named", () => {
    expect(
      listingTypeFromText("Kizomba Fridays", "Class at 9pm, party from 10:30pm", ["kizomba"]).type,
    ).toBe("social");
    expect(listingTypeFromText("Reggaeton party", null, ["reggaeton"]).type).toBe("club_night");
    expect(listingTypeFromText("Saturday party").type).toBe("club_night");
  });

  it("uses a style that is a listing type by name", () => {
    expect(listingTypeFromText("Thursdays", null, ["milonga"]).type).toBe("social");
  });
});

describe("times the words state", () => {
  it("reads a lesson time and a dancing time with their evidence", () => {
    const facts = timesFromText("Beginner lesson at 7pm, social dancing from 8:30 until late.");
    expect(facts.lesson).toBe("19:00");
    expect(facts.dancing).toBe("20:30");
    expect(facts.evidence.lesson_time).toContain("lesson at 7pm");
  });

  it("reads French and 24-hour times", () => {
    expect(timesFromText("Cours à 20h, bal à 21h30")).toMatchObject({
      lesson: "20:00",
      dancing: "21:30",
    });
  });

  it("returns nothing when no time is attached to a word", () => {
    expect(timesFromText("Doors open early. See you there")).toMatchObject({
      lesson: null,
      dancing: null,
    });
  });

  it("reads clocks the way a dance is scheduled", () => {
    expect(readClock("9")).toBe("21:00");
    expect(readClock("12", "00", "am")).toBe("00:00");
    expect(readClock("12", "30", "pm")).toBe("12:30");
    expect(readClock("21", "30", "h")).toBe("21:30");
    expect(readClock("25")).toBeNull();
  });
});

describe("pricePhrase", () => {
  it("finds the phrase that states a price", () => {
    expect(
      pricePhrase("Beginner lesson at 7pm. $15 at the door, $10 students. See you")?.phrase,
    ).toBe("$15 at the door, $10 students");
    expect(pricePhrase("Free entry! Bring friends")?.phrase).toBe("Free entry");
    expect(pricePhrase("Entrée 12 € avec cours")?.phrase).toBe("12 € avec cours");
  });

  it("finds free only when it is about entry (positive cases)", () => {
    // Shape 1: free + entry word
    expect(pricePhrase("Free entry! Bring friends")?.phrase).toBe("Free entry");
    expect(pricePhrase("FREE ADMISSION all night")?.phrase).toBe("FREE ADMISSION all night");
    expect(pricePhrase("This social is free to attend")?.phrase).toBe("social is free to attend");
    expect(pricePhrase("Free of charge for everyone")?.phrase).toBe("Free of charge for everyone");
    expect(pricePhrase("Free to enter the venue")?.phrase).toBe("Free to enter the venue");
    expect(pricePhrase("Free for all dancers")?.phrase).toBe("Free for all dancers");
    expect(pricePhrase("Free and open to the public")?.phrase).toBe("Free and open to the public");
    // Shape 2: entry word + is/are/:/–/- + free
    expect(pricePhrase("Admission: Free ($10 donation suggested)")?.phrase).toBe(
      "Admission: Free ($10 donation suggested)",
    );
    expect(pricePhrase("Entry is free but you do want to register here")?.phrase).toBe(
      "Entry is free but you do want to register here",
    );
    expect(pricePhrase("Cover - FREE")?.phrase).toBe("Cover - FREE");
    expect(pricePhrase("Tickets are free for students")?.phrase).toBe(
      "Tickets are free for students",
    );
    expect(pricePhrase("Price: free")?.phrase).toBe("Price: free");
    expect(pricePhrase("Event – free")?.phrase).toBe("Event – free");
    // Shape 3: free at start of line followed by !, ~, (, or end
    expect(pricePhrase("Free ~ $5 donation")?.phrase).toBe("Free ~ $5 donation");
    expect(pricePhrase("Doors 8pm\nFREE!\nAll levels")?.phrase).toBe("FREE");
    expect(pricePhrase("Free! Bring your friends")?.phrase).toBe("Free");
    expect(pricePhrase("Free (donations accepted)")?.phrase).toBe("Free (donations accepted)");
  });

  it("does not match free when it is not about entry", () => {
    expect(
      pricePhrase('Wear socks, "Phone Free" and remove all jewellery before the session'),
    ).toBeNull();
    expect(
      pricePhrase("We continue to have free high-quality masks available at the door"),
    ).toBeNull();
    expect(pricePhrase("Free street parking on Sunday")).toBeNull();
    expect(
      pricePhrase("8:30pm - 9pm FREE Intro lesson with Maren, then social dancing. $15 at the door")
        ?.phrase,
    ).toBe("$15 at the door");
    expect(
      pricePhrase("Raffle at 10:45pm (prizes: free group classes, free party admission)"),
    ).toBeNull();
    expect(pricePhrase("free gin tastings all night")).toBeNull();
    expect(pricePhrase("freestyle social")).toBeNull();
    expect(pricePhrase("gluten-free snacks")).toBeNull();
    expect(pricePhrase("carefree vibes")).toBeNull();
  });

  it("finds nothing when no price is stated", () => {
    expect(pricePhrase("Come dance with us")).toBeNull();
  });
});

describe("a structured start and the words' times (D-191)", () => {
  it("drops dancing when a range opens at the start (Friday case)", () => {
    const text =
      "Friday Night | 7:00PM–9:45PM Fruit Social: 9:45PM–10:15PM Gospel Oak / Tufnell Park";
    const said = timesFromText(text);
    expect(said.dancing).toBe("21:45"); // sanity
    const result = placeStartTime("social", "19:00", said, text);
    expect(result.dancing).toBeNull();
    expect(result.doors).toBe("19:00");
    expect(result.lesson).toBeNull();
  });

  it("drops a lesson and dancing earlier than the start (Saturday case)", () => {
    const text =
      "7:00PM–9:45PM Ecstatic Dance & Cacao 9:45PM–10:15PM Fruit Social 5:50PM-7:00PM Shaking Medicine Workshop (+optional SHAKING MEDICINE workshop 5:50pm-7pm)";
    const said = timesFromText(text);
    expect(said).toMatchObject({ lesson: "17:50", dancing: "17:50" }); // sanity
    const result = placeStartTime("social", "19:00", said, text);
    expect(result).toEqual({ doors: "19:00", lesson: null, dancing: null });
  });

  it("keeps lesson and dancing when they are after start", () => {
    const text = "Doors 8pm, salsa lesson at 8:30pm, social dancing from 9:30pm";
    const said = timesFromText(text);
    const result = placeStartTime("social", "20:00", said, text);
    expect(result.lesson).toBe("20:30");
    expect(result.dancing).toBe("21:30");
    expect(result.doors).toBe("20:00");
  });

  it("keeps dancing for a class with range", () => {
    const text = "Class 7pm-9pm, then social dancing from 9pm";
    const said = timesFromText(text);
    const result = placeStartTime("class", "19:00", said, text);
    expect(result.lesson).toBe("19:00");
    expect(result.dancing).toBe("21:00");
  });

  it("handles past midnight times correctly", () => {
    const text = "Doors 10pm, dancing from 1am";
    const said = timesFromText(text);
    const result = placeStartTime("social", "22:00", said, text);
    expect(result.dancing).toBe("01:00");
    expect(result.doors).toBe("22:00");
  });

  it("keeps a lesson before the start when no range opens at the start (New York Tango)", () => {
    const result = placeStartTime(
      "social",
      "19:00",
      { lesson: "18:00", dancing: null },
      "Class 6-7p",
    );
    expect(result).toEqual({ doors: "19:00", lesson: "18:00", dancing: null });
  });

  it("works without text parameter", () => {
    const said = { lesson: null, dancing: "17:50" };
    const result = placeStartTime("social", "19:00", said);
    expect(result.dancing).toBeNull();
    expect(result.doors).toBe("19:00");
  });
});

describe("quoteAround", () => {
  it("cuts a long text to the evidence cap around the match, on word boundaries", () => {
    const text = `${"word ".repeat(200)}lesson at 7pm ${"more ".repeat(200)}`;
    const quote = quoteAround(text, text.indexOf("lesson"), "lesson at 7pm".length);
    expect(quote.length).toBeLessThanOrEqual(300);
    expect(quote).toContain("lesson at 7pm");
    expect(quote.startsWith("word")).toBe(true);
  });
});
