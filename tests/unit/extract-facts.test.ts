// D-100: a model read's prices, free entry and age limit, checked against the listing's own part of
// the page, on the pages the site read in runs 28 to 33 (evals/links/pages). The reads are shaped as
// run 33's were (docs/briefs/data/run33-facts.json); each case fails when its rule is broken.
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rawExtractionSchema, type RawListing } from "@/src/domain/listing";
import { extractionToHarvested } from "@/src/pipeline/extract";

const page = (name: string) => readFileSync(`evals/links/pages/${name}.txt`, "utf8");
const FETCHED = new Date("2026-09-29T21:20:00Z");
const price = (amount: number | null, label = "door", includes: string | null = null) => ({
  label,
  amount,
  currency: "USD",
  includes,
});
const tiers = (l: RawListing) => l.prices.map((p) => [p.amount, p.label]);

function read(url: string, text: string, listings: Array<Record<string, unknown>>) {
  const extraction = rawExtractionSchema.parse({
    page_kind: "list",
    language: "en",
    listings: listings.map((l) => ({
      listing_type: "social",
      styles: [],
      organizer: {},
      venue: {},
      ...l,
    })),
  });
  const out = extractionToHarvested(extraction, {
    pageUrl: url,
    fetchedAt: FETCHED,
    today: "2026-09-29",
    pageText: text,
  });
  const by = (title: string) => {
    const found = out.listings.find((h) => h.listing.title === title);
    if (!found) throw new Error(`not listed: ${title}`);
    return found.listing;
  };
  return { out, by };
}

describe("Stepping Out: a social keeps only the prices its own part writes (F8)", () => {
  const rules: Record<string, string> = {
    "Friday Night Fever": "Every 1st, 3rd Friday of the month",
    "All Night Milonga": "Every 2nd & last Saturday",
    "Robins Argentine Tango Practica": "Every Thursday",
    "Bachata Rosa": "Every Friday night",
    "Zen Zouk": "Every Wednesdays",
    "Paciencia Milonga": "Every Tuesday",
    "La Vieja Guardia Salsa": "Every 2nd & 4th Sunday of the month",
    "Tango Y Te": "Every Sunday",
    "Ballroom and Smooth Practice": "Every Tuesday",
    "Toda La Noche, Salsa Social": "Every 1st Saturday of the Month",
    "Jimmy Anton Salsa Social": "Every 1st, 3rd, and 5th Sunday (if there is one) of the month",
  };
  // Run 33's rows, as the event pages printed them.
  const reads: Record<string, Record<string, unknown>> = {
    "Tango Y Te": { prices: [price(20)] },
    "Paciencia Milonga": { prices: [price(20)] },
    "La Vieja Guardia Salsa": { prices: [price(20)] },
    "Jimmy Anton Salsa Social": { prices: [price(15, "price")], age_min: 0 },
    "Ballroom and Smooth Practice": {
      prices: [price(15, "price"), price(10, "price")],
      age_min: 0,
      evidence: { prices: "$15 For Everyone" },
    },
    "Bachata Rosa": { prices: [price(10), price(15, "After 10pm")] },
    "Friday Night Fever": { prices: [price(15), price(10, "advance")] },
    "All Night Milonga": { prices: [price(20), price(15, "Students")] },
    "Robins Argentine Tango Practica": { prices: [price(10)] },
    "Zen Zouk": { prices: [price(11)] },
    "Toda La Noche, Salsa Social": { prices: [price(15, "price")], age_min: 0 },
  };
  const { by, out } = read(
    "https://www.steppingoutstudios.com/social-events1",
    page("steppingoutstudios-com-social-events1"),
    Object.keys(rules).map((title) => ({
      title,
      recurrence_text: rules[title],
      ...(reads[title] ?? {}),
    })),
  );

  it("drops a neighbour's amount and puts nothing in its place", () => {
    expect(by("Tango Y Te").prices).toEqual([]);
    expect(by("Paciencia Milonga").prices).toEqual([]);
    expect(by("La Vieja Guardia Salsa").prices).toEqual([]);
    expect(by("Jimmy Anton Salsa Social").prices).toEqual([]);
    // $15 is Tango Y Te's, two titles above; the page writes $10 under Ballroom.
    expect(tiers(by("Ballroom and Smooth Practice"))).toEqual([[10, "price"]]);
  });

  it("files an amount under the page's own words when the read's are not beside it", () => {
    expect(tiers(by("Bachata Rosa"))).toEqual([
      [10, "before 10pm"],
      [15, "After 10pm"],
    ]);
    expect(tiers(by("Friday Night Fever"))).toEqual([
      [15, "General Public"],
      [10, "Current Stepping Out Students"],
    ]);
    expect(tiers(by("All Night Milonga"))).toEqual([
      [20, "Admission"],
      [15, "Students"],
    ]);
    expect(tiers(by("Robins Argentine Tango Practica"))).toEqual([[10, "General Public"]]);
    expect(tiers(by("Zen Zouk"))).toEqual([[11, "General Public"]]);
  });

  it("keeps a price the read gives with no tier, as it gave it", () => {
    expect(tiers(by("Toda La Noche, Salsa Social"))).toEqual([[15, "price"]]);
  });

  it("drops an age the part does not write", () => {
    expect(by("Jimmy Anton Salsa Social").age_min).toBeNull();
    expect(by("Ballroom and Smooth Practice").age_min).toBeNull();
    expect(by("Toda La Noche, Salsa Social").age_min).toBeNull();
  });

  it("keeps the page's own clause as a kept price's evidence, not the read's", () => {
    expect(by("Ballroom and Smooth Practice").evidence.prices).toBe("$10 for General Public");
    expect(by("Friday Night Fever").evidence.prices).toBe(
      "$15 for: General Public / $10 for: Current Stepping Out Students, College Ballroom Team/ Students (With Valid ID), USA Dance Members (With Valid ID)",
    );
    expect(by("Tango Y Te").evidence.prices).toBeUndefined();
    expect(by("Jimmy Anton Salsa Social").evidence.age_min).toBeUndefined();
  });

  it("names every change in the run report", () => {
    const notes = out.notes.join("\n");
    expect(notes).toMatch(
      /listing\(s\) came with facts their part of the page does not write; dropped: .*Tango Y Te \(\$20 door\)/,
    );
    expect(notes).toMatch(
      /filed under the page's: .*Friday Night Fever \(\$15 door as General Public/,
    );
  });
});

