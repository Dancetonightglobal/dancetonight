import { describe, expect, it } from "vitest";

import { FAMILIES, STYLES, familyLabel } from "@/config/styles";
import { LISTING_TYPE_KEYS } from "@/src/domain/listing-types";
import { en, interpolate, keys, placeholders, plural, t } from "@/src/i18n";
import type { PluralForms, TranslationKey } from "@/src/i18n";

// Copy rules under test (stated in the header of src/i18n/en.ts):
// 1. Every key resolves to a non-empty string with every placeholder filled.
// 2. "Not listed", never "N/A"; none of the generic-events-site phrases DESIGN.md rejects.
// 3. Every string starts with a capital letter, a digit or a placeholder, except the named
//    mid-line fragments that follow a source name on the same line.
// 4. A string ends with a full stop only when it is a sentence: at least three words. A string
//    with an internal sentence break ends with terminal punctuation. Shorter strings (labels,
//    headings, buttons, values) carry no terminal punctuation at all.
// 5. Placeholders are {camelCase}; no stray braces, HTML, double spaces or edge whitespace.

const MID_LINE_FRAGMENTS: ReadonlySet<string> = new Set<TranslationKey>([
  "detail.sources.checked",
  "detail.sources.updated",
]);

type Leaf = string | PluralForms;

function isPluralForms(value: unknown): value is PluralForms {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { one?: unknown }).one === "string" &&
    typeof (value as { other?: unknown }).other === "string"
  );
}

function leafAt(key: string): Leaf {
  let node: unknown = en;
  for (const segment of key.split(".")) {
    node = (node as Record<string, unknown>)[segment];
  }
  if (typeof node === "string" || isPluralForms(node)) return node;
  throw new Error(`not a leaf: ${key}`);
}

// Every rendered string with the key it came from; plural leaves contribute each of their forms.
function everyString(): Array<{ key: string; form: string; text: string }> {
  const out: Array<{ key: string; form: string; text: string }> = [];
  for (const key of keys()) {
    const leaf = leafAt(key);
    if (typeof leaf === "string") {
      out.push({ key, form: "", text: leaf });
    } else {
      for (const form of ["zero", "one", "other"] as const) {
        const text = leaf[form];
        if (text !== undefined) out.push({ key, form, text });
      }
    }
  }
  return out;
}

function sampleParams(text: string): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  for (const name of placeholders(text)) params[name] = name === "count" ? 3 : `<${name}>`;
  return params;
}

const wordCount = (text: string): number => text.trim().split(/\s+/).length;

// "live_music_with_dancing" -> "liveMusicWithDancing", the key shape en.ts uses for listing types.
const camelCase = (snake: string): string =>
  snake.replace(/_([a-z])/g, (_match, letter: string) => letter.toUpperCase());

