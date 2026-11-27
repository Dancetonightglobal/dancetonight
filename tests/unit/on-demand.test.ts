import { describe, expect, it, vi } from "vitest";

import { INGEST_DISPATCH_URL, ON_DEMAND_METROS, onDemandMetro } from "@/src/edge/ingest-trigger";
import {
  DISPATCH_GRACE_MS,
  ON_DEMAND_DAILY_CAP,
  ON_DEMAND_STALE_MS,
  RUNNING_MAX_MS,
  dayKey,
  decideRefresh,
  dispatchCityRead,
  dispatchKey,
  readCounters,
  recordDispatch,
} from "@/src/edge/on-demand";
import type { SnapshotStore } from "@/src/edge/snapshot-store";

const NOW = new Date("2026-11-27T15:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const base = {
  now: NOW,
  lastSuccessAt: null,
  runningSince: null,
  dispatchedAt: null,
  startsToday: 0,
};

function memoryStore(): SnapshotStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k) ?? null,
    put: async (k, v) => void data.set(k, v),
    delete: async (k) => void data.delete(k),
  };
}

describe("onDemandMetro (D-899)", () => {
  it("covers London and the daily metros, never New York", () => {
    expect(onDemandMetro("nyc")).toBeNull();
    expect(onDemandMetro("london")).toEqual({ slug: "london", tz: "Europe/London" });
    expect(onDemandMetro("paris")?.tz).toBe("Europe/Paris");
    expect(onDemandMetro("atlantis")).toBeNull();
    expect(ON_DEMAND_METROS.map((m) => m.slug)).not.toContain("nyc");
  });
});

describe("decideRefresh (D-899)", () => {
  it("starts a read for a city never read", () => {
    expect(decideRefresh(base)).toBe("dispatch");
  });

  it("starts a read when the last good read is older than the stale window", () => {
    expect(decideRefresh({ ...base, lastSuccessAt: ago(ON_DEMAND_STALE_MS + 1) })).toBe("dispatch");
  });

  it("starts nothing when the last good read is recent", () => {
    expect(decideRefresh({ ...base, lastSuccessAt: ago(ON_DEMAND_STALE_MS - 1) })).toBe("fresh");
  });

  it("says updating while a read runs, stale or not", () => {
    expect(decideRefresh({ ...base, runningSince: ago(5 * 60_000) })).toBe("updating");
    expect(
      decideRefresh({
        ...base,
        lastSuccessAt: ago(60_000),
        runningSince: ago(60_000),
      }),
    ).toBe("updating");
  });

  it("treats a run 'running' for too long as crashed, and starts a new one", () => {
    expect(decideRefresh({ ...base, runningSince: ago(RUNNING_MAX_MS + 1) })).toBe("dispatch");
  });

  it("says updating just after a start, before the run shows up, and starts no second read", () => {
    expect(
      decideRefresh({
        ...base,
        lastSuccessAt: ago(ON_DEMAND_STALE_MS * 2),
        dispatchedAt: ago(DISPATCH_GRACE_MS - 1),
      }),
    ).toBe("updating");
  });

  it("reads as fresh once the started read has finished", () => {
    expect(
      decideRefresh({
        ...base,
        dispatchedAt: ago(10 * 60_000),
        lastSuccessAt: ago(60_000),
      }),
    ).toBe("fresh");
  });

  it("a start that never ran (grace over, still stale) may start again", () => {
    expect(
      decideRefresh({
        ...base,
        lastSuccessAt: ago(ON_DEMAND_STALE_MS * 2),
        dispatchedAt: ago(DISPATCH_GRACE_MS + 1),
      }),
    ).toBe("dispatch");
  });

  it("stops at the daily cap", () => {
    expect(decideRefresh({ ...base, startsToday: ON_DEMAND_DAILY_CAP })).toBe("capped");
    expect(decideRefresh({ ...base, startsToday: ON_DEMAND_DAILY_CAP - 1 })).toBe("dispatch");
  });
});

describe("the KV counters", () => {
  it("record a start and read it back, with today's count", async () => {
    const store = memoryStore();
    expect(await readCounters(store, "paris", NOW)).toEqual({
      dispatchedAt: null,
      startsToday: 0,
    });
    await recordDispatch(store, "paris", NOW, 0);
    await recordDispatch(store, "berlin", NOW, 1);
    expect(store.data.get(dispatchKey("paris"))).toBe(NOW.toISOString());
    expect(store.data.get(dayKey(NOW))).toBe("2");
    expect(await readCounters(store, "paris", NOW)).toEqual({ dispatchedAt: NOW, startsToday: 2 });
  });

  it("read bad values as none", async () => {
    const store = memoryStore();
    store.data.set(dispatchKey("paris"), "not a date");
    store.data.set(dayKey(NOW), "lots");
    expect(await readCounters(store, "paris", NOW)).toEqual({
      dispatchedAt: null,
      startsToday: 0,
    });
  });
});

describe("dispatchCityRead", () => {
  it("sends the city's full read to the ingest workflow", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 204, text: async () => "" });
    await dispatchCityRead("paris", "Europe/Paris", NOW, "tok", fetchFn);
    const [url, options] = fetchFn.mock.calls[0]!;
    expect(url).toBe(INGEST_DISPATCH_URL);
    expect(options.headers.authorization).toBe("Bearer tok");
    expect(JSON.parse(options.body)).toEqual({
      ref: "main",
      inputs: { metro: "paris", full_read: "true", discover: "true", seed_venues: "false" },
    });
  });

  it("throws when GitHub refuses, naming the city", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 422, text: async () => "no" });
    await expect(dispatchCityRead("paris", "Europe/Paris", NOW, "tok", fetchFn)).rejects.toThrow(
      /paris failed: 422 no/,
    );
  });
});
