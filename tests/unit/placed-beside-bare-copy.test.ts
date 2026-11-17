// D-864: a copy with no place and no time beside another source's placed, timed copy with one exact telling title is
// one night (Barcelona "Wave Fest x Bad Decisions": DICE 11pm at Sala Bikini, RA untimed "Location not listed",
// daily report 2026-11-11).
import { describe, expect, it } from "vitest";

import type { DedupeSide } from "@/src/domain/dedupe";
import { placedBesideBareCopy } from "@/src/domain/placed-beside-bare-copy";

function side(over: Partial<DedupeSide>): DedupeSide {
  return {
    id: "x",
    startsAt: null,
    organizerId: null,
    organizerName: null,
    venueId: null,
    venuePoint: undefined,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    title: "",
    titleNormalized: "",
    listingType: undefined,
    cancelled: false,
    ...over,
  };
}

const placed = (over: Partial<DedupeSide> = {}) =>
  side({
    id: "dice",
    startsAt: new Date("2026-11-12T22:00:00Z"),
    venueId: "v1",
    venuePoint: { lat: 41.3874, lng: 2.1301 },
    title: "Wave Fest x Bad Decisions",
    titleNormalized: "wave fest x bad decisions",
    ticketUrl: "https://dice.fm/event/6af346f4769a18000179669e",
    ...over,
  });
const bare = (over: Partial<DedupeSide> = {}) =>
  side({
    id: "ra",
    title: "Wave Fest x Bad Decisions",
    titleNormalized: "wave fest x bad decisions",
    ticketUrl: "https://ra.co/events/2581907",
    ...over,
  });

describe("placedBesideBareCopy (D-864)", () => {
  it("joins the bare RA copy to the placed, timed DICE copy, either order", () => {
    expect(placedBesideBareCopy(placed(), bare(), false)).toBe(true);
    expect(placedBesideBareCopy(bare(), placed(), false)).toBe(true);
  });

  it("joins a placed copy that has a venue row but no point", () => {
    expect(placedBesideBareCopy(placed({ venuePoint: undefined }), bare(), false)).toBe(true);
  });

  it("never joins one source's two listings", () => {
    expect(placedBesideBareCopy(placed(), bare(), true)).toBe(false);
  });

  it("never joins a cancelled copy", () => {
    expect(placedBesideBareCopy(placed({ cancelled: true }), bare(), false)).toBe(false);
    expect(placedBesideBareCopy(placed(), bare({ cancelled: true }), false)).toBe(false);
  });

  it("needs the bare copy to have neither a place nor a time", () => {
    expect(
      placedBesideBareCopy(placed(), bare({ startsAt: new Date("2026-11-12T22:00:00Z") }), false),
    ).toBe(false);
    expect(placedBesideBareCopy(placed(), bare({ venueId: "v2" }), false)).toBe(false);
    expect(
      placedBesideBareCopy(placed(), bare({ venuePoint: { lat: 41.39, lng: 2.13 } }), false),
    ).toBe(false);
  });

  it("needs the other copy to have both a place and a time", () => {
    expect(placedBesideBareCopy(placed({ startsAt: null }), bare(), false)).toBe(false);
    expect(
      placedBesideBareCopy(placed({ venueId: null, venuePoint: undefined }), bare(), false),
    ).toBe(false);
  });

  it("needs one exact normalized title", () => {
    expect(
      placedBesideBareCopy(
        placed(),
        bare({
          title: "Wave Fest x Bad Decisions II",
          titleNormalized: "wave fest x bad decisions ii",
        }),
        false,
      ),
    ).toBe(false);
  });

  it("keeps a generic or short title apart", () => {
    const generic = { title: "Salsa Social Night", titleNormalized: "salsa social night" };
    expect(placedBesideBareCopy(placed(generic), bare(generic), false)).toBe(false);
    const short = { title: "Wave Fest", titleNormalized: "wave fest" };
    expect(placedBesideBareCopy(placed(short), bare(short), false)).toBe(false);
  });

  it("keeps two pages on one seller apart", () => {
    expect(
      placedBesideBareCopy(
        placed(),
        bare({ ticketUrl: "https://dice.fm/event/other-page" }),
        false,
      ),
    ).toBe(false);
  });

  it("keeps a class apart", () => {
    expect(placedBesideBareCopy(placed({ listingType: "class" }), bare(), false)).toBe(false);
  });
});
