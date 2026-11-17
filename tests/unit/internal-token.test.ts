import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { internalToken, isInternalToken } from "@/src/edge/internal-token";

describe("internalToken", () => {
  const symbol = Symbol.for("dancetonight.internal-token");

  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[symbol];
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[symbol];
  });

  it("isInternalToken returns false before any token exists and does not create one", () => {
    expect(isInternalToken("x")).toBe(false);
    expect((globalThis as Record<symbol, unknown>)[symbol]).toBeUndefined();
  });

  it("internalToken returns the same value twice", () => {
    const token1 = internalToken();
    const token2 = internalToken();
    expect(token1).toBe(token2);
    expect(typeof token1).toBe("string");
    expect(token1.length).toBeGreaterThan(0);
  });

  it("isInternalToken returns true for the token", () => {
    const token = internalToken();
    expect(isInternalToken(token)).toBe(true);
  });

  it("isInternalToken returns false for wrong value", () => {
    internalToken(); // create token
    expect(isInternalToken("wrong")).toBe(false);
  });

  it("isInternalToken returns false for null", () => {
    internalToken();
    expect(isInternalToken(null)).toBe(false);
  });

  it("isInternalToken returns false for empty string", () => {
    internalToken();
    expect(isInternalToken("")).toBe(false);
  });
});
