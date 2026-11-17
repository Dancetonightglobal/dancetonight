import { describe, expect, it } from "vitest";

import {
  EVIDENCE_MAX_CHARS,
  familiesOf,
  listingSchema,
  meanConfidence,
  rawExtractionSchema,
  normalizeStatedEndTime,
  normalizeStatedTime,
  rawListingSchema,
  type Listing,
} from "@/src/domain/listing";

const base: Listing = {
  id: "e1",
  slug: "frim-fram-jam-2026-09-24",
  title: "Frim Fram Jam",
  listingType: "social",
  styles: ["lindy_hop", "blues"],
  families: ["swing"],
  doorsAt: null,
  lessonAt: new Date("2026-09-25T00:00:00Z"),
  dancingAt: new Date("2026-09-25T01:00:00Z"),
  endsAt: new Date("2026-09-25T05:00:00Z"),
  startsAt: new Date("2026-09-25T01:00:00Z"),
  nightDate: "2026-09-24",
  tz: "America/New_York",
  venue: {
    id: "v1",
    name: "You Should Be Dancing...!",
    location: { lat: 40.7498, lng: -73.9953 },
    address: {
      line1: "412 8th Ave",
      line2: null,
      locality: "New York",
      region: "NY",
      postcode: "10001",
      countryCode: "US",
      formatted: null,
    },
    neighborhood: "Chelsea",
    googlePlaceId: null,
    kind: "studio",
    danceFloor: "yes",
  },
  organizer: { name: "Frim Fram Jam", websiteUrl: "https://frimframjam.com", socials: {} },
  prices: [{ label: "Social only", amount: 15, currency: "USD", includes: null }],
  isFree: false,
  ticketUrl: null,
  level: "All levels",
  partnerRequired: false,
  ageMin: null,
  dressCode: null,
  floor: "Wood",
  indoorOutdoor: "indoor",
  music: { djs: [], bands: [], genreMix: "DJ swing", liveMusic: false },
  crowdSizeHint: null,
  recurrenceText: "Every Thursday",
  confirmation: "confirmed_today",
  confidence: 0.9,
  summary: "Thursday lindy hop social.",
  sources: [
    {
      url: "https://frimframjam.com",
      label: "frimframjam.com",
      checkedAt: new Date(),
      byOrganiser: true,
      tier: "organizer",
      eventUrl: null,
    },
  ],
  status: "active",
  canonicalUrl: "https://frimframjam.com",
  distanceKm: null,
  liveStatus: null,
};

