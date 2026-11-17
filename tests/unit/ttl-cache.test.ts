import { describe, it, expect, vi } from "vitest";
import { createTtlCache } from "@/src/data/ttl-cache";

describe("TtlCache", () => {
  it("returns cached value within ttl", async () => {
    const now = vi.fn(() => 1000);
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 10, now });
    const load = vi.fn(() => Promise.resolve("value"));
    const result1 = await cache.get("key", load);
    expect(result1).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
    now.mockReturnValue(1500);
    const result2 = await cache.get("key", load);
    expect(result2).toBe("value");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reloads after ttl", async () => {
    const now = vi.fn(() => 1000);
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 10, now });
    const load = vi.fn(() => Promise.resolve("value"));
    await cache.get("key", load);
    expect(load).toHaveBeenCalledTimes(1);
    now.mockReturnValue(2500);
    const result = await cache.get("key", load);
    expect(result).toBe("value");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never shares a pending load: concurrent gets each load (Workers request isolation)", async () => {
    const now = vi.fn(() => 1000);
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 10, now });
    const load = vi.fn(
      () => new Promise<string>((resolve) => setTimeout(() => resolve("value"), 10)),
    );
    const [r1, r2] = await Promise.all([cache.get("key", load), cache.get("key", load)]);
    expect(r1).toBe("value");
    expect(r2).toBe("value");
    expect(load).toHaveBeenCalledTimes(2);
    await cache.get("key", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache rejected loads", async () => {
    const now = vi.fn(() => 1000);
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 10, now });
    const load = vi.fn(() => Promise.reject(new Error("failed")));
    await expect(cache.get("key", load)).rejects.toThrow("failed");
    expect(load).toHaveBeenCalledTimes(1);
    const load2 = vi.fn(() => Promise.resolve("success"));
    const result = await cache.get("key", load2);
    expect(result).toBe("success");
    expect(load2).toHaveBeenCalledTimes(1);
  });

  it("ttlMs <= 0 disables caching", async () => {
    const cache = createTtlCache<string>({ ttlMs: 0, maxEntries: 10 });
    const load = vi.fn(() => Promise.resolve("value"));
    await cache.get("key", load);
    await cache.get("key", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("evicts oldest entries when exceeding maxEntries", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 2 });
    const load = vi.fn((key: string) => Promise.resolve(key));
    await cache.get("a", () => load("a"));
    await cache.get("b", () => load("b"));
    expect(cache.size).toBe(2);
    await cache.get("c", () => load("c"));
    expect(cache.size).toBe(2);
    // a should be evicted
    const loadA = vi.fn(() => Promise.resolve("a2"));
    await cache.get("a", loadA);
    expect(loadA).toHaveBeenCalledTimes(1);
  });

  it("size reflects stored entries", async () => {
    const cache = createTtlCache<string>({ ttlMs: 1000, maxEntries: 5 });
    const load = vi.fn(() => Promise.resolve("value"));
    expect(cache.size).toBe(0);
    await cache.get("key", load);
    expect(cache.size).toBe(1);
  });
});
