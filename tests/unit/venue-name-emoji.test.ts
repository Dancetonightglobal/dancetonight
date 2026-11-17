import { describe, expect, test } from "vitest";
import { cleanVenueName } from "@/src/pipeline/normalize";

describe("cleanVenueName", () => {
  test("removes leading emoji", () => {
    expect(cleanVenueName("📍Tropicavana Bar")).toBe("Tropicavana Bar");
    expect(cleanVenueName("📍 Tropicavana Bar")).toBe("Tropicavana Bar");
  });

  test("removes trailing emoji", () => {
    expect(cleanVenueName("Club 🎉")).toBe("Club");
    expect(cleanVenueName("🔥🔥 Salsa Hall 🔥")).toBe("Salsa Hall");
  });

  test("removes a trailing word joiner and object replacement character", () => {
    expect(cleanVenueName("www.Miamibaila.Com\u2060\uFFFC")).toBe("www.Miamibaila.Com");
    expect(cleanVenueName("\uFFFC Club")).toBe("Club");
  });

  test("keeps emoji in the middle", () => {
    expect(cleanVenueName("Bar 🍸 Lounge")).toBe("Bar 🍸 Lounge");
  });

  test("preserves normal names", () => {
    expect(cleanVenueName("Studio 54")).toBe("Studio 54");
    expect(cleanVenueName("#1 Bar")).toBe("#1 Bar");
    expect(cleanVenueName("Café Ñandú")).toBe("Café Ñandú");
  });

  test("returns null for empty results", () => {
    expect(cleanVenueName("🎉")).toBeNull();
    expect(cleanVenueName("")).toBeNull();
    expect(cleanVenueName(null)).toBeNull();
  });

  test("removes word joiner and object replacement character anywhere in the name", () => {
    expect(cleanVenueName("www.Miamibaila.Com\u2060\uFFFC, East Little Havana")).toBe(
      "www.Miamibaila.Com, East Little Havana",
    );
    expect(cleanVenueName("Salsa\u2060Club")).toBe("SalsaClub");
    expect(cleanVenueName("\uFFFC")).toBeNull();
  });

  test("keeps middle emoji when control chars are removed", () => {
    expect(cleanVenueName("Café \u2060🎶\uFFFC Bar")).toBe("Café 🎶 Bar");
  });
});
