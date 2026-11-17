import { describe, expect, it } from "vitest";
import { scorePair, venueNamedTitle, type DedupeSide } from "@/src/domain/dedupe";

// D-503: at one venue and one start, a title that is the other title plus the venue's own name
// (before it, or after it with an optional "at"/"in") is one night. PHL 41116190356:
// "Underground Arts SUPERNATURAL DANCE PARTY" and "SUPERNATURAL DANCE PARTY" stood side by side.

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: new Date("2026-10-31T02:00:00Z"),
  organizerId: null,
  organizerName: null,
  venueId: "v1",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "first_party",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  ...over,
});

const facts = { titleSimilarity: 0.5, organizerSimilarity: null };

describe("venueNamedTitle", () => {
  it("venue name before the title", () => {
    const a = "Underground Arts SUPERNATURAL DANCE PARTY";
    const b = "SUPERNATURAL DANCE PARTY";
    expect(venueNamedTitle(a, b, "Underground Arts")).toBe(true);
    expect(venueNamedTitle(b, a, "Underground Arts")).toBe(true);
  });

  it("venue name after the title, with or without at / @ / dash", () => {
    const v = "Underground Arts";
    expect(venueNamedTitle("Supernatural at Underground Arts", "SUPERNATURAL", v)).toBe(true);
    expect(venueNamedTitle("Supernatural in Underground Arts", "Supernatural", v)).toBe(true);
    expect(venueNamedTitle("Supernatural @ Underground Arts", "Supernatural", v)).toBe(true);
    expect(venueNamedTitle("Supernatural - Underground Arts", "Supernatural", v)).toBe(true);
    expect(venueNamedTitle("Underground Arts: Supernatural", "Supernatural", v)).toBe(true);
  });

  it("a leading 'The' on the venue name is optional in the title", () => {
    expect(venueNamedTitle("Fillmore Joyhauser", "Joyhauser", "The Fillmore")).toBe(true);
    expect(venueNamedTitle("Joyhauser at The Fillmore", "Joyhauser", "The Fillmore")).toBe(true);
  });

  it("false when the remaining title has no word of 3+ letters that is not generic", () => {
    const v = "Underground Arts";
    expect(venueNamedTitle("Underground Arts Salsa Night", "Salsa Night", v)).toBe(false);
    expect(venueNamedTitle("Underground Arts Dance Party", "Dance Party", v)).toBe(false);
  });

  it("false when the extra words are not the venue's name", () => {
    const v = "Underground Arts";
    expect(
      venueNamedTitle("Halloween SUPERNATURAL DANCE PARTY", "SUPERNATURAL DANCE PARTY", v),
    ).toBe(false);
    // only part of the venue name
    expect(venueNamedTitle("Arts Supernatural", "Supernatural", v)).toBe(false);
    // venue name in the middle is not stripped
    expect(venueNamedTitle("Supernatural Underground Arts Party", "Supernatural Party", v)).toBe(
      false,
    );
  });

  it("false when the titles are different after the venue name is removed", () => {
    expect(
      venueNamedTitle(
        "Underground Arts Goth Night",
        "SUPERNATURAL DANCE PARTY",
        "Underground Arts",
      ),
    ).toBe(false);
  });

  it("false when neither title names the venue (identical titles are left to other rules)", () => {
    expect(venueNamedTitle("Supernatural", "Supernatural", "Underground Arts")).toBe(false);
  });

  it("false for empty or missing venue name, or a venue name with no words", () => {
    expect(venueNamedTitle("Underground Arts Supernatural", "Supernatural", "")).toBe(false);
    expect(venueNamedTitle("Underground Arts Supernatural", "Supernatural", undefined)).toBe(false);
    expect(venueNamedTitle("Underground Arts Supernatural", "Supernatural", " - ")).toBe(false);
  });

  it("false when one title is only the venue name", () => {
    expect(venueNamedTitle("Voyeur", "Weekends at Voyeur", "Voyeur")).toBe(false);
    expect(venueNamedTitle("Underground Arts", "Supernatural", "Underground Arts")).toBe(false);
  });
});

describe("scorePair with the venue-named title rule (D-503)", () => {
  const titleA = "Underground Arts SUPERNATURAL DANCE PARTY";
  const titleB = "SUPERNATURAL DANCE PARTY";

  it("one venue, one start, venue-named title -> auto_merge", () => {
    const a = side({ id: "a", title: titleA, venueName: "Underground Arts" });
    const b = side({ id: "b", title: titleB, venueName: "Underground Arts" });
    expect(scorePair(a, b, facts).decision).toBe("auto_merge");
    expect(scorePair(b, a, facts).decision).toBe("auto_merge");
  });

  it("uses whichever side carries the venue name", () => {
    const a = side({ id: "a", title: titleA, venueName: "Underground Arts" });
    const b = side({ id: "b", title: titleB });
    expect(scorePair(a, b, facts).decision).toBe("auto_merge");
    expect(scorePair(b, a, facts).decision).toBe("auto_merge");
  });

  it("not merged without a venue name", () => {
    const a = side({ id: "a", title: titleA });
    const b = side({ id: "b", title: titleB });
    expect(scorePair(a, b, facts).decision).not.toBe("auto_merge");
  });

  it("not merged at two venues", () => {
    const a = side({ id: "a", title: titleA, venueName: "Underground Arts" });
    const b = side({ id: "b", title: titleB, venueId: "v2", venueName: "Underground Arts" });
    expect(scorePair(a, b, facts).decision).not.toBe("auto_merge");
  });

  it("not merged when the starts are more than 15 minutes apart", () => {
    const a = side({ id: "a", title: titleA, venueName: "Underground Arts" });
    const b = side({
      id: "b",
      title: titleB,
      venueName: "Underground Arts",
      startsAt: new Date("2026-10-31T03:00:00Z"),
    });
    expect(scorePair(a, b, facts).decision).not.toBe("auto_merge");
  });

  it("not merged when either side is cancelled", () => {
    const a = side({ id: "a", title: titleA, venueName: "Underground Arts", cancelled: true });
    const b = side({ id: "b", title: titleB, venueName: "Underground Arts" });
    expect(scorePair(a, b, facts).decision).not.toBe("auto_merge");
  });

  it("not merged across listing kinds", () => {
    const a = side({
      id: "a",
      title: titleA,
      venueName: "Underground Arts",
      listingType: "class",
    });
    const b = side({
      id: "b",
      title: titleB,
      venueName: "Underground Arts",
      listingType: "social",
    });
    expect(scorePair(a, b, facts).decision).not.toBe("auto_merge");
  });
});
