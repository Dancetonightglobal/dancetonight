import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import robots from "@/app/robots";

describe("robots.txt keeps crawlers off filter combinations (2026-10-17)", () => {
  it("allows / and disallows /*? for all user agents", () => {
    const result = robots();
    expect(result.rules).toEqual({
      userAgent: "*",
      allow: "/",
      disallow: ["/*?"],
    });
  });

  it("marks 3 filter links nofollow in Filters.tsx", () => {
    const filters = readFileSync("src/ui/home/Filters.tsx", "utf8");
    const matches = filters.match(/rel="nofollow"/g) ?? [];
    expect(matches.length).toBe(3);
  });

  it("marks 1 filter link nofollow in DayPicker.tsx", () => {
    const dayPicker = readFileSync("src/ui/home/DayPicker.tsx", "utf8");
    const matches = dayPicker.match(/rel="nofollow"/g) ?? [];
    expect(matches.length).toBe(1);
  });
});
