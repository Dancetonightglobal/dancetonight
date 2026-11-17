// D-100: the pure checks of a model read's prices, free entry and age limit against the listing's
// own part of the page (src/domain/stated-facts.ts). The page lines are the saved pages' own
// (docs/briefs/data/pages-run33, evals/links/pages); each case fails when its rule is broken.
import { describe, expect, it } from "vitest";

import { rawListingSchema } from "@/src/domain/listing";
import {
  cancelledClause,
  checkListingFacts,
  indoorOutdoorClause,
  levelClause,
  musicianSentence,
  organizerFromNeighbour,
  partnerClause,
  moneyMentions,
  writesAge,
  writesFree,
} from "@/src/domain/stated-facts";

const listing = (fields: Record<string, unknown>) =>
  rawListingSchema.parse({ title: "Social", listing_type: "social", styles: [], ...fields });
const price = (amount: number | null, label = "door", includes: string | null = null) => ({
  label,
  amount,
  currency: "USD",
  includes,
});
const check = (fields: Record<string, unknown>, ...texts: string[]) =>
  checkListingFacts(listing(fields), texts);
const tiers = (fields: Record<string, unknown>, ...texts: string[]) =>
  check(fields, ...texts).listing.prices.map((p) => [p.amount, p.label]);

describe("moneyMentions: what the page writes as money", () => {
  const amounts = (text: string) => moneyMentions(text).map((m) => m.amount);
  it("reads an amount with its mark before or after it, never a bare number or a clock time", () => {
    expect(amounts("10$ before 10pm")).toEqual([10]);
    expect(amounts("9:30pm-10:30pm")).toEqual([]);
    expect(amounts("Studio 3, 2nd floor, 21 people")).toEqual([]);
    expect(amounts("€12 / 8 € réduit")).toEqual([12, 8]);
    expect(amounts("15 dollars at the door")).toEqual([15]);
    expect(amounts("¥3,000")).toEqual([3000]);
    expect(amounts("$27.22")).toEqual([27.22]);
  });
  it("reads a range as both its ends, and a slashed second amount as its own", () => {
    expect(moneyMentions("General – $20-25").map((m) => [m.amount, m.range])).toEqual([
      [20, [20, 25]],
      [25, [20, 25]],
    ]);
    expect(amounts("$10 to $20")).toEqual([10, 20]);
    expect(amounts("$15/20")).toEqual([15, 20]);
  });
  it("reads no link target, no saving, and an amount split by the page's cleaning as one", () => {
    expect(amounts("Tickets [https://example.com/e/2026/$50-off]")).toEqual([]);
    expect(amounts("**Includes a coupon for $5 off liquor")).toEqual([]);
    expect(amounts("Each full-day admission offers up to a $5 discount.")).toEqual([]);
    expect(amounts("Students & Young Adults 16–18 ( M ust S how ID) – $1 0")).toEqual([10]);
  });
});