describe("This Week in Swing: no entry takes the next entry's price or age (F11)", () => {
  const { by } = read("https://thisweekinswingnyc.com/", page("thisweekinswingnyc-com"), [
    {
      title: "Central Park Swings",
      local_date: "2026-10-11",
      prices: [29, 35, 39].map((a) => price(a, "INDIVIDUAL TICKETS", "Early Bird")),
      age_min: 21,
      is_free: false,
    },
    {
      title: "Lindyland Dance Party",
      local_date: "2026-10-10",
      prices: [29, 35, 39].map((a) => price(a, "INDIVIDUAL TICKETS", "Early Bird")),
      age_min: 21,
    },
    {
      title: "Midtown Swings",
      local_date: "2026-10-06",
      prices: [price(25), price(20, "advance"), price(15, "students")],
    },
    {
      title: "NYLX",
      local_date: "2026-10-09",
      prices: [
        price(25, "Early bird", "Early Bird"),
        price(30, "advance", "Advance"),
        price(35, "door", "At the door"),
      ],
    },
    {
      title: "Frim Fram Jam",
      local_date: "2026-10-08",
      prices: [price(15, "door", "($10 w/ student ID)")],
    },
    { title: "Gotham Jazz", local_date: "2026-10-07", prices: [price(0, "door")], is_free: true },
    {
      title: "Positively Swingin",
      local_date: "2026-10-07",
      prices: [price(0, "Cover", "Tip the Teach : Tip the Band : 1 Drink")],
      is_free: true,
    },
    {
      title: "New York Lindy Exchange",
      local_date: "2026-10-10",
      prices: [price(39, "INDIVIDUAL TICKETS", "Early Bird"), price(45, "INDIVIDUAL TICKETS")],
    },
  ]);

  it("drops the neighbours' prices and ages", () => {
    expect(by("Central Park Swings").prices).toEqual([]);
    expect(by("Central Park Swings").age_min).toBeNull();
    expect(by("Central Park Swings").is_free).toBeNull();
    expect(by("Lindyland Dance Party").prices).toEqual([]);
    expect(by("Lindyland Dance Party").age_min).toBeNull();
  });

  it("keeps each entry's own tiers, in its own words", () => {
    expect(tiers(by("Midtown Swings"))).toEqual([
      [25, "General"],
      [20, "Danznik Members"],
      [15, "students"],
    ]);
    expect(tiers(by("NYLX"))).toEqual([
      [25, "Early bird"],
      [30, "advance"],
      [35, "door"],
    ]);
    expect(tiers(by("New York Lindy Exchange"))).toEqual([
      [39, "Early Bird"],
      [45, "advance"],
    ]);
  });

  it("drops a free night the part does not write, and keeps one it does", () => {
    expect(by("Gotham Jazz").prices).toEqual([]);
    expect(by("Gotham Jazz").is_free).toBeNull();
    expect(by("Positively Swingin").is_free).toBe(true);
    expect(tiers(by("Positively Swingin"))).toEqual([[0, "Cover"]]);
  });

  it("drops an inclusion that is another tier or another amount (F17)", () => {
    expect(by("NYLX").prices.map((p) => p.includes)).toEqual([null, null, null]);
    expect(by("Frim Fram Jam").prices.map((p) => p.includes)).toEqual([null]);
    expect(by("New York Lindy Exchange").prices.map((p) => p.includes)).toEqual([null, null]);
  });
});

