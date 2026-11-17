import { listingsFromSeed } from "@/src/data/mock-repository";
import { seedNyc } from "@/src/db/seed/nyc";
import { describe, expect, it, vi } from "vitest";
import {
  cloudflareStore,
  decodeShared,
  encodeShared,
  sharedGet,
  sharedStamp,
  STAMP_URL,
  STAMP_SHARED_SECONDS,
  currentWaitUntil,
} from "@/src/data/shared-cache";

describe("shared-cache", () => {
  describe("sharedGet", () => {
    it("second call with same stamp is served from store", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi.fn(async () => ({ data: "value" }));
      const stamp = vi.fn(async () => "stamp1");

      const result1 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ data: "value" });

      const result2 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
      });
      expect(load).toHaveBeenCalledTimes(1); // still 1
      expect(result2).toEqual({ data: "value" });
    });

    it("new stamp misses and calls load again", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi.fn(async () => ({ data: "value" }));
      let stampCall = 0;
      const stamp = vi.fn(async () => {
        stampCall++;
        return `stamp${stampCall}`;
      });

      await sharedGet({ store, namespace: "test", key: "key1", stamp, load });
      expect(load).toHaveBeenCalledTimes(1);

      await sharedGet({ store, namespace: "test", key: "key1", stamp, load });
      expect(load).toHaveBeenCalledTimes(2);
    });

    it("store: null calls load every time", async () => {
      const load = vi.fn(async () => ({ data: "value" }));
      const stamp = vi.fn(async () => "stamp");

      const result1 = await sharedGet({
        store: null,
        namespace: "test",
        key: "key1",
        stamp,
        load,
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(result1).toEqual({ data: "value" });

      const result2 = await sharedGet({
        store: null,
        namespace: "test",
        key: "key1",
        stamp,
        load,
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(result2).toEqual({ data: "value" });
    });

    it("store that throws still returns load()'s value", async () => {
      const store = {
        get: async () => {
          throw new Error("get failed");
        },
        put: async () => {
          throw new Error("put failed");
        },
      };
      const load = vi.fn(async () => ({ data: "value" }));
      const stamp = vi.fn(async () => "stamp");

      const result = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: "value" });
    });

    it("stamp that throws still returns load()'s value", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi.fn(async () => ({ data: "value" }));
      const stamp = vi.fn(async () => {
        throw new Error("stamp error");
      });

      const result = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: "value" });
    });
  });

  describe("sharedGet with background refresh (D-586)", () => {
    it("first call ever (no latest): foreground load, stores url and latest", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi.fn(async () => ({ data: "value1" }));
      const stamp = vi.fn(async () => "stamp1");
      const pending: Promise<unknown>[] = [];
      const background = (p: Promise<unknown>) => pending.push(p);

      const result = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(load).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ data: "value1" });
      await Promise.all(pending);

      const stampedUrl = `https://shared-cache.dancetonight.internal/test/${encodeURIComponent("stamp1")}/${encodeURIComponent("key1")}`;
      const latestUrl = `https://shared-cache.dancetonight.internal/test/~latest/${encodeURIComponent("key1")}`;
      expect(map.get(stampedUrl)).toBe(encodeShared({ data: "value1" }));
      const latest = JSON.parse(map.get(latestUrl)!);
      expect(latest.stamp).toBe("stamp1");
      expect(decodeShared(latest.body)).toEqual({ data: "value1" });
    });

    it("same stamp again: hit, load not called", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi.fn(async () => ({ data: "value" }));
      const stamp = vi.fn(async () => "stamp1");
      const pending: Promise<unknown>[] = [];
      const background = (p: Promise<unknown>) => pending.push(p);

      // First call
      await sharedGet({ store, namespace: "test", key: "key1", stamp, load, background });
      expect(load).toHaveBeenCalledTimes(1);
      load.mockClear();

      // Second call same stamp
      const result = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(load).toHaveBeenCalledTimes(0);
      expect(result).toEqual({ data: "value" });
    });

    it("stamp moves, latest exists, background given: returns old value, refreshes in background", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi
        .fn()
        .mockResolvedValueOnce({ data: "old" }) // first stamp
        .mockResolvedValueOnce({ data: "new" }); // second stamp
      const stamp = vi.fn().mockResolvedValue("stamp2").mockResolvedValueOnce("stamp1");

      const pending: Promise<unknown>[] = [];
      const background = (p: Promise<unknown>) => pending.push(p);

      // First call under stamp1
      const result1 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(result1).toEqual({ data: "old" });
      expect(load).toHaveBeenCalledTimes(1);
      await Promise.all(pending);

      // Second call under stamp2 (stamp moved)
      const result2 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      // Should return old value immediately
      expect(result2).toEqual({ data: "old" });
      // load should have been called a second time (in background)
      expect(load).toHaveBeenCalledTimes(2);
      await Promise.all(pending);

      // Verify latest updated
      const latestUrl = `https://shared-cache.dancetonight.internal/test/~latest/${encodeURIComponent("key1")}`;
      const latest = JSON.parse(map.get(latestUrl)!);
      expect(latest.stamp).toBe("stamp2");
      expect(decodeShared(latest.body)).toEqual({ data: "new" });

      // Third call under stamp2 should hit stamped cache
      const result3 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(result3).toEqual({ data: "new" });
      expect(load).toHaveBeenCalledTimes(2); // still 2
    });

    it("stamp moves, latest exists, background null: foreground load, returns new value", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi
        .fn()
        .mockResolvedValueOnce({ data: "old" })
        .mockResolvedValueOnce({ data: "new" });
      const stamp = vi.fn().mockResolvedValue("stamp2").mockResolvedValueOnce("stamp1");

      // First call
      await sharedGet({ store, namespace: "test", key: "key1", stamp, load, background: null });
      expect(load).toHaveBeenCalledTimes(1);

      // Second call under new stamp, background null
      const result = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background: null,
      });
      expect(load).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ data: "new" });
    });

    it("two concurrent calls under moved stamp: one background load only", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi
        .fn()
        .mockResolvedValueOnce({ data: "old" })
        .mockResolvedValueOnce({ data: "new" });
      const stamp = vi.fn().mockResolvedValue("stamp2").mockResolvedValueOnce("stamp1");

      const pending: Promise<unknown>[] = [];
      const background = (p: Promise<unknown>) => pending.push(p);

      // First call under stamp1
      await sharedGet({ store, namespace: "test", key: "key1", stamp, load, background });
      expect(load).toHaveBeenCalledTimes(1);
      await Promise.all(pending);

      // Reset pending
      pending.length = 0;
      // Two concurrent calls under stamp2
      const [resultA, resultB] = await Promise.all([
        sharedGet({ store, namespace: "test", key: "key1", stamp, load, background }),
        sharedGet({ store, namespace: "test", key: "key1", stamp, load, background }),
      ]);
      // Both should return old value
      expect(resultA).toEqual({ data: "old" });
      expect(resultB).toEqual({ data: "old" });
      // load should have been called only once more (total 2)
      expect(load).toHaveBeenCalledTimes(2);
      expect(pending).toHaveLength(1); // one background promise
    });

    it("background load rejects: old value returned, next call tries again", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi
        .fn()
        .mockResolvedValueOnce({ data: "old" })
        .mockRejectedValueOnce(new Error("load failed"))
        .mockResolvedValueOnce({ data: "recovered" });
      const stamp = vi
        .fn()
        .mockResolvedValue("stamp2") // stamp2 from the second call on
        .mockResolvedValueOnce("stamp1");

      const pending: Promise<unknown>[] = [];
      const background = (p: Promise<unknown>) => pending.push(p);

      // First call
      await sharedGet({ store, namespace: "test", key: "key1", stamp, load, background });
      expect(load).toHaveBeenCalledTimes(1);
      await Promise.all(pending);

      // Second call under new stamp, background load will reject
      const result2 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(result2).toEqual({ data: "old" });
      expect(load).toHaveBeenCalledTimes(2); // called but rejected
      await Promise.all(pending); // background promise resolves (does not reject)

      // Third call under same stamp (stamp2) should try again (no latest updated)
      const result3 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      // Still the old copy at once, while the retry runs in the background.
      expect(result3).toEqual({ data: "old" });
      expect(load).toHaveBeenCalledTimes(3);
      await Promise.all(pending);
      const result4 = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(result4).toEqual({ data: "recovered" });
      expect(load).toHaveBeenCalledTimes(3);
    });

    it("corrupt latest: treated as no latest -> foreground load", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string) => {
          map.set(url, body);
        },
      };
      const load = vi.fn().mockResolvedValue({ data: "fresh" });
      const stamp = vi.fn().mockResolvedValue("stamp1");
      const pending: Promise<unknown>[] = [];
      const background = (p: Promise<unknown>) => pending.push(p);

      // Put corrupt latest
      const latestUrl = `https://shared-cache.dancetonight.internal/test/~latest/${encodeURIComponent("key1")}`;
      map.set(latestUrl, "not json");

      const result = await sharedGet({
        store,
        namespace: "test",
        key: "key1",
        stamp,
        load,
        background,
      });
      expect(result).toEqual({ data: "fresh" });
      expect(load).toHaveBeenCalledTimes(1);
      // latest should have been overwritten
      const latest = JSON.parse(map.get(latestUrl)!);
      expect(latest.stamp).toBe("stamp1");
      expect(decodeShared(latest.body)).toEqual({ data: "fresh" });
    });

    it("values with Dates survive latest round trip", () => {
      const original = { date: new Date("2026-11-02T22:00:00Z"), text: "hello" };
      const encoded = encodeShared(original);
      const latest = { stamp: "stamp", body: encoded };
      const stored = JSON.stringify(latest);
      const parsed = JSON.parse(stored) as { stamp: string; body: string };
      const decoded = decodeShared<typeof original>(parsed.body);
      expect(decoded.date).toBeInstanceOf(Date);
      expect(decoded.date.getTime()).toBe(original.date.getTime());
      expect(decoded.text).toBe(original.text);
    });
  });

  describe("sharedStamp", () => {
    it("miss: calls read once, stores the value, returns it", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string, ttlSeconds: number) => {
          map.set(url, body);
        },
      };
      const read = vi.fn(async () => "stamp123");
      const result1 = await sharedStamp({ store, read });
      expect(read).toHaveBeenCalledTimes(1);
      expect(result1).toBe("stamp123");
      expect(map.get(STAMP_URL)).toBe("stamp123");

      const result2 = await sharedStamp({ store, read });
      expect(read).toHaveBeenCalledTimes(1); // still 1
      expect(result2).toBe("stamp123");
    });

    it("hit: returns stored stamp without calling read", async () => {
      const map = new Map<string, string>([[STAMP_URL, "stamp456"]]);
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string, ttlSeconds: number) => {
          map.set(url, body);
        },
      };
      const read = vi.fn(async () => "should-not-be-called");
      const result = await sharedStamp({ store, read });
      expect(read).toHaveBeenCalledTimes(0);
      expect(result).toBe("stamp456");
    });

    it("store null: read every time", async () => {
      const read = vi.fn(async () => "stamp789");
      const result1 = await sharedStamp({ store: null, read });
      expect(read).toHaveBeenCalledTimes(1);
      expect(result1).toBe("stamp789");

      const result2 = await sharedStamp({ store: null, read });
      expect(read).toHaveBeenCalledTimes(2);
      expect(result2).toBe("stamp789");
    });

    it("store.get throws: read() result returned", async () => {
      const store = {
        get: async () => {
          throw new Error("get failed");
        },
        put: async (url: string, body: string, ttlSeconds: number) => {
          // no-op
        },
      };
      const read = vi.fn(async () => "stamp999");
      const result = await sharedStamp({ store, read });
      expect(read).toHaveBeenCalledTimes(1);
      expect(result).toBe("stamp999");
    });

    it("store.put throws: read() result still returned", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async () => {
          throw new Error("put failed");
        },
      };
      const read = vi.fn(async () => "stamp777");
      const result = await sharedStamp({ store, read });
      expect(read).toHaveBeenCalledTimes(1);
      expect(result).toBe("stamp777");
    });

    it("read throws: sharedStamp rejects", async () => {
      const map = new Map<string, string>();
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string, ttlSeconds: number) => {
          map.set(url, body);
        },
      };
      const read = vi.fn(async () => {
        throw new Error("read error");
      });
      await expect(sharedStamp({ store, read })).rejects.toThrow("read error");
    });

    it("empty stored body: treated as a miss", async () => {
      const map = new Map<string, string>([[STAMP_URL, ""]]);
      const store = {
        get: async (url: string) => map.get(url) ?? null,
        put: async (url: string, body: string, ttlSeconds: number) => {
          map.set(url, body);
        },
      };
      const read = vi.fn(async () => "stamp888");
      const result = await sharedStamp({ store, read });
      expect(read).toHaveBeenCalledTimes(1);
      expect(result).toBe("stamp888");
      expect(map.get(STAMP_URL)).toBe("stamp888");
    });
  });

  describe("encodeShared/decodeShared", () => {
    it("keeps Dates", () => {
      const original = {
        a: new Date("2026-11-02T22:00:00Z"),
        b: [new Date(0)],
        c: "2026-11-02T22:00:00.000Z",
        d: null,
        e: { n: 1 },
      };
      const encoded = encodeShared(original);
      const decoded = decodeShared<typeof original>(encoded);
      expect(decoded.a).toBeInstanceOf(Date);
      expect(decoded.a.getTime()).toBe(original.a.getTime());
      expect(decoded.b[0]).toBeInstanceOf(Date);
      expect(decoded.b[0]!.getTime()).toBe(original.b[0]!.getTime());
      expect(decoded.c).toBe(original.c);
      expect(decoded.d).toBe(original.d);
      expect(decoded.e).toEqual(original.e);
    });

    it("round-trips real listings", () => {
      const listings = listingsFromSeed(seedNyc(new Date("2026-11-02T22:00:00Z")));
      expect(listings.length).toBeGreaterThan(0);
      const decoded = decodeShared<typeof listings>(encodeShared(listings));
      expect(decoded).toEqual(listings);
      expect(decoded[0]!.startsAt instanceof Date || decoded[0]!.startsAt === null).toBe(true);
    });
  });

  describe("cloudflareStore", () => {
    it("returns null in Node (no caches global)", () => {
      const store = cloudflareStore();
      expect(store).toBeNull();
    });
  });

  describe("currentWaitUntil", () => {
    it("returns null in Node (no symbol)", () => {
      const result = currentWaitUntil();
      expect(result).toBeNull();
    });

    it("returns a function when ctx.waitUntil exists", () => {
      const waitUntil = vi.fn();
      const originalSymbol = Symbol.for("__cloudflare-context__");
      const original = (globalThis as Record<symbol, unknown>)[originalSymbol];
      try {
        (globalThis as Record<symbol, unknown>)[originalSymbol] = { ctx: { waitUntil } };
        const result = currentWaitUntil();
        expect(result).toBeInstanceOf(Function);
        const promise = Promise.resolve();
        result!(promise);
        expect(waitUntil).toHaveBeenCalledWith(promise);
      } finally {
        (globalThis as Record<symbol, unknown>)[originalSymbol] = original;
      }
    });

    it("returns null when ctx lacks waitUntil", () => {
      const originalSymbol = Symbol.for("__cloudflare-context__");
      const original = (globalThis as Record<symbol, unknown>)[originalSymbol];
      try {
        (globalThis as Record<symbol, unknown>)[originalSymbol] = { ctx: {} };
        const result = currentWaitUntil();
        expect(result).toBeNull();
      } finally {
        (globalThis as Record<symbol, unknown>)[originalSymbol] = original;
      }
    });

    it("returns null on throw", () => {
      const originalSymbol = Symbol.for("__cloudflare-context__");
      // Store the original value
      const original = (globalThis as Record<symbol, unknown>)[originalSymbol];
      // Delete the property to avoid setter issues
      delete (globalThis as Record<symbol, unknown>)[originalSymbol];
      try {
        // Provoke a TypeError by making the getter throw
        Object.defineProperty(globalThis, originalSymbol, {
          get() {
            throw new Error("cannot read");
          },
          configurable: true,
        });
        const result = currentWaitUntil();
        expect(result).toBeNull();
      } finally {
        // Restore by deleting and re-adding if original exists
        delete (globalThis as Record<symbol, unknown>)[originalSymbol];
        if (original !== undefined) {
          (globalThis as Record<symbol, unknown>)[originalSymbol] = original;
        }
      }
    });
  });
});
