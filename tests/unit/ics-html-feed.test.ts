import { describe, it, expect } from "vitest";
import { readsPageInstead, PAGE_INSTEAD } from "@/src/pipeline/ics-html-feed";

describe("readsPageInstead", () => {
  const baseSource = {
    kind: "feed_ics" as const,
    platform: null,
    feedUrl: "https://example.com/events.ics",
    url: "https://example.com/events",
  };

  it("returns true for streak 2 with matching error", () => {
    const result = readsPageInstead(baseSource, "adapter: the feed is not an iCalendar file", 2);
    expect(result).toBe(true);
  });

  it("returns true for streak 9 with matching error", () => {
    const result = readsPageInstead(baseSource, "The feed is NOT an iCalendar file", 9);
    expect(result).toBe(true);
  });

  it("returns false for streak 1", () => {
    const result = readsPageInstead(baseSource, "adapter: the feed is not an iCalendar file", 1);
    expect(result).toBe(false);
  });

  it("returns false when platform is set (e.g., 'meetup')", () => {
    const source = { ...baseSource, platform: "meetup" };
    const result = readsPageInstead(source, "adapter: the feed is not an iCalendar file", 2);
    expect(result).toBe(false);
  });

  it("returns true when platform is empty string (counts as no platform)", () => {
    const source = { ...baseSource, platform: "" };
    const result = readsPageInstead(source, "adapter: the feed is not an iCalendar file", 2);
    expect(result).toBe(true);
  });

  it("returns false when feedUrl is null", () => {
    const source = { ...baseSource, feedUrl: null };
    const result = readsPageInstead(source, "adapter: the feed is not an iCalendar file", 2);
    expect(result).toBe(false);
  });

  it("returns false when feedUrl equals url", () => {
    const source = {
      ...baseSource,
      feedUrl: "https://example.com/events",
      url: "https://example.com/events",
    };
    const result = readsPageInstead(source, "adapter: the feed is not an iCalendar file", 2);
    expect(result).toBe(false);
  });

  it("returns false for kind 'html'", () => {
    const source = { ...baseSource, kind: "html" as const };
    const result = readsPageInstead(source, "adapter: the feed is not an iCalendar file", 2);
    expect(result).toBe(false);
  });

  it("returns false for a different error", () => {
    const result = readsPageInstead(baseSource, "timeout: no answer within 20 s", 2);
    expect(result).toBe(false);
  });

  it("matches case-insensitively", () => {
    const result = readsPageInstead(baseSource, "NOT AN iCalendar FILE", 2);
    expect(result).toBe(true);
  });

  it("PAGE_INSTEAD constant matches spec", () => {
    expect(PAGE_INSTEAD).toEqual({
      kind: "html",
      platform: "probed",
      feedUrl: null,
    });
  });
});