describe("CDNY: a range stays a range; the site's table is not a dance's price (F14)", () => {
  const { by } = read("https://cdny.org/", page("cdny-org"), [
    {
      title: "ENGLISH - TUESDAYS",
      local_date: "2026-09-29",
      prices: [price(25, "General"), price(20, "CDNY/CDSS/FMSNY members")],
    },
    {
      title: "CONTRA - SATURDAYS",
      local_date: "2026-10-03",
      prices: [price(15, "General"), price(20, "CDNY/CDSS/FMSNY members")],
    },
    {
      title: "SPECIAL DOUBLE CONTRA DANCE",
      local_date: "2026-10-10",
      prices: [price(15, "Members"), price(20, "Non-members"), price(10, "Full-time Students")],
    },
  ]);

  it("drops the prices of dances whose own part writes none", () => {
    expect(by("ENGLISH - TUESDAYS").prices).toEqual([]);
    expect(by("CONTRA - SATURDAYS").prices).toEqual([]);
  });

  it("lists one end of a range as the range, chosen by the tier's own words", () => {
    expect(tiers(by("SPECIAL DOUBLE CONTRA DANCE"))).toEqual([
      [null, "Members, $15 to $20"],
      [null, "Non-members, $20 to $25"],
      [10, "Full-time Students"],
    ]);
  });
});

describe("This Week in Swing: prices written after the entry's ticket link are its own (F11)", () => {
  // The critic's case: "TICKETS [eventbrite]" comes before Jazz & Gin's price list. The part a
  // time is read from ends at that link; the part a price is read from does not.
  const { by } = read("https://thisweekinswingnyc.com/", page("thisweekinswingnyc-com"), [
    {
      title: "Jazz & Gin: Speakeasy Soiree",
      local_date: "2026-10-30",
      prices: [price(20, "Early Bird"), price(25, "advance"), price(30, "Full Price")],
    },
    {
      title: "The Salon: Halloween Stomp 2026",
      local_date: "2026-10-31",
      prices: [price(29, "Early Bird Tickets")],
      age_min: 0,
    },
  ]);
  it("keeps them", () => {
    expect(tiers(by("Jazz & Gin: Speakeasy Soiree"))).toEqual([
      [20, "Early Bird"],
      [25, "advance"],
      [30, "Full Price"],
    ]);
  });
  it("keeps what is written more than 1,500 characters under the title, before the next date (D-106)", () => {
    expect(tiers(by("The Salon: Halloween Stomp 2026"))).toEqual([[29, "Early Bird Tickets"]]);
    // Known limit: "All ages" is printed under a repeat of the date ("Saturday, October 31st,
    // 2026"), a date heading, which ends the part.
    expect(by("The Salon: Halloween Stomp 2026").age_min).toBeNull();
  });
});