describe("prices: an amount stands only where the listing's own part writes it", () => {
  it("drops an amount the part does not write, and puts nothing in its place", () => {
    expect(tiers({ prices: [price(20)] }, "$15 For Everyone")).toEqual([]);
    expect(tiers({ prices: [price(20)] }, "Tango Y Te\nAll levels are welcome!")).toEqual([]);
  });

  it("keeps the read's tier where the page writes it beside the amount", () => {
    expect(
      tiers(
        { prices: [price(25, "Early bird"), price(30, "advance"), price(35)] },
        "INDIVIDUAL TICKETS: $25 Early Bird // $30 in advance // $35 at the door",
      ),
    ).toEqual([
      [25, "Early bird"],
      [30, "advance"],
      [35, "door"],
    ]);
  });

  it("files a swapped tier under the words beside its own amount (critic, attack 1 B)", () => {
    expect(
      tiers(
        { prices: [price(15, "Students"), price(10, "General")] },
        "🎟️ Admission $15 ($10 Students)",
      ),
    ).toEqual([
      [15, "Admission"],
      [10, "Students"],
    ]);
  });

  it("takes the page's tier from beside the amount, not a heading over several", () => {
    const table: Array<[string, number, string]> = [
      ["$15 for: General Public", 15, "General Public"],
      ["$10 - General Public", 10, "General Public"],
      ["Admission: $20 with class or without class", 20, "Admission"],
      ["Students: $15 with or without class", 15, "Students"],
      ["INDIVIDUAL TICKETS: $29 Early Bird // $35 in advance // $39 at the door", 29, "Early Bird"],
      ["INDIVIDUAL TICKETS: $29 Early Bird // $35 in advance // $39 at the door", 39, "door"],
      ["Door price $30 – Cash only at the door.", 30, "door"],
      ["$29 – Early Bird Tickets (Sept 7th to Oct 16th)", 29, "Early Bird Tickets"],
      ["$15 Verified College Students (must submit online)", 15, "Verified College Students"],
      ["Full-time Students: $10 (one dance); $15 (both dances)", 15, "Full-time Students"],
      ["Cover: $15 in advance / $20 at the door", 20, "door"],
      ["Tickets: General Admission $50 early bird / $60 regular", 50, "General Admission"],
      ["10$ before 10pm", 10, "before 10pm"],
      ["Free ~ $5 donation", 5, "donation"],
      // Link targets are no words of the tier (critic: "DJ nights [https://…").
      ["$25 Advance (Oct 20th to 29th) [https://example.com/tickets?tier=vip]", 25, "advance"],
    ];
    for (const [line, amount, label] of table) {
      expect([line, tiers({ prices: [price(amount, "zz members")] }, line)]).toEqual([
        line,
        [[amount, label]],
      ]);
    }
  });

  it("leaves a read's label that names no tier as it is", () => {
    expect(tiers({ prices: [price(15, "price")] }, "$15 for General Public")).toEqual([
      [15, "price"],
    ]);
    expect(
      tiers({ prices: [price(30, "Tickets")] }, "\\$30: Tickets [https://example.com/]"),
    ).toEqual([[30, "Tickets"]]);
    // A list line's title and borough are not a tier.
    expect(
      checkListingFacts(listing({ title: "El Baile", prices: [price(20, "price")] }), [
        "12a El Baile $20 Queens [https://salsanewyork.com/event/el-baile]",
      ]).listing.prices.map((p) => p.label),
    ).toEqual(["price"]);
  });

  it("lists one end of a range as the range, picked by the tier's words", () => {
    const double = [
      "Members: $15-20 (one dance); $25-40 (both dances)",
      "Non-members: $20-25 (one dance); $35-50 (both dances)",
      "Full-time Students: $10 (one dance); $15 (both dances)",
    ].join("\n");
    expect(tiers({ prices: [price(15, "Members"), price(20, "Non-members")] }, double)).toEqual([
      [null, "Members, $15 to $20"],
      [null, "Non-members, $20 to $25"],
    ]);
    // Both ends read as two prices are one row.
    expect(
      tiers({ prices: [price(20, "General"), price(25, "General")] }, "General – $20-25"),
    ).toEqual([[null, "General, $20 to $25"]]);
  });

  it("keeps a sum with no amount only where the part writes its words", () => {
    expect(
      tiers({ prices: [price(null, "Suggested donation")] }, "$25 suggested donation."),
    ).toEqual([[null, "Suggested donation"]]);
    expect(tiers({ prices: [price(null, "Pay what you can")] }, "$15 for General Public")).toEqual(
      [],
    );
  });

  it("keeps the page's clause as the evidence of a kept price, and none for a dropped one", () => {
    const kept = check(
      { prices: [price(10, "General Public")], evidence: { prices: "$15 For Everyone" } },
      "$10 for General Public\nFREE for Stepping Out Studios students",
    ).listing;
    expect(kept.evidence.prices).toBe("$10 for General Public");
    const gone = check(
      { prices: [price(20)], evidence: { prices: "$20" }, confidence: { prices: 0.9 } },
      "$15 For Everyone",
    ).listing;
    expect(gone.evidence.prices).toBeUndefined();
    expect(gone.confidence.prices).toBeUndefined();
  });
});

describe("includes: what a price comes with stands only as the page writes it (F17)", () => {
  const includes = (fields: Record<string, unknown>, ...texts: string[]) =>
    check(fields, ...texts).listing.prices.map((p) => p.includes);
  it("drops another tier's name or another amount given as an inclusion", () => {
    expect(
      includes(
        { prices: [price(25, "Early bird", "Early Bird"), price(30, "advance", "Advance")] },
        "INDIVIDUAL TICKETS: $25 Early Bird // $30 in advance // $35 at the door",
      ),
    ).toEqual([null, null]);
    expect(
      includes(
        { prices: [price(15, "door", "($10 w/ student ID)")] },
        "$15 ($10 w/ student ID) for DJ nights",
      ),
    ).toEqual([null]);
  });
  it("keeps an inclusion the page writes with an inclusion word, in a line above too", () => {
    expect(
      includes(
        { prices: [price(20, "Early Bird", "entry to event & dance lesson")] },
        "GENERAL ADMISSION: includes entry to event & dance lesson\n$20 Early Bird (thru Oct 19th)",
      ),
    ).toEqual(["entry to event & dance lesson"]);
    expect(
      includes(
        { prices: [price(15, "Admission", "a free beginner lesson at 8pm")] },
        "Admission $15 (includes a free beginner lesson at 8pm)",
      ),
    ).toEqual(["a free beginner lesson at 8pm"]);
  });
});

