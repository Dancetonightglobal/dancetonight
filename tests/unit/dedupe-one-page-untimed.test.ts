import { describe, expect, it } from "vitest";
import { scorePair, type DedupeSide, type PairFacts } from "@/src/domain/dedupe";

// D-743: one link, one card. London 2026-11-05 (daily check 11-05 second run): The Greyhound's own
// what's-on page listed the night untimed under its lineup line ("CITIZEN Shanumi Ovrtic BIG TOE
// Siani Isaac Frost", tickets at ra.co/events/2575169), and ra.co listed the same page at 7pm as
// "Start Here (Free Entry)". The titles share no word, so D-592's title check kept two cards.
// An untimed listing at the same place whose event page is a timed listing's page is that listing.

const RA = "https://ra.co/events/2575169";
const at = (hhmm: string) => new Date(`2026-11-05T${hhmm}:00Z`);

const side = (over: Partial<DedupeSide>): DedupeSide => ({
  id: "a",
  startsAt: null,
  organizerId: null,
  organizerName: null,
  venueId: "v-greyhound",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "directory",
  firstSeenAt: new Date("2026-10-20T00:00:00Z"),
  listingType: "dj_night",
  endsAt: null,
  venueName: "The Greyhound",
  ...over,
});

const facts = (over: Partial<PairFacts> = {}): PairFacts => ({
  titleSimilarity: 0.02,
  organizerSimilarity: null,
  titlePrefix: false,
  sameSource: false,
  ...over,
});

const venuePage = side({
  id: "greyhound",
  title: "CITIZEN Shanumi Ovrtic BIG TOE Siani Isaac Frost",
  trust: "first_party",
  ticketUrl: RA,
  canonicalUrl: "https://www.thegreyhound.uk/whats-on",
  links: ["https://www.thegreyhound.uk/whats-on"],
});
const ra = side({
  id: "ra",
  title: "Start Here (Free Entry)",
  startsAt: at("19:00"),
  ticketUrl: RA,
  canonicalUrl: RA,
  links: [RA],
});

describe("one event page, one place, one untimed side (D-743)", () => {
  it("merges the venue's untimed lineup line into ra.co's timed listing", () => {
    expect(scorePair(venuePage, ra, facts()).decision).toBe("auto_merge");
    expect(scorePair(ra, venuePage, facts()).decision).toBe("auto_merge");
  });
  it("needs one place: the same page at an unknown venue stays apart", () => {
    const noVenue = { ...venuePage, venueId: null, venueName: undefined };
    expect(scorePair(noVenue, ra, facts()).decision).not.toBe("auto_merge");
  });
  it("needs one place: the same page at another venue stays apart", () => {
    const elsewhere = { ...venuePage, venueId: "v-other", venueName: "Corsica Studios" };
    expect(scorePair(elsewhere, ra, facts()).decision).not.toBe("auto_merge");
  });
  it("needs an event page: a shared venue listing page is not enough", () => {
    const a = { ...venuePage, ticketUrl: null };
    const b = {
      ...ra,
      ticketUrl: null,
      canonicalUrl: "https://www.thegreyhound.uk/whats-on",
      links: ["https://www.thegreyhound.uk/whats-on"],
    };
    expect(scorePair(a, b, facts()).decision).not.toBe("auto_merge");
  });
  it("keeps two timed shows sold on one page apart (D-592 test stays)", () => {
    const early = side({ id: "e", title: "Comedy Hour", startsAt: at("19:00"), ticketUrl: RA });
    const late = side({ id: "l", title: "Techno All Night", startsAt: at("23:00"), ticketUrl: RA });
    expect(scorePair(early, late, facts()).decision).not.toBe("auto_merge");
  });
  it("never joins a cancelled listing", () => {
    expect(scorePair(venuePage, { ...ra, cancelled: true }, facts()).decision).not.toBe(
      "auto_merge",
    );
  });
  it("never joins a class with a night", () => {
    const cls = { ...venuePage, title: "Beginners salsa class", listingType: "class" as const };
    expect(scorePair(cls, ra, facts()).decision).not.toBe("auto_merge");
  });
});
