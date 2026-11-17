import { describe, it, expect } from "vitest";
import { unplacedTitlePrefix } from "@/src/domain/unplaced-title-prefix";
import type { DedupeSide } from "@/src/domain/dedupe";

// D-842: a leading metro-name word ("London Ceilidh Club ...") does not stop the shorter title heading it.
function side(over: Partial<DedupeSide>): DedupeSide {
  return {
    id: "x",
    startsAt: new Date("2026-11-13T20:00:00Z"),
    organizerId: null,
    organizerName: null,
    venueId: null,
    venuePoint: undefined,
    ticketUrl: null,
    canonicalUrl: null,
    trust: "directory",
    firstSeenAt: new Date("2026-11-01T00:00:00Z"),
    title: "",
    titleNormalized: "",
    listingType: undefined,
    cancelled: false,
    ...over,
  };
}

const unplaced = side({ id: "a", title: "Ceilidh Club", ticketUrl: "https://folkdance.page/e/1" });
const placed = side({
  id: "b",
  title: "London Ceilidh Club 13/11/26 @ Cecil Sharp House",
  venueId: "v1",
  venuePoint: { lat: 51.5388, lng: -0.1478 },
  ticketUrl: "https://ceilidhclub.com/events/13-11-26",
});

describe("unplacedTitlePrefix with the metro's name leading a title (D-842)", () => {
  it("joins the London Ceilidh Club pair when the metro is London", () => {
    expect(unplacedTitlePrefix(unplaced, placed, false, "London")).toBe(true);
    expect(unplacedTitlePrefix(placed, unplaced, false, "London")).toBe(true);
  });

  it("keeps them apart without the metro name (old behaviour)", () => {
    expect(unplacedTitlePrefix(unplaced, placed, false)).toBe(false);
  });

  it("only drops the metro's own name, not another city", () => {
    expect(unplacedTitlePrefix(unplaced, placed, false, "Paris")).toBe(false);
  });

  it("drops a multi-word metro name", () => {
    const a = side({ id: "a", title: "Ceilidh Club", ticketUrl: "https://x.example/1" });
    const b = side({
      id: "b",
      title: "New York Ceilidh Club November",
      venueId: "v1",
      ticketUrl: "https://y.example/2",
    });
    expect(unplacedTitlePrefix(a, b, false, "New York")).toBe(true);
  });

  it("still needs two telling words after the metro word is dropped", () => {
    const a = side({ id: "a", title: "Salsa Night", ticketUrl: "https://x.example/1" });
    const b = side({
      id: "b",
      title: "London Salsa Night at Bar Rio",
      venueId: "v1",
      ticketUrl: "https://y.example/2",
    });
    expect(unplacedTitlePrefix(a, b, false, "London")).toBe(false);
  });

  it("a title that is only the metro name never matches", () => {
    const a = side({ id: "a", title: "London", ticketUrl: "https://x.example/1" });
    const b = side({
      id: "b",
      title: "London Ceilidh Club",
      venueId: "v1",
      ticketUrl: "https://y.example/2",
    });
    expect(unplacedTitlePrefix(a, b, false, "London")).toBe(false);
  });

  it("still needs one start", () => {
    const b = side({ ...placed, startsAt: new Date("2026-11-13T19:30:00Z") });
    expect(unplacedTitlePrefix(unplaced, b, false, "London")).toBe(false);
  });

  it("still refuses one source", () => {
    expect(unplacedTitlePrefix(unplaced, placed, true, "London")).toBe(false);
  });
});
