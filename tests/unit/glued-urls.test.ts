import { describe, expect, it } from "vitest";
import { httpUrl } from "@/src/adapters/shared";
import { optionalHttpUrl } from "@/src/domain/listing";

// D-777 (daily check 11-07, Dubai "The Monday Club"): two links run together are no link.
const GLUED =
  "https://sevn.ly/xOhttps://www.sevenrooms.com/experiences/mccaffertysjvc/the-monday-club-6475221151858688kUJSML%20";

describe("glued URLs (D-777)", () => {
  it("drops a second scheme glued onto a letter or digit", () => {
    expect(httpUrl(GLUED)).toBeNull();
    expect(optionalHttpUrl.parse(GLUED)).toBeNull();
    expect(httpUrl("https://a.example/x9http://b.example/y")).toBeNull();
  });

  it("keeps a URL after a slash, an equals sign or a question mark", () => {
    const wayback = "https://web.archive.org/web/2026/https://example.com/e/1";
    expect(httpUrl(wayback)).toBe(wayback);
    expect(optionalHttpUrl.parse(wayback)).toBe(wayback);
    const redirect = "https://l.example.com/?u=https://example.com/e/1";
    expect(httpUrl(redirect)).toBe(redirect);
    expect(optionalHttpUrl.parse(redirect)).toBe(redirect);
    expect(httpUrl("/https://ra.co/events/1", "https://greyhound.example/")).toBe(
      "https://ra.co/events/1",
    );
  });
});