describe("free entry", () => {
  it("reads free entry, not a free lesson, free parking or a free prize", () => {
    const yes = [
      "Admission: Free ($10 donation suggested)",
      "Free ~ $5 donation",
      "No cover : Tip the Teach : Tip the Band : 1 Drink",
      "Entry is free but you do want to register here.",
      "This event is free!",
      "Free entry with RSVP",
    ];
    const no = [
      "8:30pm - 9pm FREE Intro lesson with Cari Westbrook",
      "free SWING DANCE LESSON at 8:30pm",
      "free gin tastings of AVONTUUR GIN led by owner Stew Edge",
      "Free street parking on Sunday",
      "and a chance to win a free dance class!",
      "FREE CLASS RAFFLE 10% OFF",
      "😷 Masks are optional and available free at the door!",
      "Free Pre-Fram Swing DJ Workshop Thursday 1/29! [https://frimframjam.com/workshop]",
      // Free for one tier is that tier's price, not a free night.
      "Children U nder 10 – FREE",
      "FREE for Stepping Out Studios students",
      "Free for members. Guests pay at the door.",
      // Free things that are not entry (adversarial review, 2026-10-04).
      "Parking: free",
      "Coat check: free",
      "Beginner lesson at 7pm – FREE",
      "Smoke-free event",
      "Step-free entrance via the ramp",
      "Beginner lesson at no charge",
    ];
    expect(yes.filter((l) => !writesFree(l))).toEqual([]);
    expect(no.filter((l) => writesFree(l))).toEqual([]);
  });

  it("keeps a free night only where every amount the part charges is a donation or a tip", () => {
    const cps = check(
      { is_free: true },
      "Admission: Free ($10 donation suggested)\nDonations: Accepted in person or online",
    ).listing;
    expect(cps.is_free).toBe(true);
    expect(cps.evidence.is_free).toBe("Admission: Free ($10 donation suggested)");
    // Free for students only is a tier, not the night (critic, attack 1 C).
    const ballroom = check(
      { is_free: true, prices: [price(10, "General Public")] },
      "$10 for General Public\nFREE for Stepping Out Studios students",
    ).listing;
    expect(ballroom.is_free).toBe(false);
    // A charge beside a word that is no donation's: "optional" belongs to the coat check.
    expect(
      check({ is_free: true }, "No cover before 11pm. $20 after 11pm, optional coat check").listing
        .is_free,
    ).toBeNull();
    expect(check({ is_free: true }, "More information to come.").listing.is_free).toBeNull();
  });

  it("keeps a free tier where the page writes it free for that tier", () => {
    expect(
      tiers(
        { prices: [price(10, "General Public"), price(0, "Stepping Out Studios students")] },
        "$10 for General Public\nFREE for Stepping Out Studios students",
      ),
    ).toEqual([
      [10, "General Public"],
      [0, "Stepping Out Studios students"],
    ]);
    expect(tiers({ prices: [price(0, "door")] }, "reservation for tables")).toEqual([]);
    // Free for students is not free for everyone.
    expect(
      tiers(
        { prices: [price(0, "General Public")] },
        "$10 for General Public\nFREE for Stepping Out Studios students",
      ),
    ).toEqual([]);
  });

  it("sets 'not free' from what the part charges, never from the read alone", () => {
    expect(check({ is_free: false, prices: [price(20)] }, "Tango Y Te").listing.is_free).toBe(null);
    expect(check({ is_free: false, prices: [price(20)] }, "$15 For Everyone").listing.is_free).toBe(
      false,
    );
    // A free tier kept beside a charge is no free night: the write path must not read it as one.
    expect(
      check(
        { is_free: true, prices: [price(0, "students")] },
        "FREE for students with ID; $10 general admission",
      ).listing.is_free,
    ).toBe(false);
    // A range that stood is a charge.
    expect(
      check({ is_free: false, prices: [price(15, "Members")] }, "Members: $15-20").listing.is_free,
    ).toBe(false);
    expect(check({ is_free: false, prices: [price(15)] }, "$15 For Everyone").listing.is_free).toBe(
      false,
    );
  });
});

describe("age limit", () => {
  it("reads an age limit as the page writes it, and never the bar's rule", () => {
    expect(writesAge(21, "21+ only w/ID")).toBe(true);
    expect(writesAge(21, "All ages // 21+ to drink (IDs checked)")).toBe(false);
    expect(writesAge(0, "All ages // 21+ to drink (IDs checked)")).toBe(true);
    expect(writesAge(0, "this event is ALL AGES / No Bar or Food")).toBe(true);
    expect(writesAge(18, "18 and over")).toBe(true);
    expect(writesAge(21, "21-and-over")).toBe(true);
    expect(writesAge(21, "Over-21 crowd")).toBe(true);
    expect(writesAge(21, "No one under 21 admitted")).toBe(true);
    expect(writesAge(18, "Must be 18 to enter")).toBe(true);
    expect(writesAge(18, "$18+ fees")).toBe(false);
    expect(writesAge(21, "Doors 9pm, 21 Ludlow St")).toBe(false);
    expect(writesAge(0, "Subway Swing: A Boogie for the Ages")).toBe(false);
  });

  it("drops an age the part does not write, and quotes the page's line for one it does", () => {
    const gone = check({ age_min: 21, confidence: { age_min: 0.8 } }, "Admission: Free").listing;
    expect([gone.age_min, gone.confidence.age_min]).toEqual([null, undefined]);
    const kept = check(
      { age_min: 21, evidence: { age_min: "21+" } },
      "THE DL\n21+ only w/ID\n7pm",
    ).listing;
    expect([kept.age_min, kept.evidence.age_min]).toEqual([21, "21+ only w/ID"]);
  });
});

describe("checkListingFacts", () => {
  it("leaves a listing with no part of the page as it is", () => {
    const l = listing({ prices: [price(20)], age_min: 21 });
    expect(checkListingFacts(l, [])).toEqual({ listing: l, changes: [] });
  });

  it("names each change", () => {
    const { changes } = check({ prices: [price(20), price(15)], age_min: 0 }, "$15 For Everyone");
    expect(changes).toEqual([
      { field: "prices", kind: "dropped", detail: "$20 door" },
      { field: "prices", kind: "relabelled", detail: "$15 door as Everyone" },
      { field: "age_min", kind: "dropped", detail: "all ages" },
    ]);
  });
});

describe("includes: a tier repeated as an inclusion", () => {
  it("is dropped, even with an inclusion word in it", () => {
    const l = checkListingFacts(
      listing({
        prices: [{ label: "student_id", amount: 20, currency: "USD", includes: "with student ID" }],
      }),
      ["$25 ($20 w/ student ID) for Live Band Nights"],
    ).listing;
    expect(l.prices.map((p) => [p.amount, p.includes])).toEqual([[20, null]]);
  });
});