describe("key coverage", () => {
  it("has the keys the spec and design name", () => {
    const required: TranslationKey[] = [
      "home.header.tonight",
      "home.header.tomorrow",
      "home.header.count",
      "home.location.useExact",
      "home.location.searchPlaceholder",
      "home.location.searchButton",
      "home.location.clearButton",
      "home.segments.social.full",
      "home.segments.social.short",
      "home.segments.clubs.full",
      "home.segments.clubs.short",
      "home.filters.radius",
      "home.filters.free",
      "home.filters.beginnerFriendly",
      "home.filters.lessonIncluded",
      "home.filters.noPartnerNeeded",
      "home.filters.age21",
      "home.filters.liveMusic",
      "home.filters.onNow",
      "home.filters.confirmedOnly",
      "home.sort.startTime",
      "home.sort.distance",
      "home.sort.byStartTime",
      "home.sort.byDistance",
      "home.day.tonight",
      "home.day.tomorrow",
      "home.theme.label",
      "home.theme.system",
      "home.theme.light",
      "home.theme.dark",
      "home.view.list",
      "home.view.map",
      "home.now.marker",
      "home.now.sticky",
      "home.now.backToNow",
      "home.now.jumpToNow",
      "home.empty.quietAfter",
      "home.empty.widened",
      "home.empty.addIt",
      "home.untimed.heading",
      "card.status.startsIn",
      "card.status.startsInEndNotListed",
      "card.status.onNow",
      "card.status.onNowEndNotListed",
      "card.status.endsIn",
      "card.status.ended",
      "card.status.cancelled",
      "card.status.startsAt",
      "card.status.startsAtUntil",
      "card.status.timeNotListed",
      "card.status.timeNotListedUntil",
      "card.stamp.timeNotListed",
      "card.lesson.both",
      "card.price.door",
      "card.price.advance",
      "card.price.free",
      "card.flags.onOrganizerPage",
      "card.flags.onTicketPage",
      "card.flags.listingChecked",
      "card.flags.checkBeforeYouGo",
      "card.flags.noPartnerNeeded",
      "card.flags.recurringUnconfirmed",
      "detail.when.heading",
      "detail.when.doors",
      "detail.when.lesson",
      "detail.when.dancingStarts",
      "detail.when.ends",
      "detail.when.endNotListed",
      "detail.when.timeNotListed",
      "detail.when.timesInZone",
      "detail.when.range",
      "detail.when.rangeEndNotListed",
      "detail.cost.heading",
      "detail.cost.notListed",
      "detail.where.heading",
      "detail.where.parking",
      "detail.where.googleMaps",
      "detail.where.appleMaps",
      "detail.expect.heading",
      "detail.expect.level",
      "detail.expect.partner",
      "detail.expect.age",
      "detail.expect.floor",
      "detail.expect.music",
      "detail.expect.dressCode",
      "detail.expect.crowd",
      "detail.who.heading",
      "detail.sources.heading",
      "detail.sources.checked",
      "detail.sources.conflict",
      "detail.actions.getDirections",
      "detail.actions.getTickets",
      "detail.actions.addToCalendar",
      "detail.actions.share",
      "detail.actions.reportProblem",
      "detail.actions.suggestCorrection",
      "submit.url",
      "submit.text",
      "report.title",
      "correction.title",
      "bot.title",
      "footer.privacy",
      "admin.signIn",
      "errors.generic",
      "offline.title",
      "a11y.nowMarker",
      "a11y.map",
      "a11y.pin",
      "a11y.card",
      "a11y.cardCancelled",
      "a11y.cardNoStatus",
      "common.notListed",
    ];
    const all = new Set<string>(keys());
    for (const key of required) expect(all.has(key), key).toBe(true);
  });

  it("card.types and detail.types each have exactly the ten listing-type keys", () => {
    const expected = [...LISTING_TYPE_KEYS].map(camelCase).sort();
    expect(expected).toHaveLength(10);
    expect(Object.keys(en.card.types).sort()).toEqual(expected);
    expect(Object.keys(en.detail.types).sort()).toEqual(expected);
  });

  it("keeps the status placeholders consistent: {time} starts, {until} ends, {duration} counts", () => {
    // timeNotListedUntil carries the listed end of a listing whose start is not listed (D-060).
    const withUntil = ["onNow", "startsIn", "startsAtUntil", "timeNotListedUntil"];
    for (const [key, text] of Object.entries(en.card.status)) {
      const names = placeholders(text);
      expect(
        names.every((n) => ["time", "until", "duration"].includes(n)),
        key,
      ).toBe(true);
      expect(names.includes("time"), key).toBe(key.startsWith("startsAt"));
      expect(names.includes("duration"), key).toBe(key.startsWith("startsIn") || key === "endsIn");
      expect(names.includes("until"), key).toBe(withUntil.includes(key));
    }
  });

  it("resolves every key to a non-empty string with no placeholder left", () => {
    const all = keys();
    expect(all.length).toBeGreaterThan(200);
    for (const key of all) {
      const leaf = leafAt(key);
      const texts = typeof leaf === "string" ? [leaf] : [leaf.one, leaf.other];
      const params = Object.assign({}, ...texts.map(sampleParams)) as Record<
        string,
        string | number
      >;
      // Keys are typed at compile time; here every key is exercised at runtime.
      const rendered = (t as (k: string, p?: Record<string, string | number>) => string)(
        key,
        params,
      );
      expect(rendered.length, key).toBeGreaterThan(0);
      expect(rendered, key).not.toMatch(/[{}]/);
    }
  });

  it("has no duplicate keys and no leaf that is neither a string nor a plural set", () => {
    const all = keys();
    expect(new Set(all).size).toBe(all.length);
    for (const key of all) expect(() => leafAt(key)).not.toThrow();
  });

  it("throws for an unknown key and for a namespace used as a key", () => {
    const loose = t as (k: string) => string;
    expect(() => loose("home.header.nope")).toThrow(/Unknown UI string key/);
    expect(() => loose("home.header")).toThrow(/does not point at a string/);
  });
});

