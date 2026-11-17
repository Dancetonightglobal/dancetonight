import { describe, it, expect, afterEach, vi } from "vitest";
import { snapshotStore, setSnapshotStoreForTests } from "../../src/edge/snapshot-store";

const SYMBOL = Symbol.for("__cloudflare-context__");

afterEach(() => {
  // Clean up global symbol
  delete (globalThis as Record<symbol, unknown>)[SYMBOL];
  // Reset test override
  setSnapshotStoreForTests(undefined);
});

describe("snapshotStore", () => {
  it("no context -> null", () => {
    expect(snapshotStore()).toBeNull();
  });

  it("context without env.SNAPSHOTS -> null", () => {
    (globalThis as Record<symbol, unknown>)[SYMBOL] = { env: {} };
    expect(snapshotStore()).toBeNull();
  });

  it("env.SNAPSHOTS missing delete -> null", () => {
    const fakeBinding = {
      get: vi.fn(),
      put: vi.fn(),
      // missing delete
    };
    (globalThis as Record<symbol, unknown>)[SYMBOL] = { env: { SNAPSHOTS: fakeBinding } };
    expect(snapshotStore()).toBeNull();
  });

  it("valid fake binding works and methods are called correctly", async () => {
    const calls: unknown[] = [];
    class FakeBinding {
      get(key: string, type: "text") {
        calls.push(["get", key, type]);
        expect(this).toBeInstanceOf(FakeBinding);
        return Promise.resolve("x");
      }
      put(key: string, value: string, options?: { expirationTtl?: number }) {
        calls.push(["put", key, value, options]);
        expect(this).toBeInstanceOf(FakeBinding);
        return Promise.resolve();
      }
      delete(key: string) {
        calls.push(["delete", key]);
        expect(this).toBeInstanceOf(FakeBinding);
        return Promise.resolve();
      }
    }
    const fake = new FakeBinding();
    (globalThis as Record<symbol, unknown>)[SYMBOL] = { env: { SNAPSHOTS: fake } };

    const store = snapshotStore();
    expect(store).not.toBeNull();

    const result = await store!.get("city/nyc");
    expect(result).toBe("x");
    expect(calls).toEqual([["get", "city/nyc", "text"]]);

    await store!.put("k", "v", { expirationTtl: 120 });
    expect(calls[1]).toEqual(["put", "k", "v", { expirationTtl: 120 }]);

    await store!.put("k", "v");
    expect(calls[2]).toEqual(["put", "k", "v", undefined]);

    await store!.delete("k");
    expect(calls[3]).toEqual(["delete", "k"]);
  });

  it("context getter that throws -> null", () => {
    Object.defineProperty(globalThis, SYMBOL, {
      configurable: true,
      get() {
        throw new Error("intentional");
      },
    });
    expect(snapshotStore()).toBeNull();
  });

  it("setSnapshotStoreForTests(fake) returns the fake", () => {
    const fake = {
      get: () => Promise.resolve(""),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    setSnapshotStoreForTests(fake);
    expect(snapshotStore()).toBe(fake);
  });

  it("setSnapshotStoreForTests(null) returns null even when a valid context exists", () => {
    const fakeBinding = {
      get: () => Promise.resolve(""),
      put: () => Promise.resolve(),
      delete: () => Promise.resolve(),
    };
    (globalThis as Record<symbol, unknown>)[SYMBOL] = { env: { SNAPSHOTS: fakeBinding } };
    setSnapshotStoreForTests(null);
    expect(snapshotStore()).toBeNull();
  });
});
