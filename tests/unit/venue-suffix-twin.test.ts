// D-872: a directory's untimed copy whose whole title is the other copy's title less " @ <venue>" is one night
// (London: Swing Out London's untimed "A-Train" / "C Jam" beside Swingland's 19:00 "A-Train @ The Hammersmith
// Club" / "C Jam @ The Bedford", 2026-11-12). D-522's two-word floor drops the one-letter word and keeps them apart.
import { describe, expect, it } from "vitest";

import type { DedupeSide } from "@/src/domain/dedupe";
import { untimedVenueSuffixTwin } from "@/src/domain/venue-suffix-twin";

function side(over: Partial<DedupeSide>): DedupeSide {
  return {
    id: "x",
    startsAt: null,
    organizerId: null,
    organizerName: null,
    venueId: "v1",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "first_party",
    firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    title: "",
    listingType: "social",
    cancelled: false,
    venueName: "The Hammersmith Club",
    ...over,
  };
}

const timed = (over: Partial<DedupeSide> = {}) =>
  side({
    id: "swingland",
    startsAt: new Date("2026-11-16T19:00:00Z"),
    title: "A-Train @ The Hammersmith Club",
    ...over,
  });
const untimed = (over: Partial<DedupeSide> = {}) =>
  side({ id: "sol", trust: "directory", title: "A-Train", ...over });

describe("untimedVenueSuffixTwin (D-872)", () => {
  it("joins the directory's untimed A-Train to the timed A-Train @ The Hammersmith Club", () => {
    expect(untimedVenueSuffixTwin(untimed(), timed(), false)).toBe(true);
    expect(untimedVenueSuffixTwin(timed(), untimed(), false)).toBe(true);
  });

  it("joins C Jam to C Jam @ The Bedford", () => {
    const v = { venueName: "The Bedford" };
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "C Jam", ...v }),
        timed({ title: "C Jam @ The Bedford", ...v }),
        false,
      ),
    ).toBe(true);
  });

  it("accepts 'at' and a venue name without its leading The, any case and spacing", () => {
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "a-train" }),
        timed({ title: "A-Train  at  Hammersmith Club" }),
        false,
      ),
    ).toBe(true);
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "A-Train" }),
        timed({ title: "A-Train at the Hammersmith Club" }),
        false,
      ),
    ).toBe(true);
  });

  it("matches on either side's venue name", () => {
    expect(
      untimedVenueSuffixTwin(
        untimed({ venueName: "Hammersmith Club, London" }),
        timed({ venueName: "The Hammersmith Club" }),
        false,
      ),
    ).toBe(true);
  });

  it("counts a one-letter word as telling (C Jam), but not a generic one (A Social)", () => {
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "A Social" }),
        timed({ title: "A Social @ The Hammersmith Club" }),
        false,
      ),
    ).toBe(false);
  });

  it("keeps a generic title apart (Social vs Social @ The Hammersmith Club)", () => {
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "Social" }),
        timed({ title: "Social @ The Hammersmith Club" }),
        false,
      ),
    ).toBe(false);
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "Swing Dance Social" }),
        timed({ title: "Swing Dance Social @ The Hammersmith Club" }),
        false,
      ),
    ).toBe(false);
  });

  it("keeps a different title apart", () => {
    expect(untimedVenueSuffixTwin(untimed({ title: "B-Train" }), timed(), false)).toBe(false);
    expect(untimedVenueSuffixTwin(untimed({ title: "A-Train Late" }), timed(), false)).toBe(false);
  });

  it("needs the timed title to carry the venue suffix", () => {
    expect(untimedVenueSuffixTwin(untimed(), timed({ title: "A-Train" }), false)).toBe(false);
    expect(
      untimedVenueSuffixTwin(untimed(), timed({ title: "A-Train @ The Bedford" }), false),
    ).toBe(false);
  });

  it("needs one side untimed and the other timed", () => {
    expect(
      untimedVenueSuffixTwin(
        untimed({ startsAt: new Date("2026-11-16T19:00:00Z") }),
        timed(),
        false,
      ),
    ).toBe(false);
    expect(untimedVenueSuffixTwin(untimed(), timed({ startsAt: null }), false)).toBe(false);
  });

  it("needs the untimed copy to come from a directory", () => {
    expect(untimedVenueSuffixTwin(untimed({ trust: "first_party" }), timed(), false)).toBe(false);
  });

  it("needs two sources and one venue row", () => {
    expect(untimedVenueSuffixTwin(untimed(), timed(), true)).toBe(false);
    expect(untimedVenueSuffixTwin(untimed({ venueId: "v2" }), timed(), false)).toBe(false);
    expect(
      untimedVenueSuffixTwin(untimed({ venueId: null }), timed({ venueId: null }), false),
    ).toBe(false);
  });

  it("never joins a cancelled copy", () => {
    expect(untimedVenueSuffixTwin(untimed({ cancelled: true }), timed(), false)).toBe(false);
    expect(untimedVenueSuffixTwin(untimed(), timed({ cancelled: true }), false)).toBe(false);
  });

  it("never joins a class to a social", () => {
    expect(untimedVenueSuffixTwin(untimed(), timed({ listingType: "class" }), false)).toBe(false);
    expect(
      untimedVenueSuffixTwin(
        untimed({ title: "Charleston Class", listingType: "class" }),
        timed({ title: "Charleston Class @ The Hammersmith Club", listingType: "class" }),
        false,
      ),
    ).toBe(true);
  });
});