describe("params", () => {
  it("substitutes every placeholder, including repeats and several in one string", () => {
    expect(t("home.header.tonight", { place: "Williamsburg" })).toBe("Tonight near Williamsburg");
    expect(t("card.status.startsIn", { duration: "18 min", until: "12:30am" })).toBe(
      "Starts in 18 min, until 12:30am",
    );
    expect(t("card.status.startsAtUntil", { time: "9:30pm", until: "1am" })).toBe(
      "Starts at 9:30pm, until 1am",
    );
    expect(t("card.lesson.both", { lesson: "8:00", dancing: "9:00" })).toBe(
      "Lesson 8:00, dancing 9:00",
    );
    expect(
      t("detail.sources.conflict", {
        a: "12:30am",
        b: "1:00am",
        sourceA: "midtownhop.com",
        sourceB: "facebook.com",
      }),
    ).toBe("Ends 12:30am (midtownhop.com), 1:00am (facebook.com)");
    expect(interpolate("{x} and {x}", { x: "1" })).toBe("1 and 1");
  });

  it("inserts values verbatim: no placeholder re-expansion, no replacement patterns, no HTML", () => {
    expect(interpolate("Near {place}", { place: "{count}" })).toBe("Near {count}");
    expect(interpolate("Near {place}", { place: "$& $1 $$" })).toBe("Near $& $1 $$");
    expect(interpolate("Near {place}", { place: "<b>x</b>" })).toBe("Near <b>x</b>");
  });

  it("formats numeric params for English and leaves strings untouched", () => {
    expect(t("home.header.count", { count: 1234 })).toBe("1,234 places to dance");
    // A cluster is named by the count it prints and its venues (D-170).
    expect(t("a11y.pinCluster", { count: 3, venues: "SOB's" })).toBe("3 places, SOB's");
    expect(t("a11y.pin", { time: "9pm", title: "Milonga" })).toBe("9pm, Milonga");
  });

  it("throws on a missing param rather than rendering a hole", () => {
    expect(() => interpolate("Near {place}", {})).toThrow(/Missing param "place"/);
    const loose = t as (k: string, p?: Record<string, string | number>) => string;
    expect(() => loose("home.header.tonight")).toThrow(/Missing param "place"/);
  });

  it("ignores extra params and does not read inherited properties", () => {
    expect(interpolate("Now {time}", { time: "7:42pm", extra: 1 })).toBe("Now 7:42pm");
    expect(() => interpolate("{constructor}", {})).toThrow(/Missing param/);
  });
});

describe("plurals", () => {
  it("picks zero, one and other forms for the count sentence", () => {
    expect(t("home.header.count", { count: 0 })).toBe("No places to dance");
    expect(t("home.header.count", { count: 1 })).toBe("1 place to dance");
    expect(t("home.header.count", { count: 14 })).toBe("14 places to dance");
    expect(t("home.header.count", { count: 2 })).toBe("2 places to dance");
  });

  it("falls back to other for zero when a leaf has no zero form", () => {
    expect(t("home.styles.more", { count: 0 })).toBe("0 more styles");
    expect(t("home.styles.more", { count: 1 })).toBe("1 more style");
  });

  it("follows CLDR English: fractions are other, the sign is ignored", () => {
    const forms: PluralForms = { one: "1 thing", other: "{count} things" };
    expect(plural(1.5, forms)).toBe("{count} things");
    expect(plural(-1, forms)).toBe("1 thing");
    expect(plural(-2, forms)).toBe("{count} things");
    expect(plural(1, forms)).toBe("1 thing");
    expect(plural(0, forms)).toBe("{count} things");
    expect(plural(0, { ...forms, zero: "None" })).toBe("None");
  });

  it("requires a numeric count for a plural key", () => {
    const loose = t as (k: string, p?: Record<string, string | number>) => string;
    expect(() => loose("home.header.count", {})).toThrow(/needs a numeric count/);
    expect(() => loose("home.header.count", { count: "3" })).toThrow(/needs a numeric count/);
  });

  it("every plural leaf has a one form that reads as singular and an other form with the count", () => {
    for (const key of keys()) {
      const leaf = leafAt(key);
      if (typeof leaf === "string") continue;
      expect(leaf.other, key).toContain("{count}");
      expect(leaf.one, key).not.toContain("{count}");
      if (leaf.zero !== undefined) expect(leaf.zero, key).not.toContain("{count}");
    }
  });
});