// The adversarial review of 2026-10-04: each case was a wrong fact kept or a correct one lost.
describe("review, 2026-10-04", () => {
  it("files swapped tiers on one comma clause by the words on their own side", () => {
    expect(
      tiers({ prices: [price(15, "door"), price(20, "advance")] }, "Advance $15, door $20"),
    ).toEqual([
      [15, "advance"],
      [20, "door"],
    ]);
    expect(
      tiers({ prices: [price(15, "students"), price(10, "general")] }, "$15 general, students $10"),
    ).toEqual([
      [15, "general"],
      [10, "students"],
    ]);
    expect(tiers({ prices: [price(20, "members")] }, "Non-members $20, members $25")).toEqual([
      [20, "Non-members"],
    ]);
  });

  it("reads no age from a count, the bar's rule or a price tier", () => {
    const no: Array<[number, string]> = [
      [21, "Celebrating over 21 years of swing dancing"],
      [18, "Instructor with over 18 years of experience"],
      [18, "over 18 hours of music"],
      [18, "at least 18 couples"],
      [21, "21+ to consume alcohol"],
      [21, "Must be 21+ to be served"],
      [21, "Bar: 21+ with valid ID"],
      [21, "21+ wristband for drinks"],
      [65, "Seniors 65+ $10"],
    ];
    expect(no.filter(([age, line]) => writesAge(age, line))).toEqual([]);
  });

  it("reads no count or length as the top of a range", () => {
    const amounts = (text: string) => moneyMentions(text).map((m) => [m.amount, m.range]);
    expect(amounts("$10 - 45 minute beginner lesson")).toEqual([[10, null]]);
    expect(amounts("Cover $15 – 20 DJs all night")).toEqual([[15, null]]);
    expect(amounts("Lesson $5 – 30 min")).toEqual([[5, null]]);
    expect(amounts("Cover $5 2 drink min")).toEqual([[5, null]]);
  });

  it("takes the currency from the page's mark", () => {
    const l = checkListingFacts(listing({ prices: [price(15, "door")] }), [
      "Entrée 15 € à la porte",
    ]).listing;
    expect(l.prices.map((p) => [p.amount, p.currency])).toEqual([[15, "EUR"]]);
    // A range in a currency this module cannot name is written as the page writes it.
    const dkk = checkListingFacts(
      listing({ prices: [{ label: "Medlemmer", amount: 80, currency: null, includes: null }] }),
      ["Medlemmer 80-100 kr"],
    ).listing;
    expect(dkk.prices.map((p) => p.label)).toEqual(["Medlemmer, 80-100 kr"]);
  });

  it("keeps a tier written in a parenthesis that a slash runs through", () => {
    expect(
      tiers(
        { prices: [price(20, "Early Bird"), price(20, "Late Night")] },
        "$20 Early Bird (thru Oct 19th)\nplus Late Night after 10pm ($20 / door only)",
      ),
    ).toEqual([
      [20, "Early Bird"],
      [20, "Late Night"],
    ]);
  });

  it("cuts no clause inside a parenthesis", () => {
    expect(tiers({ prices: [price(15, "seniors")] }, "$15 (students / seniors)")).toEqual([
      [15, "seniors"],
    ]);
  });

  it("files a free row with no tier under the tier the page writes free", () => {
    expect(
      tiers(
        { prices: [price(0, "price"), price(10, "price")] },
        "$10 for General Public\nFREE for Stepping Out Studios students",
      ),
    ).toEqual([
      [0, "Stepping Out Studios students"],
      [10, "price"],
    ]);
  });

  it("names no tier by a date, a time, a place, a link, a person or another title", () => {
    const relabel = (line: string, title = "Social") =>
      checkListingFacts(listing({ title, prices: [price(15, "zz members")] }), [line], {
        others: ["Bachata Night"],
      }).listing.prices.map((p) => p.label);
    expect(relabel("Tickets [https://ex.com/t] $15")).toEqual(["price"]);
    expect(relabel("Saturday Oct 10: $15")).toEqual(["price"]);
    expect(relabel("Oct 10 $15")).toEqual(["price"]);
    expect(relabel("Brooklyn: $15")).toEqual(["price"]);
    expect(relabel("240 West 37th St: $15")).toEqual(["price"]);
    expect(relabel("Salsa Night at Club Cache $15")).toEqual(["Salsa Night at Club Cache"]);
    expect(relabel("with DJ Joe Smith $15")).toEqual(["price"]);
    expect(relabel("Get tickets at eventbrite.com $15")).toEqual(["price"]);
    expect(relabel("9pm–2am $15")).toEqual(["price"]);
    expect(relabel("Bachata Night $15")).toEqual(["price"]);
    expect(relabel("Location:\n$15")).toEqual(["price"]);
  });
});

