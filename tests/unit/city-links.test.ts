import { describe, expect, it } from "vitest";

import { otherCityLink } from "@/src/pipeline/city-links";
import { NYC_SOURCES } from "@/config/sources/nyc";

describe("otherCityLink", () => {
  const prefix = "https://www.daybreaker.com/event/new-york-";

  it("returns another city's link when only non-prefix links are present", () => {
    expect(otherCityLink(["https://www.daybreaker.com/event/austin-10-31/"], prefix)).toBe(
      "https://www.daybreaker.com/event/austin-10-31/",
    );
  });

  it("returns null when a link starts with the prefix (this city's)", () => {
    expect(otherCityLink(["https://www.daybreaker.com/event/new-york-10-23/"], prefix)).toBeNull();
  });

  it("handles www-less host", () => {
    expect(otherCityLink(["https://daybreaker.com/event/miami-10-31/"], prefix)).toBe(
      "https://daybreaker.com/event/miami-10-31/",
    );
  });

  it("returns null when at least one link is this city's, even if another city's exists", () => {
    expect(
      otherCityLink(
        [
          "http://www.daybreaker.com/event/new-york-11-20/",
          "https://www.daybreaker.com/event/austin-12-12/",
        ],
        prefix,
      ),
    ).toBeNull();
  });

  it("returns null for links on other hosts", () => {
    expect(otherCityLink(["https://www.eventbrite.com/e/123", null, undefined], prefix)).toBeNull();
  });

  it("returns null for a link not under the parent path", () => {
    expect(otherCityLink(["https://www.daybreaker.com/our-events/"], prefix)).toBeNull();
  });

  it("returns null for malformed URLs", () => {
    expect(otherCityLink(["not a url"], prefix)).toBeNull();
  });

  it("returns null when prefix is undefined", () => {
    expect(otherCityLink(["https://www.daybreaker.com/event/austin-10-31/"], undefined)).toBeNull();
  });

  it("returns null when prefix is empty", () => {
    expect(otherCityLink(["https://www.daybreaker.com/event/austin-10-31/"], "")).toBeNull();
  });

  it("returns null for an empty link list", () => {
    expect(otherCityLink([], prefix)).toBeNull();
  });

  it("Daybreaker entry has cityLinkPrefix", () => {
    const daybreaker = NYC_SOURCES.find((s) => s.url === "https://www.daybreaker.com/our-events/");
    expect(daybreaker).toBeDefined();
    expect(daybreaker?.cityLinkPrefix).toBe(prefix);
  });
});