describe("copy rules", () => {
  const strings = everyString();

  it("never says N/A or the generic phrases the design rejects", () => {
    for (const { key, text } of strings) {
      expect(text, key).not.toMatch(/\bN\/A\b/i);
      expect(text, key).not.toMatch(/\bView details\b|\bLearn more\b|\bNo events found\b/i);
      expect(text, key).not.toMatch(/\bTBD\b|\bTBA\b|\bunknown\b/i);
    }
  });

  it("starts every string with a capital letter, a digit or a placeholder", () => {
    for (const { key, text } of strings) {
      if (MID_LINE_FRAGMENTS.has(key)) {
        expect(text, key).toMatch(/^[a-z]/);
        continue;
      }
      expect(text, key).toMatch(/^(?:[A-Z]|\d|\{[a-z][A-Za-z0-9]*\})/);
    }
  });

  it("keeps sentence case: no title case and no shouting", () => {
    for (const { key, text } of strings) {
      const words = text.split(/\s+/).map((w) => w.replace(/[,.;:!?()]/g, ""));
      if (words.length >= 3) {
        // Title case would capitalise every word of four or more letters.
        const long = words.filter((w) => /^[A-Za-z]{4,}$/.test(w));
        const capitalised = long.filter((w) => /^[A-Z]/.test(w));
        expect(
          capitalised.length < long.length || long.length < 2,
          `${key} reads as title case`,
        ).toBe(true);
      }
      // Display uppercase is CSS text-transform; acronyms up to four letters (DJ, RSVP) are fine.
      expect(text, key).not.toMatch(/\b[A-Z]{5,}\b/);
    }
  });

  it("ends with a full stop only when it is a sentence of at least three words", () => {
    for (const { key, text } of strings) {
      const endsWithStop = /[.!?]$/.test(text);
      if (endsWithStop) {
        expect(
          wordCount(text),
          `${key} ends with punctuation but is not a sentence`,
        ).toBeGreaterThanOrEqual(3);
      }
      if (/[.!?] [A-Z{]/.test(text)) {
        expect(endsWithStop, `${key} has an internal sentence break but no closing stop`).toBe(
          true,
        );
      }
      if (wordCount(text) < 3) {
        expect(text, `${key} is a label and must not end with punctuation`).not.toMatch(
          /[.!?,;:]$/,
        );
      }
    }
  });

  it("labels and buttons never end with punctuation", () => {
    const labelNamespaces = [
      "home.segments.",
      "home.sort.",
      "home.view.",
      "detail.actions.",
      "admin.actions.",
      "admin.nav.",
      "footer.",
    ];
    for (const { key, text } of strings) {
      if (labelNamespaces.some((ns) => key.startsWith(ns)) && key !== "footer.attribution") {
        expect(text, key).not.toMatch(/[.!?:]$/);
      }
    }
    for (const { key, text } of strings) {
      if (/\.heading$/.test(key)) expect(text, key).not.toMatch(/[.!?:]$/);
    }
  });

  it("uses camelCase placeholders, balanced braces and no HTML or stray whitespace", () => {
    for (const { key, text } of strings) {
      expect(text, key).toBe(text.trim());
      expect(text, key).not.toMatch(/ {2}/);
      expect(text, key).not.toMatch(/<[a-z/]/i);
      expect(text, key).not.toMatch(/&[a-z]+;|&#/i);
      const opens = (text.match(/\{/g) ?? []).length;
      const closes = (text.match(/\}/g) ?? []).length;
      expect(opens, key).toBe(closes);
      const stripped = text.replace(/\{[a-z][A-Za-z0-9]*\}/g, "");
      expect(stripped, key).not.toMatch(/[{}]/);
    }
  });

  it("keeps the segmented control's full and short labels in step", () => {
    for (const segment of ["all", "social", "clubs", "classes", "other"] as const) {
      const { full, short } = en.home.segments[segment];
      expect(short.length).toBeLessThanOrEqual(full.length);
      expect(full.toLowerCase().startsWith(short.toLowerCase())).toBe(true);
    }
    expect(en.home.segments.social.full).toBe("Social dancing");
    expect(en.home.segments.clubs.full).toBe("Clubs and DJ nights");
  });

  it("spells what a dancer reads the US way (D-072)", () => {
    const british =
      /organis|neighbour|colour|favourite|centre\b|behaviour|licence|catalogue|programme|\bany more\b|whilst|learnt|travell/i;
    for (const { key, text } of strings) expect(text, key).not.toMatch(british);
    for (const family of FAMILIES) expect(family.label, family.key).not.toMatch(british);
    for (const style of STYLES) expect(style.label, style.key).not.toMatch(british);
    expect(t("detail.who.organiser")).toBe("Organizer");
    expect(t("errors.listingNotFound")).toBe("That listing isn't here anymore.");
    // "Cancelled tonight" is SPEC section 1.3's own label, a US spelling too; it stays.
    expect(t("card.status.cancelled")).toBe("Cancelled tonight");
  });

  it("gives club nights one name: the family chip is the segment's full label (D-072)", () => {
    expect(familyLabel("club")).toBe(en.home.segments.clubs.full);
    expect(t("card.types.clubNight")).toBe("Club or DJ night");
    expect(t("detail.types.clubNight")).toBe("Club or DJ night");
  });

  it("spells the dancer-facing phrases the way the design draws them", () => {
    expect(t("card.status.onNow", { until: "11pm" })).toBe("On now until 11pm");
    expect(t("card.status.startsIn", { duration: "18 min", until: "12:30am" })).toBe(
      "Starts in 18 min, until 12:30am",
    );
    expect(t("card.status.cancelled")).toBe("Cancelled tonight");
    expect(t("home.sort.byStartTime")).toBe("Sort: start time");
    expect(t("home.sort.byDistance")).toBe("Sort: distance");
    expect(t("home.day.tonight")).toBe("Tonight");
    expect(t("detail.when.range", { from: "7:30pm", to: "1am" })).toBe("7:30pm to 1am");
    expect(t("detail.when.rangeEndNotListed", { from: "7:30pm" })).toBe("7:30pm, end not listed");
    expect(t("card.types.practica")).toBe("Práctica");
    expect(t("detail.types.social")).toBe("Social dance");
    expect(t("home.now.sticky", { time: "7:42pm" })).toBe("Now 7:42pm");
    expect(t("a11y.nowMarker", { time: "7:42pm" })).toBe("Now, 7:42pm");
    expect(t("home.empty.quietAfter", { time: "1am", distance: "15 miles" })).toBe(
      "Quiet after 1am. Showing tomorrow too, and places within 15 miles.",
    );
    // Where the listing was checked, never "Confirmed by organiser" (D-072).
    expect(t("card.flags.onOrganizerPage", { ago: "2h ago" })).toBe(
      "On the organizer's page, checked 2h ago",
    );
    expect(t("card.flags.onTicketPage", { ago: "2h ago" })).toBe(
      "On the ticket page, checked 2h ago",
    );
    expect(t("card.flags.listingChecked", { ago: "2h ago" })).toBe("Listing checked 2h ago");
    // SPEC.md section 1.3 gives the plain labels; the spec's wording wins.
    expect(t("card.flags.recurringUnconfirmed")).toBe("Not confirmed for tonight");
    expect(t("detail.cost.notListed")).toBe("Cover not listed");
    expect(t("common.notListed")).toBe("Not listed");
    expect(t("detail.sources.checked", { ago: "2h ago" })).toBe("checked 2h ago");
  });

  it("says a missing time the same way everywhere it appears (D-060)", () => {
    // The stamp slot, the section head, the status, the When row: one phrase, never a countdown,
    // never an assumed hour, and never "TBA" (the copy rules above reject it).
    const phrase = "Time not listed";
    expect(t("card.stamp.timeNotListed")).toBe(phrase);
    expect(t("home.untimed.heading")).toBe(phrase);
    expect(t("card.status.timeNotListed")).toBe(phrase);
    expect(t("detail.when.timeNotListed")).toBe(phrase);
    expect(t("card.status.timeNotListedUntil", { until: "2am" })).toBe(
      "Time not listed, until 2am",
    );
    expect(t("card.flags.checkBeforeYouGo")).toBe("Check before you go");
  });

  it("names a card by its stamp, its name and its status, with no dangling comma", () => {
    expect(t("a11y.card", { time: "8pm", title: "Salsa Sunday", status: "Starts in 18 min" })).toBe(
      "8pm, Salsa Sunday, Starts in 18 min",
    );
    expect(t("a11y.cardNoStatus", { time: "Time not listed", title: "Brooklyn Social" })).toBe(
      "Time not listed, Brooklyn Social",
    );
    expect(t("a11y.cardCancelled", { time: "Time not listed", title: "Brooklyn Social" })).toBe(
      "Time not listed, Brooklyn Social, cancelled",
    );
  });
});