describe("cancelled (D-101)", () => {
  it("stands where the part says the night is off", () => {
    const yes: Array<[string, string]> = [
      ["Lindyland Dance Party", "Lindyland Dance Party\n\nThis event has been postponed"],
      ["Gotham Jazz", "Gotham Jazz\n\nNo Gotham Jazz this week due to a buyout of the venue"],
      ["Salsa Night", "Salsa Night\nCANCELLED due to the storm"],
      ["Salsa Night", "Tonight's social is called off."],
      ["Salsa Night", "Salsa Night will not take place this Friday"],
    ];
    expect(yes.filter(([title, text]) => cancelledClause(text, title) === null)).toEqual([]);
  });

  it("never stands on a conditional", () => {
    const no = [
      "Eileen's Note: This event can be cancelled/postponed at the last moment due to weather/heat/etc.",
      "Events may be added or cancelled so be sure to check out our Dance Calendar",
      "DJ Dance- Pending Postponement/. Central Park Swings is an afternoon of music",
      "Eileen's Note: Site says pending postponement, so check centralparkswings.com",
      "Rain date if cancelled: Sunday",
      "Cancellation policy: no refunds",
      "No refunds on cancelled tickets unless the event is cancelled",
    ];
    expect(no.filter((text) => cancelledClause(text, "Central Park Swings") !== null)).toEqual([
      // "unless the event is cancelled" is conditional, but "cancelled tickets" before it is not
      // about the night either: a known limit, kept rather than guessed at.
      "No refunds on cancelled tickets unless the event is cancelled",
    ]);
  });

  it("drops a cancellation the part does not write, and quotes the page for one it does", () => {
    const gone = check(
      { title: "Central Park Swings", cancelled: true, evidence: { cancelled: "postponed" } },
      "Central Park Swings\nEileen’s Note: This event can be cancelled/postponed at the last moment due to weather.",
    );
    expect(gone.listing.cancelled).toBeNull();
    expect(gone.listing.evidence.cancelled).toBeUndefined();
    expect(gone.changes).toEqual([{ field: "cancelled", kind: "dropped", detail: "cancelled" }]);
    const kept = check(
      { title: "Lindyland Dance Party", cancelled: true },
      "Lindyland Dance Party\n\nThis event has been postponed",
    ).listing;
    expect([kept.cancelled, kept.evidence.cancelled]).toEqual([
      true,
      "This event has been postponed",
    ]);
  });
});

describe("the place and the crowd (D-102)", () => {
  it("reads indoors or outdoors only where the part says so, never from a shoe rule", () => {
    expect(indoorOutdoorClause("outdoor", "Salsa Dura Outdoor Social in Central Park")).toBe(
      "Salsa Dura Outdoor Social in Central Park",
    );
    expect(indoorOutdoorClause("outdoor", "Swing in the park, rain or shine!")).not.toBeNull();
    expect(indoorOutdoorClause("outdoor", "Open-air milonga on the pier")).not.toBeNull();
    expect(indoorOutdoorClause("indoor", "No outdoor shoes on the dance floor")).toBeNull();
    expect(indoorOutdoorClause("outdoor", "No outdoor shoes on the dance floor")).toBeNull();
    expect(indoorOutdoorClause("indoor", "Please bring indoor dance shoes")).toBeNull();
    // A venue that sounds outdoors is no word of the page's: King Jagiello Plaza, a bandshell.
    expect(
      indoorOutdoorClause("outdoor", "Our Sunday events are held at King Jagiello Plaza."),
    ).toBeNull();
    expect(indoorOutdoorClause("both", "Indoor ballroom and an outdoor terrace")).toBe(
      "Indoor ballroom and an outdoor terrace",
    );
    expect(indoorOutdoorClause("both", "Indoor ballroom")).toBeNull();
  });

  it("drops an indoor or outdoor the part does not write, and quotes the page for one it does", () => {
    const studio = check(
      { indoor_outdoor: "indoor", evidence: { indoor_outdoor: "studio" } },
      "Robins Argentine Tango Practica\nTime: 9:30pm - 11:30pm",
    );
    expect(studio.listing.indoor_outdoor).toBeNull();
    expect(studio.listing.evidence.indoor_outdoor).toBeUndefined();
    expect(studio.changes).toEqual([
      { field: "indoor_outdoor", kind: "dropped", detail: "indoor" },
    ]);
    const park = check(
      { indoor_outdoor: "outdoor" },
      "Swing at Bryant Park\nOutdoors on the lawn, weather permitting",
    ).listing;
    expect([park.indoor_outdoor, park.evidence.indoor_outdoor]).toEqual([
      "outdoor",
      "Outdoors on the lawn, weather permitting",
    ]);
  });

  it("keeps a dress code only beside a dress word, every word of it written", () => {
    const keep = (dress: string, text: string) =>
      check({ dress_code: dress }, text).listing.dress_code;
    expect(keep("casual", "Sock Hop Sundays\nDress is casual.")).toBe("casual");
    expect(keep("vintage attire", "Costumes (any style), or vintage attire encouraged!")).toBe(
      "vintage attire",
    );
    // Sock Hop's "casual" is not Swing Remix's; "casual" with no dress word is not a dress code.
    expect(keep("casual", "Swing Remix\nThe Brooks Prumo Orchestra!")).toBeNull();
    expect(keep("casual", "A casual practice for all levels")).toBeNull();
    expect(keep("business casual", "Dress is casual.")).toBeNull();
  });

  it("keeps a floor or a crowd only where every word of it is written", () => {
    const floor = (value: string, text: string) => check({ floor: value }, text).listing.floor;
    expect(floor("sprung", "Beautiful venue! Gorgeous sprung dance floor!")).toBe("sprung");
    expect(floor("wood", "3x sets from 8:15 to 12:15 (wood floors)")).toBe("wood");
    expect(floor("ground floor", "YSBD – 37 W 26th St, 2nd floor, NYC")).toBeNull();
    expect(floor("wood", "Lindy hop & jam at this quirky antique lounge")).toBeNull();
    const crowd = (value: string, text: string) =>
      check({ crowd_size_hint: value }, text).listing.crowd_size_hint;
    expect(crowd("moderate", "Lindy hop & jam at this quirky antique lounge")).toBeNull();
    expect(crowd("200 dancers", "Expect a crowd of 200 dancers")).toBe("200 dancers");
  });
});