describe("a part never takes in a skipped neighbour's facts (review, 2026-10-04)", () => {
  it("ends at the ticket link when the next card's link or date-and-time line follows it", () => {
    const page = [
      "Salsa Night",
      "Fri, Oct 9, 9:00 PM",
      "Free entry",
      "Get Tickets [https://example.com/salsa]",
      "",
      "Tango Social",
      "Sat, Oct 10, 8:00 PM",
      "$20 at the door, 21+",
      "Get Tickets [https://example.com/tango]",
    ].join("\n");
    const { by } = read("https://example.com/", page, [
      {
        title: "Salsa Night",
        local_date: "2026-10-09",
        is_free: true,
        age_min: 21,
        prices: [price(20)],
      },
    ]);
    expect(by("Salsa Night").prices).toEqual([]);
    expect(by("Salsa Night").age_min).toBeNull();
    expect(by("Salsa Night").is_free).toBe(true);
    const plain = [
      "Salsa Night",
      "Friday 9pm–2am",
      "Club Cache",
      "Tickets [https://example.com/salsa]",
      "",
      "Bachata Social",
      "Friday 10pm–3am",
      "$15 at the door · 21+",
      "Tickets [https://example.com/bachata]",
    ].join("\n");
    const other = read("https://example.com/", plain, [
      { title: "Salsa Night", local_date: "2026-10-09", age_min: 21, prices: [price(15)] },
    ]);
    expect(other.by("Salsa Night").prices).toEqual([]);
    expect(other.by("Salsa Night").age_min).toBeNull();
  });

  it("ends at the ticket link when the next card's date-and-time line follows, with no link", () => {
    const page = [
      "Salsa Night",
      "Club Cache",
      "Tickets [https://example.com/salsa]",
      "",
      "Fri, Oct 9, 10:00 PM",
      "Bachata Social at Club Rio: $15 at the door, 21+",
    ].join("\n");
    const { by } = read("https://example.com/", page, [
      { title: "Salsa Night", local_date: "2026-10-09", age_min: 21, prices: [price(15)] },
    ]);
    expect(by("Salsa Night").prices).toEqual([]);
    expect(by("Salsa Night").age_min).toBeNull();
  });

  it("reads no price or age from the words before the title on its line", () => {
    const { by } = read(
      "https://example.com/",
      "Fri 9pm Salsa Night 21+ $20 · Sat 10pm Bachata Night $15 [https://example.com/b]",
      [
        { title: "Salsa Night", local_date: "2026-10-09" },
        { title: "Bachata Night", local_date: "2026-10-10", age_min: 21, prices: [price(20)] },
      ],
    );
    expect(by("Bachata Night").prices).toEqual([]);
    expect(by("Bachata Night").age_min).toBeNull();
  });
});

describe("This Week in Swing: no entry takes another's place, dress or crowd (D-102)", () => {
  const { by } = read("https://thisweekinswingnyc.com/", page("thisweekinswingnyc-com"), [
    {
      title: "Josh Lee and the Extended Family",
      local_date: "2026-09-30",
      indoor_outdoor: "indoor",
      floor: "wood",
      dress_code: "casual",
      crowd_size_hint: "moderate",
    },
    {
      title: "Glenn Crytzer Quintet at Jaywalker",
      local_date: "2026-10-04",
      dress_code: "casual",
      floor: "cement",
    },
    { title: "Central Park Swings", local_date: "2026-10-11", indoor_outdoor: "outdoor" },
  ]);
  it("drops what the entry does not write and keeps what it does", () => {
    // Josh Lee dances on an outdoor plaza; the read called it indoor, wood and casual.
    expect(by("Josh Lee and the Extended Family")).toMatchObject({
      indoor_outdoor: null,
      floor: null,
      dress_code: null,
      crowd_size_hint: null,
    });
    // "Dress is casual" is Sock Hop's, further down the page; the cement floor is Jaywalker's own.
    expect(by("Glenn Crytzer Quintet at Jaywalker")).toMatchObject({
      dress_code: null,
      floor: "cement",
    });
    expect(by("Glenn Crytzer Quintet at Jaywalker").evidence.floor).toBe(
      "3,000 square feet of dance space with smooth cement",
    );
    // King Jagiello Plaza is outdoors, but the entry never says so (D-084 question 6).
    expect(by("Central Park Swings").indoor_outdoor).toBeNull();
  });
});

