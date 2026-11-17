// The app clock (D-823): mock mode may pin "now" with DANCETONIGHT_MOCK_NOW so the e2e suite reads
// one fixed afternoon in New York, whatever hour CI runs. Every other mode reads the real clock.

import { afterEach, describe, expect, it } from "vitest";

import { MOCK_NOW_VAR, appNow, e2ePinnedInstant, pinnedNow } from "@/src/config/clock";

describe("pinnedNow", () => {
  it("names the variable", () => {
    expect(MOCK_NOW_VAR).toBe("DANCETONIGHT_MOCK_NOW");
  });

  it("returns the pinned instant in mock mode", () => {
    expect(pinnedNow("2026-11-10T19:00:00.000Z", true)?.toISOString()).toBe(
      "2026-11-10T19:00:00.000Z",
    );
    expect(pinnedNow("2026-11-10T14:00:00-05:00", true)?.toISOString()).toBe(
      "2026-11-10T19:00:00.000Z",
    );
  });

  it("is null when unset or blank", () => {
    expect(pinnedNow(undefined, true)).toBeNull();
    expect(pinnedNow("", true)).toBeNull();
    expect(pinnedNow("   ", true)).toBeNull();
  });

  it("ignores the variable outside mock mode, even when it is set", () => {
    expect(pinnedNow("2026-11-10T19:00:00.000Z", false)).toBeNull();
    expect(pinnedNow("not a date", false)).toBeNull();
  });

  it("throws on a value that is not an ISO instant with a zone, so a typo never reads as now", () => {
    expect(() => pinnedNow("not a date", true)).toThrow(/DANCETONIGHT_MOCK_NOW/);
    expect(() => pinnedNow("2026-11-10", true)).toThrow(/DANCETONIGHT_MOCK_NOW/);
    expect(() => pinnedNow("2026-11-10T14:00:00", true)).toThrow(/DANCETONIGHT_MOCK_NOW/);
    expect(() => pinnedNow("2026-13-40T14:00:00Z", true)).toThrow(/DANCETONIGHT_MOCK_NOW/);
  });
});

describe("appNow", () => {
  const saved = process.env[MOCK_NOW_VAR];
  afterEach(() => {
    if (saved === undefined) delete process.env[MOCK_NOW_VAR];
    else process.env[MOCK_NOW_VAR] = saved;
  });

  it("reads the real clock when nothing is pinned", () => {
    delete process.env[MOCK_NOW_VAR];
    const before = Date.now();
    const now = appNow(true).getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("reads the variable on every call and returns a fresh Date", () => {
    process.env[MOCK_NOW_VAR] = "2026-11-10T19:00:00.000Z";
    const a = appNow(true);
    a.setTime(0);
    expect(appNow(true).toISOString()).toBe("2026-11-10T19:00:00.000Z");
    process.env[MOCK_NOW_VAR] = "2026-11-11T19:00:00.000Z";
    expect(appNow(true).toISOString()).toBe("2026-11-11T19:00:00.000Z");
  });

  it("ignores the pin outside mock mode", () => {
    process.env[MOCK_NOW_VAR] = "2026-11-10T19:00:00.000Z";
    expect(Math.abs(appNow(false).getTime() - Date.now())).toBeLessThan(1000);
  });
});

describe("e2ePinnedInstant", () => {
  it("is 14:00 New York on the real New York calendar date", () => {
    // 09:30Z is 04:30 in New York (EST): still the 10th there, and the pin is that afternoon.
    expect(e2ePinnedInstant(new Date("2026-11-10T09:30:00Z"))).toBe("2026-11-10T19:00:00.000Z");
    // 03:00Z on the 11th is 22:00 on the 10th in New York.
    expect(e2ePinnedInstant(new Date("2026-11-11T03:00:00Z"))).toBe("2026-11-10T19:00:00.000Z");
    // Summer time (EDT, UTC-4).
    expect(e2ePinnedInstant(new Date("2026-07-01T12:00:00Z"))).toBe("2026-07-01T18:00:00.000Z");
  });

  it("takes another zone and hour", () => {
    expect(e2ePinnedInstant(new Date("2026-11-10T09:30:00Z"), "Asia/Tokyo", 20)).toBe(
      "2026-11-10T11:00:00.000Z",
    );
  });
});