describe("a line's heading names every amount on it (D-102 review)", () => {
  const double = [
    "Members: $15-20 (one dance); $25-40 (both dances)",
    "Non-members: $20-25 (one dance); $35-50 (both dances)",
    "Full-time Students: $10 (one dance); $15 (both dances)",
  ].join("\n");
  it("files a tier's second price under the line's heading, not the first $15 on the page", () => {
    expect(
      tiers(
        {
          prices: [
            price(10, "Full-time Students"),
            price(15, "Full-time Students"),
            price(35, "Non-members"),
          ],
        },
        double,
      ),
    ).toEqual([
      [10, "Full-time Students"],
      [15, "Full-time Students"],
      [null, "Non-members, $35 to $50"],
    ]);
  });
  it("leaves a generic heading out", () => {
    expect(
      tiers(
        { prices: [price(30, "zz members")] },
        "INDIVIDUAL TICKETS: $25 Early Bird // $30 in advance // $35 at the door",
      ),
    ).toEqual([[30, "advance"]]);
  });
});

// The adversarial review of D-102, 2026-10-05: each case was a wrong fact kept or a right one lost.
describe("review of D-102, 2026-10-05", () => {
  it("never lets a line's heading confirm another clause's tier", () => {
    const cases: Array<[string, number, string, string]> = [
      ["Members: $10 / Guests: $15", 15, "members", "Guests"],
      ["Couples: $25; singles $15", 15, "couples", "singles"],
      ["Seniors: $8; adults $12", 12, "seniors", "adults"],
      ["Students: $10. $15 at the door.", 15, "students", "door"],
      // A heading names nothing past its sentence: the $15 has no tier of the page's.
      ["Students: $10. $15.", 15, "students", "price"],
    ];
    for (const [line, amount, read, page] of cases) {
      expect([line, tiers({ prices: [price(amount, read)] }, line)]).toEqual([
        line,
        [[amount, page]],
      ]);
    }
  });

  it("names no amount by a heading that is no tier", () => {
    const label = (line: string) =>
      tiers({ prices: [price(15, "general admission")] }, line).map(([, l]) => l);
    expect(label("Note: bring water; $15 cover")).toEqual(["cover"]);
    expect(label("Doors: 7:30pm | $15")).toEqual(["price"]);
    expect(label("Beginner lesson at 7:30pm; social 8:30-11pm. $15")).toEqual(["price"]);
    expect(label("Tickets at https://x.com/t; $15")).toEqual(["price"]);
    expect(label("Club Cache: 221 Main; $15")).toEqual(["price"]);
    expect(label("DJ Joe: spinning all night; $15")).toEqual(["price"]);
  });

  it("reads no indoor or outdoor from a shoe rule, a negation or a rain plan", () => {
    const no: Array<["indoor" | "outdoor", string]> = [
      ["outdoor", "Please do not wear shoes that have been worn outdoors."],
      ["outdoor", "Outdoor-soled shoes are not allowed"],
      ["outdoor", "Bring a change of shoes - no outdoor ones on the floor"],
      ["indoor", "Bring clean indoor-only shoes"],
      ["indoor", "In case of rain, the dance moves indoors to the gym."],
      ["indoor", "Not indoors this time! We're in the park."],
      ["outdoor", "Patio open weather permitting"],
    ];
    expect(no.filter(([v, line]) => indoorOutdoorClause(v, line) !== null)).toEqual([]);
  });

  it("keeps a crowd only with its number, and never on a cue word alone", () => {
    const crowd = (value: string, text: string) =>
      check({ crowd_size_hint: value }, text).listing.crowd_size_hint;
    expect(crowd("50 dancers", "Dancers of all levels welcome")).toBeNull();
    expect(crowd("~80 people", "Bring your people!")).toBeNull();
    expect(crowd("dancers", "Dancers of all levels welcome")).toBeNull();
    expect(crowd("80 people", "Room for 80 people on the floor")).toBe("80 people");
  });

  it("keeps a floor or a dress code only as the page writes it, not a street, a storey or a negation", () => {
    const floor = (value: string, text: string) => check({ floor: value }, text).listing.floor;
    expect(floor("wood", "Studio 4, 123 Wood St, 2nd floor")).toBeNull();
    expect(floor("concrete", "Concrete Jungle Bar, 4th floor")).toBeNull();
    expect(floor("2nd floor", "YSBD – 37 W 26th St, 2nd floor, NYC")).toBeNull();
    expect(floor("wood floor", "Note: the floor is not wood")).toBeNull();
    expect(floor("sprung floor", "Sadly no sprung floor here")).toBeNull();
    expect(floor("sprung", "Beautiful venue! Gorgeous sprung dance floor!")).toBe("sprung");
    expect(floor("ground floor", "Ground floor studio, step-free entrance")).toBeNull();
    const dress = (value: string, text: string) =>
      check({ dress_code: value }, text).listing.dress_code;
    expect(dress("formal attire", "Dress: casual, no formal attire required")).toBeNull();
    expect(dress("cocktail", "Cocktail hour 7-8pm. Dress to impress")).toBeNull();
    expect(dress("masks", "Please wear a mask")).toBeNull();
    expect(dress("comfortable shoes", "Wear comfortable shoes")).toBeNull();
    expect(dress("no dress code", "No dress code - come as you are")).toBe("no dress code");
    // "none" is read as unknown before any check (the schema's NOTHING_WORDS).
  });
});

