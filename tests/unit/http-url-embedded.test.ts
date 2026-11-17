// D-756: a site href that is a full URL behind a slash ("/https://ra.co/events/1") is that URL, not a path on the site.

import { describe, expect, it } from "vitest";

import { httpUrl } from "@/src/adapters/shared";
import { cleanPageText } from "@/src/pipeline/clean";

const BASE = "https://www.thegreyhound.uk/whats-on";

describe("httpUrl with a full URL written as a path (D-756)", () => {
  it.each([
    ["/https://ra.co/events/2560185", "https://ra.co/events/2560185"],
    ["/http://ra.co/events/2560185", "http://ra.co/events/2560185"],
    ["/https://ra.co/events/2560185?ref=x#t", "https://ra.co/events/2560185?ref=x#t"],
    ["/https%3A%2F%2Fra.co%2Fevents%2F2560185", "https://ra.co/events/2560185"],
    ["  /https://ra.co/events/1  ", "https://ra.co/events/1"],
  ])("%s reads as %s", (href, expected) => {
    expect(httpUrl(href, BASE)).toBe(expected);
  });

  it.each([
    ["/events/https-night", "https://www.thegreyhound.uk/events/https-night"],
    ["/https/events", "https://www.thegreyhound.uk/https/events"],
    ["https://ra.co/events/1", "https://ra.co/events/1"],
    ["//ra.co/events/1", "https://ra.co/events/1"],
  ])("leaves %s as before", (href, expected) => {
    expect(httpUrl(href, BASE)).toBe(expected);
  });

  it("does not unwrap an absolute URL that has another URL in its path", () => {
    const wayback = "https://web.archive.org/web/2020/https://example.com/";
    expect(httpUrl(wayback)).toBe(wayback);
    expect(httpUrl("https://x.example/https://ra.co/events/1", BASE)).toBe(
      "https://x.example/https://ra.co/events/1",
    );
  });

  it("refuses a wrapped URL that is not http(s)", () => {
    expect(httpUrl("/javascript:alert(1)", BASE)).toBe(
      "https://www.thegreyhound.uk/javascript:alert(1)",
    );
    expect(httpUrl("/https://", BASE)).toBe("https://www.thegreyhound.uk/https://");
  });

  it("page text keeps the RA link itself (The Greyhound, London 11-05)", () => {
    const html = `<p>Fri 6 Nov <a href="/https://ra.co/events/2560185">Tickets</a></p>`;
    expect(cleanPageText(html, BASE)).toContain("Tickets [https://ra.co/events/2560185]");
  });
});