describe("Stepping Out: an organiser written only in a neighbour's part is withdrawn (D-105)", () => {
  const rules: Record<string, string> = {
    "Tango Y Te": "Every Sunday",
    "Ballroom and Smooth Practice": "Every Tuesday",
    "Toda La Noche, Salsa Social": "Every 1st Saturday of the Month",
    "Zen Zouk": "Every Wednesdays",
    "Robins Argentine Tango Practica": "Every Thursday",
    "Paciencia Milonga": "Every Tuesday",
  };
  // Run 33's organisers, and three the page does not prove wrong.
  const organizers: Record<string, { name: string; url?: string }> = {
    "Tango Y Te": { name: "Maria Jose Sosa" },
    "Ballroom and Smooth Practice": { name: "Maria Jose Sosa" },
    "Toda La Noche, Salsa Social": { name: "Nicholas Messina" },
    "Zen Zouk": { name: "Stepping Out Studios" },
    "Robins Argentine Tango Practica": { name: "Robin Thomas" },
    "Paciencia Milonga": {
      name: "Nicholas Messina",
      url: "https://www.steppingoutstudios.com/about",
    },
  };
  const { by, out } = read(
    "https://www.steppingoutstudios.com/social-events1",
    page("steppingoutstudios-com-social-events1"),
    Object.keys(rules).map((title) => ({
      title,
      recurrence_text: rules[title],
      organizer: organizers[title],
      evidence: { organizer: organizers[title]!.name },
    })),
  );
  const harvested = (title: string) => out.listings.find((h) => h.listing.title === title)!;

  it("withdraws Tango Y Te's host from the Ballroom practice, and keeps her on Tango Y Te", () => {
    expect(by("Ballroom and Smooth Practice").organizer).toEqual({ name: null, url: null });
    expect(by("Ballroom and Smooth Practice").evidence.organizer).toBeUndefined();
    expect(harvested("Ballroom and Smooth Practice").organizerWithdrawn).toBe(true);
    expect(by("Tango Y Te").organizer?.name).toBe("Maria Jose Sosa");
    expect(harvested("Tango Y Te").organizerWithdrawn).toBeUndefined();
    expect(out.notes.join("\n")).toMatch(/Ballroom and Smooth Practice \(Maria Jose Sosa\)/);
  });

  it("keeps an organiser its own part, the site's name or the site's link vouches for", () => {
    // Toda La Noche's part: "Hosted and Organized by Nicholas Messina".
    expect(by("Toda La Noche, Salsa Social").organizer?.name).toBe("Nicholas Messina");
    // Written only in other listings' parts, but the site's own name.
    expect(by("Zen Zouk").organizer?.name).toBe("Stepping Out Studios");
    // Nicholas Messina is written only in Toda La Noche's part, but this link is on the site.
    expect(by("Paciencia Milonga").organizer?.name).toBe("Nicholas Messina");
  });

  it("keeps an organiser the page never writes: unknown is not proven wrong", () => {
    expect(by("Robins Argentine Tango Practica").organizer?.name).toBe("Robin Thomas");
    expect(harvested("Robins Argentine Tango Practica").organizerWithdrawn).toBeUndefined();
  });
});

describe("a directory page's written facts stand (run 43, D-106)", () => {
  const page = [
    "Sunday, October 4",
    "",
    "Central Park Swings",
    "",
    "Admission: Free ($10 donation suggested)",
    "4:00pm – 6:30pm",
    "",
    "Friday, October 9",
    "",
    "NYLX",
    "",
    "7:30pm to 12am",
    "INDIVIDUAL TICKETS: $25 Early Bird // $30 in advance // $35 at the door",
    "",
    "Saturday, October 10",
    "",
    "New York Lindy Exchange",
    "",
    "8pm to 1am",
    "INDIVIDUAL TICKETS: $39 Early Bird // $45 in advance // $49 at the door",
    "PRO TIP: Best ticket pricing available via NYLX Packages",
    "this event is ALL AGES / No Bar or Food (water provided)",
    "",
    "Monday, October 12",
    "",
    "Back Room Speakeasy Sessions",
    "",
    "Doors at 7:30pm; 9pm-12:30am (Band)",
    "",
    "Tuesday, October 13",
    "",
    "Midtown Swings",
    "",
    "$25 General",
    "$20 Danznik Members",
  ].join("\n");
  const { by } = read("https://thisweekinswingnyc.com/", page, [
    { title: "Central Park Swings", local_date: "2026-10-04", is_free: true, prices: [price(0)] },
    { title: "NYLX", local_date: "2026-10-09" },
    { title: "New York Lindy Exchange", local_date: "2026-10-10", age_min: 0 },
    {
      title: "Back Room Speakeasy Sessions",
      local_date: "2026-10-12",
      prices: [price(25, "General"), price(20, "Danznik Members")],
    },
    { title: "Midtown Swings", local_date: "2026-10-13" },
  ]);
  it("keeps a free door price where the part writes free admission", () => {
    expect(tiers(by("Central Park Swings"))).toEqual([[0, "door"]]);
  });
  it("reads past another title written inside a sentence", () => {
    expect(by("New York Lindy Exchange").age_min).toBe(0);
  });
  it("still drops amounts only the next listing writes", () => {
    expect(by("Back Room Speakeasy Sessions").prices).toEqual([]);
  });
  it("still ends at another title written inline when the title is not on a line of its own", () => {
    const inline = ["Salsa Night 9pm $10 then Tango Social 8pm, all ages", "", "Tango Social"].join(
      "\n",
    );
    const { by: byInline } = read("https://example.com/", inline, [
      { title: "Salsa Night", local_date: "2026-10-09", age_min: 0 },
      { title: "Tango Social", local_date: "2026-10-09" },
    ]);
    expect(byInline("Salsa Night").age_min).toBeNull();
  });
});