describe("level and partner (D-103)", () => {
  it("reads a level only as the page writes it, never a price's 'advance'", () => {
    expect(levelClause("Advanced", "Advance tickets: $20")).toBeNull();
    expect(levelClause("Advanced", "Advance: $15 / Door: $20")).toBeNull();
    expect(levelClause("Advanced", "ADVANCE: $20")).toBeNull();
    expect(levelClause("Advanced", "advance registration required")).toBeNull();
    expect(
      levelClause("Advanced", "Three classes every time\nBeginner, intermediate and advance ."),
    ).toBe("Beginner, intermediate and advance .");
    expect(
      levelClause("Beginner", "Learn the fundamentals of WCS in progressive classes"),
    ).toBeNull();
    expect(
      levelClause("All levels", "Argentine Practica for all levels, no partner necessary."),
    ).not.toBeNull();
    expect(levelClause("Beginner", "No experience required!")).toBe("No experience required!");
    expect(
      levelClause("Intermediate", "Contra Connections 2: An Intermediate Contra Dance Workshop"),
    ).not.toBeNull();
    expect(levelClause("Moderate", "Lindy hop & jam at this quirky antique lounge")).toBeNull();
    expect(levelClause("Beginner and intermediate", "Beginner lesson at 8pm")).toBeNull();
  });

  it("reads 'partner needed' only where the page says so and never says the opposite", () => {
    expect(partnerClause(true, "Contra is a partnered dance")).toBeNull();
    expect(partnerClause(true, "Bring a partner!")).toBe("Bring a partner!");
    expect(partnerClause(true, "Couples only")).toBe("Couples only");
    // Curly apostrophes and "no need to" (the critic's cases).
    expect(partnerClause(true, "You don\u2019t need a partner")).toBeNull();
    expect(partnerClause(false, "You don\u2019t need a partner")).toBe("You don't need a partner");
    expect(partnerClause(true, "No need to bring a partner")).toBeNull();
    expect(partnerClause(false, "No need to bring a partner")).toBe("No need to bring a partner");
    expect(
      partnerClause(false, "Argentine Practica for all levels, no partner necessary."),
    ).not.toBeNull();
    expect(partnerClause(false, "Both individuals and couples are welcome.")).not.toBeNull();
    expect(partnerClause(false, "Partners rotate throughout the class")).not.toBeNull();
    expect(partnerClause(false, "Learn the fundamentals of WCS in progressive classes")).toBeNull();
  });

  it("drops a level or partner the part does not write, and quotes the page for one it does", () => {
    const gone = check(
      { level: "Beginner", partner_required: false, confidence: { level: 0.9 } },
      "Class West Coast Swing with Jes Ann Nail\nLearn the fundamentals of WCS in progressive classes",
    );
    expect([
      gone.listing.level,
      gone.listing.partner_required,
      gone.listing.confidence.level,
    ]).toEqual([null, null, undefined]);
    expect(gone.changes.map((c) => c.field)).toEqual(["level", "partner_required"]);
    const kept = check(
      { level: "All levels", partner_required: false },
      "Robins Argentine Tango Practica\nDescription: Argentine Practica for all levels, no partner necessary. Please come and ask for help or feedback.",
    ).listing;
    expect([kept.level, kept.partner_required, kept.evidence.partner_required]).toEqual([
      "All levels",
      false,
      "Description: Argentine Practica for all levels, no partner necessary.",
    ]);
  });
});