describe("listingSchema", () => {
  it("accepts a full listing and fills address defaults", () => {
    const parsed = listingSchema.parse(base);
    expect(parsed.venue?.address?.line2).toBeNull();
    expect(parsed.families).toEqual(["swing"]);
  });

  it("rejects an unknown style key and a family list that misses a style's family", () => {
    expect(listingSchema.safeParse({ ...base, styles: ["not_a_style"] }).success).toBe(false);
    expect(listingSchema.safeParse({ ...base, families: ["tango"] }).success).toBe(false);
  });

  it("only lets http(s) URLs through", () => {
    expect(listingSchema.safeParse({ ...base, ticketUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
    expect(
      listingSchema.safeParse({ ...base, sources: [{ ...base.sources[0], url: "ftp://x" }] })
        .success,
    ).toBe(false);
  });

  it("names each source's tier, and keeps byOrganiser in step with it (D-061, D-072)", () => {
    const source = base.sources[0]!;
    const withSource = (changes: Record<string, unknown>) =>
      listingSchema.safeParse({ ...base, sources: [{ ...source, ...changes }] });
    expect(withSource({ tier: "organizer", byOrganiser: true }).success).toBe(true);
    expect(withSource({ tier: "ticketing", byOrganiser: true }).success).toBe(true);
    expect(withSource({ tier: "listing", byOrganiser: false }).success).toBe(true);
    // A directory is never the organiser, and the organiser's own page always is.
    expect(withSource({ tier: "listing", byOrganiser: true }).success).toBe(false);
    expect(withSource({ tier: "organizer", byOrganiser: false }).success).toBe(false);
    expect(withSource({ tier: "first_party" }).success).toBe(false);
    expect(withSource({ tier: undefined }).success).toBe(false);
  });

  it("derives families from styles in order of first appearance", () => {
    expect(familiesOf(["milonga", "blues", "tango_vals"])).toEqual(["tango", "swing"]);
  });

  it("carries whether the music is live, with null for not listed", () => {
    const live = listingSchema.parse({
      ...base,
      music: { djs: [], bands: [], genreMix: "Live band and caller", liveMusic: true },
    });
    expect(live.music?.liveMusic).toBe(true);
    const unknown = listingSchema.parse({
      ...base,
      music: { djs: [], bands: [], genreMix: null, liveMusic: null },
    });
    expect(unknown.music?.liveMusic).toBeNull();
    expect(
      listingSchema.safeParse({ ...base, music: { djs: [], bands: [], genreMix: null } }).success,
    ).toBe(false);
  });
});

describe("rawListingSchema (PLAN 8.2)", () => {
  it("fills every unknown as null and defaults the maps", () => {
    const parsed = rawListingSchema.parse({
      title: "Milonga La Nacional",
      listing_type: "social",
      styles: ["milonga"],
      local_date: null,
      venue: {},
      organizer: {},
    });
    expect(parsed.doors_time).toBeNull();
    expect(parsed.end_time).toBeNull();
    expect(parsed.venue.name).toBeNull();
    expect(parsed.prices).toEqual([]);
    expect(parsed.is_free).toBeNull();
    expect(parsed.recurrence_text).toBeNull();
    expect(parsed.music).toEqual({ djs: [], bands: [], genre_mix: null });
    expect(parsed.evidence).toEqual({});
    expect(meanConfidence(parsed)).toBeNull();
  });

  it("keeps a number in a text field as text (a model may answer floor: 2)", () => {
    const parsed = rawListingSchema.parse({
      title: "Milonga La Nacional",
      listing_type: "social",
      styles: ["milonga"],
      local_date: null,
      venue: {},
      organizer: {},
      floor: 2,
      level: 3,
      crowd_size_hint: 150,
    });
    expect(parsed.floor).toBe("2");
    expect(parsed.level).toBe("3");
    expect(parsed.crowd_size_hint).toBe("150");
    // NaN/Infinity still fail as before
    expect(
      rawListingSchema.safeParse({
        title: "x",
        listing_type: "social",
        styles: [],
        venue: {},
        organizer: {},
        floor: Number.NaN,
      }).success,
    ).toBe(false);
  });

  it("drops non-http URLs to null instead of failing, and rejects bad times and styles", () => {
    const parsed = rawListingSchema.parse({
      title: "x",
      listing_type: "class",
      styles: ["salsa"],
      local_date: "2026-09-24",
      ticket_url: "javascript:void(0)",
      venue: { url: "mailto:a@b.c" },
      organizer: { url: "https://ok.example" },
      confidence: { title: 0.9, styles: 0.5 },
    });
    expect(parsed.ticket_url).toBeNull();
    expect(parsed.venue.url).toBeNull();
    expect(parsed.organizer.url).toBe("https://ok.example");
    expect(meanConfidence(parsed)).toBeCloseTo(0.7);
    // A style outside the taxonomy is left off, not a failed page (D-057).
    expect(
      rawListingSchema.parse({
        title: "x",
        listing_type: "class",
        styles: ["tap", "salsa"],
        local_date: null,
        venue: {},
        organizer: {},
      }).styles,
    ).toEqual(["salsa"]);
    const times = rawListingSchema.parse({
      title: "x",
      listing_type: "class",
      styles: [],
      local_date: null,
      doors_time: "7:30 PM",
      lesson_time: "7:30",
      dancing_time: "9pm",
      end_time: "01:00:00",
      venue: {},
      organizer: {},
    });
    expect(times).toMatchObject({
      doors_time: "19:30",
      lesson_time: null,
      dancing_time: "21:00",
      end_time: "01:00",
    });
  });

  it("reads stated times without guessing (ingest run 15)", () => {
    expect(normalizeStatedTime("19:30")).toBe("19:30");
    expect(normalizeStatedTime("19:30:00")).toBe("19:30");
    expect(normalizeStatedTime("7:30 PM")).toBe("19:30");
    expect(normalizeStatedTime("7.30pm")).toBe("19:30");
    expect(normalizeStatedTime("12 a.m.")).toBe("00:00");
    expect(normalizeStatedTime("12pm")).toBe("12:00");
    expect(normalizeStatedTime("Noon")).toBe("12:00");
    expect(normalizeStatedTime("midnight")).toBe("00:00");
    // Ambiguous or not a time: unknown, never a guess.
    expect(normalizeStatedTime("7:30")).toBeNull();
    expect(normalizeStatedTime("13pm")).toBeNull();
    expect(normalizeStatedTime("late")).toBeNull();
    expect(normalizeStatedTime("24:00")).toBeNull();
  });

  it("reads a range by its start when the start states its own half of the day (D-060)", () => {
    expect(normalizeStatedTime("8pm-1am")).toBe("20:00");
    expect(normalizeStatedTime("8:30pm - 12:30am")).toBe("20:30");
    expect(normalizeStatedTime("8 PM – 1 AM")).toBe("20:00"); // en dash
    expect(normalizeStatedTime("8pm — 1am")).toBe("20:00"); // em dash
    expect(normalizeStatedTime("8pm to 1am")).toBe("20:00");
    expect(normalizeStatedTime("9 p.m. until late")).toBe("21:00");
    expect(normalizeStatedTime("noon - 4pm")).toBe("12:00");
    // A 24-hour range says so by itself.
    expect(normalizeStatedTime("20:00-01:00")).toBe("20:00");
    // Neither side says which half of the day: unread, and the listing shows "Time not listed".
    expect(normalizeStatedTime("7:30")).toBeNull();
    expect(normalizeStatedTime("8:30 - 12:30")).toBeNull();
    expect(normalizeStatedTime("08:30 - 12:30")).toBeNull();
    expect(normalizeStatedTime("8-11pm")).toBeNull();
    expect(normalizeStatedTime("8 to 11")).toBeNull();
  });

  it("reads a range in the end field by its end, never by its start", () => {
    expect(normalizeStatedEndTime("8pm-1am")).toBe("01:00");
    expect(normalizeStatedEndTime("8:30pm – 12:30am")).toBe("00:30");
    expect(normalizeStatedEndTime("9pm to midnight")).toBe("00:00");
    expect(normalizeStatedEndTime("20:00-01:00")).toBe("01:00");
    expect(normalizeStatedEndTime("2am")).toBe("02:00");
    expect(normalizeStatedEndTime("8pm - late")).toBeNull();
    expect(normalizeStatedEndTime("8:30 - 12:30")).toBeNull();
    expect(normalizeStatedEndTime("8pm-12:30")).toBeNull();
    const parsed = rawListingSchema.parse({
      title: "Salsa",
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
      dancing_time: "9pm-2am",
      end_time: "9pm-2am",
    });
    expect(parsed).toMatchObject({ dancing_time: "21:00", end_time: "02:00" });
  });

  it("treats an omitted local_date as null, like every other unknown", () => {
    const parsed = rawListingSchema.parse({
      title: "Every Thursday swing",
      listing_type: "social",
      styles: ["lindy_hop"],
      venue: {},
      organizer: {},
    });
    expect(parsed.local_date).toBeNull();
  });

  it("cuts an over-long evidence quote to the D-009 cap instead of rejecting the listing", () => {
    const long = "x".repeat(EVIDENCE_MAX_CHARS + 100);
    const parsed = rawListingSchema.parse({
      title: "x",
      listing_type: "class",
      styles: ["salsa"],
      local_date: null,
      venue: {},
      organizer: {},
      evidence: { title: long, level: "short" },
    });
    expect(EVIDENCE_MAX_CHARS).toBe(300);
    expect(parsed.evidence.title).toHaveLength(EVIDENCE_MAX_CHARS);
    expect(parsed.evidence.level).toBe("short");
  });

  it("wraps listings in the page envelope", () => {
    const parsed = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [],
    });
    expect(parsed.page_kind).toBe("list");
    // An unknown page kind is read as "list"; a missing language as undetermined (D-057).
    expect(rawExtractionSchema.parse({ page_kind: "blog", listings: [] })).toMatchObject({
      page_kind: "list",
      language: "und",
    });
  });
});

describe("evidence and confidence written in the wrong shape (D-056)", () => {
  it("drops an unreadable annotation instead of failing the listing", () => {
    const parsed = rawListingSchema.parse({
      title: "Salsa social",
      listing_type: "social",
      styles: ["salsa"],
      local_date: "2026-10-02",
      dancing_time: "9pm",
      venue: { name: "Example Hall" },
      organizer: {},
      evidence: "Friday October 2, dancing 9pm",
      confidence: 0.9,
    });
    expect(parsed.evidence).toEqual({});
    expect(parsed.confidence).toEqual({});
    expect(parsed.dancing_time).toBe("21:00");
  });

  it("keeps a well-formed map, and treats a missing one as empty", () => {
    const base = {
      title: "x",
      listing_type: "social",
      styles: [],
      venue: {},
      organizer: {},
    };
    expect(rawListingSchema.parse({ ...base, evidence: { local_date: "Oct 2" } }).evidence).toEqual(
      { local_date: "Oct 2" },
    );
    expect(rawListingSchema.parse(base).confidence).toEqual({});
  });
});

describe("the lenient readers for replies written without a grammar (ingest run 20, D-057)", () => {
  const base = { title: "Salsa social", venue: {}, organizer: {} };

  it("reads the nested slips run 21 failed pages on", () => {
    const parsed = rawListingSchema.parse({
      ...base,
      music: { djs: [], bands: [], genre_mix: ["salsa", "bachata"] },
      evidence: { title: "Salsa social", dancing_time: null, prices: null },
      confidence: { title: 0.9, is_free: null, prices: 4 },
    });
    expect(parsed.music.genre_mix).toBe("salsa, bachata");
    expect(parsed.evidence).toEqual({ title: "Salsa social" });
    expect(parsed.confidence).toEqual({ title: 0.9 });
    expect(
      rawListingSchema.parse({ ...base, music: { genre_mix: true } }).music.genre_mix,
    ).toBeNull();
  });

  it("reads the slips run 20 failed pages on as unknowns", () => {
    const parsed = rawListingSchema.parse({
      ...base,
      listing_type: "party",
      local_date: "every Tuesday",
      venue: { name: "Example Hall", address: "" },
      prices: [{ label: "door", amount: "$20", currency: "usd", includes: "" }],
    });
    expect(parsed.listing_type).toBe("other");
    expect(parsed.styles).toEqual([]);
    expect(parsed.local_date).toBeNull();
    expect(parsed.venue).toEqual({ name: "Example Hall", address: null, url: null });
    expect(parsed.prices).toEqual([{ label: "door", amount: 20, currency: "USD", includes: null }]);
  });

  it("reads yes/no words, whole numbers, and names, and nothing it cannot", () => {
    const parsed = rawListingSchema.parse({
      ...base,
      listing_type: "social",
      styles: [],
      is_free: "yes",
      partner_required: "maybe",
      age_min: "21",
      indoor_outdoor: "rooftop",
      music: { djs: ["DJ Example", "", 3], bands: "none" },
      prices: [{ amount: "free entry" }],
    });
    expect(parsed).toMatchObject({
      is_free: true,
      partner_required: null,
      age_min: 21,
      indoor_outdoor: null,
      music: { djs: ["DJ Example"], bands: [], genre_mix: null },
    });
    expect(parsed.prices).toEqual([
      { label: "price", amount: null, currency: null, includes: null },
    ]);
  });

  it("leaves out entries with no title and keeps the rest", () => {
    const parsed = rawExtractionSchema.parse({
      page_kind: "list",
      language: "en",
      listings: [{ title: "" }, "junk", { ...base, listing_type: "social", styles: [] }],
    });
    expect(parsed.listings.map((l) => l.title)).toEqual(["Salsa social"]);
  });
});

describe("hour-suffix 24-hour times (D-229)", () => {
  it("reads hour-suffix forms", () => {
    // Accepted examples
    expect(normalizeStatedTime("22h")).toBe("22:00");
    expect(normalizeStatedTime("22 h")).toBe("22:00");
    expect(normalizeStatedTime("22h30")).toBe("22:30");
    expect(normalizeStatedTime("22h00")).toBe("22:00");
    expect(normalizeStatedTime("9h")).toBe("09:00");
    expect(normalizeStatedTime("22hs")).toBe("22:00");
    expect(normalizeStatedTime("22 hs")).toBe("22:00");
    expect(normalizeStatedTime("22:00 hs")).toBe("22:00");
    expect(normalizeStatedTime("21.30 hs")).toBe("21:30");
    expect(normalizeStatedTime("22:00h")).toBe("22:00");
    expect(normalizeStatedTime("22.00 h")).toBe("22:00");
    expect(normalizeStatedTime("22 hrs")).toBe("22:00");
    expect(normalizeStatedTime("22:00 hrs")).toBe("22:00");
    expect(normalizeStatedTime("22:00 hr")).toBe("22:00");
    expect(normalizeStatedTime("22 hs.")).toBe("22:00");
    expect(normalizeStatedTime("21 horas")).toBe("21:00");
  });

  it("rejects invalid hour-suffix forms", () => {
    // Must stay null
    expect(normalizeStatedTime("22")).toBeNull(); // bare number
    expect(normalizeStatedTime("24h")).toBeNull(); // hour out of range
    expect(normalizeStatedTime("25h")).toBeNull(); // hour out of range
    expect(normalizeStatedTime("22h75")).toBeNull(); // minute out of range
    expect(normalizeStatedTime("h22")).toBeNull(); // wrong order
    expect(normalizeStatedTime("22hx")).toBeNull(); // invalid characters
    expect(normalizeStatedTime("22 hours")).toBeNull(); // English word (not in pattern)
    expect(normalizeStatedTime("8:30")).toBeNull(); // no am/pm, should stay null
  });

  it("reads hour-suffix forms in ranges", () => {
    // Ranges with hour-suffix forms
    expect(normalizeStatedTime("22h - 03h")).toBe("22:00");
    expect(normalizeStatedEndTime("22h - 03h")).toBe("03:00");
    expect(normalizeStatedTime("22h30-04h")).toBe("22:30");
    expect(normalizeStatedEndTime("22h30-04h")).toBe("04:00");

    // Ranges where one side has suffix, other doesn't
    expect(normalizeStatedTime("19 - 21 h")).toBeNull(); // start side "19" has no suffix
    expect(normalizeStatedEndTime("19 - 21 h")).toBe("21:00"); // end side has suffix

    // Existing range behavior unchanged
    expect(normalizeStatedTime("de 19 a 21 h")).toBeNull(); // range regex doesn't know "a"
    expect(normalizeStatedTime("8pm - 1am")).toBe("20:00");
    expect(normalizeStatedEndTime("8pm - 1am")).toBe("01:00");
  });
});

describe("stated times that are far too long to be a time (review, 2026-09-28)", () => {
  it("reads nothing from them, quickly", () => {
    const long = "8pm" + " ".repeat(50_000) + "- 1am";
    const started = performance.now();
    expect(normalizeStatedTime(long)).toBeNull();
    expect(normalizeStatedEndTime(long)).toBeNull();
    expect(performance.now() - started).toBeLessThan(50);
    // Ordinary ranges still read.
    expect(normalizeStatedTime("8pm - 1am")).toBe("20:00");
    expect(normalizeStatedEndTime("8pm - 1am")).toBe("01:00");
  });
});
