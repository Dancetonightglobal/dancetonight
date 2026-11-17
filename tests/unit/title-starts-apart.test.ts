import { describe, it, expect } from "vitest";
import {
  oneTitleStartsApart,
  TITLE_STARTS_APART_MINUTES,
  TITLE_STARTS_APART_END_MINUTES,
} from "@/src/domain/title-starts-apart";
import type { DedupeSide } from "@/src/domain/dedupe";

function createSide(overrides: Partial<DedupeSide>): DedupeSide {
  const now = new Date("2026-11-01T00:00:00Z");
  return {
    id: "test-id",
    startsAt: null,
    organizerId: null,
    organizerName: null,
    venueId: "v1",
    ticketUrl: null,
    canonicalUrl: null,
    trust: "ticketing",
    firstSeenAt: now,
    title: "",
    titleNormalized: "",
    listingType: "club_night",
    endsAt: null,
    cancelled: false,
    ...overrides,
  };
}

describe("oneTitleStartsApart", () => {
  it("NOTO example: same title, 2h apart, ends null vs later -> true (and swapped)", () => {
    const a = createSide({
      title: "PTO Thursdays: Mha Iri",
      titleNormalized: "pto thursdays mha iri",
      startsAt: new Date("2026-11-13T01:00:00Z"),
      endsAt: null,
    });
    const b = createSide({
      title: "PTO Thursdays: Mha Iri",
      titleNormalized: "pto thursdays mha iri",
      startsAt: new Date("2026-11-13T03:00:00Z"),
      endsAt: new Date("2026-11-13T07:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(true);
    expect(oneTitleStartsApart(b, a)).toBe(true);
  });

  it("3h01m apart -> false", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T00:00:00Z"),
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T03:01:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("exactly 180 min apart -> true", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T00:00:00Z"),
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T03:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(true);
  });

  it("different titleNormalized -> false", () => {
    const a = createSide({
      title: "Event One",
      titleNormalized: "event one",
      startsAt: new Date("2026-11-13T01:00:00Z"),
    });
    const b = createSide({
      title: "Event Two",
      titleNormalized: "event two",
      startsAt: new Date("2026-11-13T02:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("generic title 'Salsa Night' -> false", () => {
    const a = createSide({
      title: "Salsa Night",
      titleNormalized: "salsa night",
      startsAt: new Date("2026-11-13T01:00:00Z"),
    });
    const b = createSide({
      title: "Salsa Night",
      titleNormalized: "salsa night",
      startsAt: new Date("2026-11-13T02:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("different venueId -> false", () => {
    const a = createSide({
      venueId: "v1",
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T01:00:00Z"),
    });
    const b = createSide({
      venueId: "v2",
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T02:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("both ends listed 2h apart -> false", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T01:00:00Z"),
      endsAt: new Date("2026-11-13T03:00:00Z"),
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T03:00:00Z"),
      endsAt: new Date("2026-11-13T05:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("both ends listed 30 min apart -> true", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T01:00:00Z"),
      endsAt: new Date("2026-11-13T03:00:00Z"),
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T02:00:00Z"),
      endsAt: new Date("2026-11-13T03:30:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(true);
  });

  it("one side cancelled -> false", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T01:00:00Z"),
      cancelled: true,
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T02:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("one side listingType 'class' -> false", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T01:00:00Z"),
      listingType: "class",
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T02:00:00Z"),
      listingType: "club_night",
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("both sides listingType 'class' -> false", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T01:00:00Z"),
      listingType: "class",
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T02:00:00Z"),
      listingType: "class",
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });

  it("one start null -> false", () => {
    const a = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: null,
    });
    const b = createSide({
      title: "Test Event",
      titleNormalized: "test event",
      startsAt: new Date("2026-11-13T02:00:00Z"),
    });
    expect(oneTitleStartsApart(a, b)).toBe(false);
  });
});