describe("music (D-104)", () => {
  it("keeps a named DJ or band only where the part names them whole", () => {
    expect(
      musicianSentence("DJ Andrius", "Gordon Webster Band – in the Ballroom\nDJ Andrius", "dj"),
    ).toBe("DJ Andrius");
    expect(musicianSentence("Andrius", "DJ ANDRIUS (5pm to 12am)", "dj")).toBe(
      "DJ ANDRIUS (5pm to 12am)",
    );
    expect(
      musicianSentence("The Hot Toddies", "Featuring the Hot Toddies Jazz Band", "band"),
    ).not.toBeNull();
    expect(
      musicianSentence("DJ Ryan Swift", "Featuring the Hot Toddies Jazz Band", "dj"),
    ).toBeNull();
    expect(musicianSentence("Joe", "Jonokuchi and the Revisionists", "dj")).toBeNull();
  });

  it("keeps a generic DJ or band only where the part writes a DJ or band word", () => {
    expect(musicianSentence("DJ", "9:00pm – 12:00am DJ Dance", "dj")).toBe(
      "9:00pm – 12:00am DJ Dance",
    );
    expect(musicianSentence("DJ", "Featuring the Hot Toddies Jazz Band", "dj")).toBeNull();
    expect(musicianSentence("live band", "Doors at 7:30pm; 9pm-12:30am (Band)", "band")).toBe(
      "9pm-12:30am (Band)",
    );
    expect(musicianSentence("live band", "Forest Park Bandshell", "band")).toBeNull();
    // A name is matched whole, as words: one of its words, or a name inside a word, is not it.
    expect(musicianSentence("Hot Toddies", "Hot Club of Brooklyn", "band")).toBeNull();
    expect(musicianSentence("DJ Ann", "DJ Annie spins", "dj")).toBeNull();
  });

  it("drops what the part does not write, keeps what it does, and quotes the page", () => {
    const { listing: l, changes } = check(
      {
        music: {
          djs: ["DJ"],
          bands: ["Hot Toddies Jazz Band"],
          genre_mix: "swing, jump_blues, hot_jazz",
        },
      },
      "Big Band Swing Concert\nFeaturing the Hot Toddies Jazz Band\nWe play Swing, Jump Blues, Hot Jazz, Latin Cha Chas.",
    );
    expect(l.music).toEqual({
      djs: [],
      bands: ["Hot Toddies Jazz Band"],
      genre_mix: "swing, jump_blues, hot_jazz",
    });
    expect(changes).toEqual([{ field: "music", kind: "dropped", detail: "DJ" }]);
    expect(l.evidence.music).toBe(
      "Featuring the Hot Toddies Jazz Band / We play Swing, Jump Blues, Hot Jazz, Latin Cha Chas.",
    );
    const mix = check(
      { music: { djs: [], bands: [], genre_mix: "salsa and bachata" } },
      "Kizomba all night",
    );
    expect(mix.listing.music.genre_mix).toBeNull();
  });

  it("matches a mix compactly: the page's DooWop and Rock-n-Roll are the read's doo-wop", () => {
    // Sock Hop Sundays, as the TWIS page writes it on 2026-10-05.
    const page =
      "Sock Hop Sundays\nCelebrating our 23rd year of great dance music from the 50's & 60's including Rock-n-Roll, Motown, DooWop, Soul and R&B.";
    for (const genre_mix of [
      "50's & 60's rock-n-roll, motown, doo-wop, soul and r&b",
      "rock n roll, doo wop",
    ]) {
      const { listing: l, changes } = check({ music: { djs: [], bands: [], genre_mix } }, page);
      expect(changes).toEqual([]);
      expect(l.music.genre_mix).toBe(genre_mix);
      expect(l.evidence.music).toMatch(/^Celebrating our 23rd year/);
    }
    // The page's two words stand for the read's one.
    const split = check(
      { music: { djs: [], bands: [], genre_mix: "doowop, rocknroll" } },
      "Sock Hop Sundays\nDoo Wop and Rock n Roll all night.",
    );
    expect(split.changes).toEqual([]);
    // A joined form never stands for a word the page does not write.
    const wrong = check({ music: { djs: [], bands: [], genre_mix: "doo-wop, disco" } }, page);
    expect(wrong.listing.music.genre_mix).toBeNull();
  });
});

describe("an organiser stands unless the page writes it only in other listings' parts (D-105)", () => {
  // Two parts: Tango's (offsets 0 to 60) and Salsa's (60 to the end); a site line after both.
  const PAGE =
    "Tango Social\nJoin host Ana Ruiz for tango.        \n".padEnd(60, " ") +
    "Salsa Night\nSalsa all night, $10.\n" +
    "About us: we run a social every night here.";
  const parts = [
    { start: 0, end: 60, own: false },
    { start: 60, end: 95, own: true },
  ];
  const ctx = (over: Partial<Parameters<typeof organizerFromNeighbour>[1]> = {}) => ({
    pageUrl: "https://dancehallnyc.com/events",
    pageText: PAGE,
    own: ["Salsa Night\nSalsa all night, $10."],
    parts: () => parts,
    ...over,
  });
  const org = (name: string, url: string | null = null) => ({ name, url });

  it("withdraws a name written only inside another listing's part", () => {
    expect(organizerFromNeighbour(org("Ana Ruiz"), ctx())).toBe(true);
    expect(organizerFromNeighbour(org("ana  ruiz"), ctx())).toBe(true);
  });

  it("keeps it when the site, the own part or the rest of the page vouches for it", () => {
    // Its link is on the page's own site.
    expect(organizerFromNeighbour(org("Ana Ruiz", "https://dancehallnyc.com/ana"), ctx())).toBe(
      false,
    );
    // Its name is the site's, though the page writes it only in Tango's part.
    const named = ctx({ pageText: PAGE.replace("Ana Ruiz", "Dance Hall") });
    expect(
      organizerFromNeighbour(org("Dance Hall"), { ...named, pageUrl: "https://dancehall.com/" }),
    ).toBe(false);
    expect(organizerFromNeighbour(org("Dance Hall"), named)).toBe(true);
    // The own part writes it, on a line its offsets do not cover (a heading above the title).
    expect(
      organizerFromNeighbour(org("Ana Ruiz"), ctx({ own: ["Ana Ruiz presents\nSalsa Night"] })),
    ).toBe(false);
    // The span lies in the own part too (two parts overlap).
    expect(
      organizerFromNeighbour(
        org("Ana Ruiz"),
        ctx({ parts: () => [...parts, { start: 0, end: 60, own: true }] }),
      ),
    ).toBe(false);
    // Written once more, outside every part.
    const twice = ctx({ pageText: `${PAGE} Ana Ruiz hosts on Fridays.` });
    expect(organizerFromNeighbour(org("Ana Ruiz"), twice)).toBe(false);
    // Not written at all: unknown, not proven wrong.
    expect(organizerFromNeighbour(org("Robin Thomas"), ctx())).toBe(false);
    expect(
      organizerFromNeighbour(org("Ana"), ctx({ pageText: PAGE.replace("Ana Ruiz", "Anabel") })),
    ).toBe(false);
  });
});
