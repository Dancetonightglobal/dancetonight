/**
 * City snapshot reader: serve the snapshot, rebuild it in the background.
 * A city is answered from the snapshot built when its read finished and kept until its next read;
 * a stale one is served while one background rebuild runs; no snapshot, a searched place, or a
 * night outside it -> the database, as before.
 * (the owner 2026-11-03)
 */

import type { CitySnapshot } from "./city-snapshot";
import type { Listing } from "@/src/domain/listing";
import type { NightDate } from "@/src/domain/tonight";
import type { Point } from "./repository";
import type { SnapshotStore } from "@/src/edge/snapshot-store";
import type { SharedStore } from "./shared-cache";
import {
  snapshotKey,
  encodeSnapshot,
  decodeSnapshot,
  answerFromSnapshot,
  metroStamp,
  snapshotStale,
  SNAPSHOT_MAX_BYTES,
} from "./city-snapshot";

export const SNAPSHOT_SHARED_SECONDS = 60; // Cache API copy of a snapshot / of the stamps, per data centre
export const SNAPSHOT_LOCK_SECONDS = 120; // KV lock/<slug> expiration (KV's minimum is 60)
export const SNAPSHOT_RETRY_MS = 60_000; // cooldown between rebuild attempts for a city

export interface SnapshotMetro {
  id: string;
  slug: string;
  center: Point;
  radiusKm: number;
}

export interface SnapshotReaderDeps {
  store: SnapshotStore; // KV
  shared: SharedStore | null; // Cache API, may be null
  build: (slug: string, now: Date) => Promise<CitySnapshot | null>;
  stamps: () => Promise<Map<string | null, number>>; // metro id / null -> ms
  background: ((p: Promise<unknown>) => void) | null; // waitUntil; null = never rebuild
  ttlMs?: number; // per-isolate caches, default 60_000
  maxBytes?: number; // default SNAPSHOT_MAX_BYTES
  now?: () => Date; // default () => new Date()
  log?: (message: string) => void; // default console.warn
}

export function roundedCenter(p: Point): Point {
  return {
    lat: Number(p.lat.toFixed(5)),
    lng: Number(p.lng.toFixed(5)),
  };
}

const snapshotUrl = (slug: string): string =>
  `https://shared-cache.dancetonight.internal/snapshot-v1/${encodeURIComponent(slug)}`;

export class SnapshotReader {
  private deps: SnapshotReaderDeps;
  private cache = new Map<string, { value: CitySnapshot | null; expires: number }>();
  private stampCache: { value: Map<string | null, number>; expires: number } | null = null;
  private attempts = new Map<string, number>(); // slug -> start time of last attempt

  constructor(deps: SnapshotReaderDeps) {
    this.deps = {
      ttlMs: 60_000,
      maxBytes: SNAPSHOT_MAX_BYTES,
      now: () => new Date(),
      log: (msg) => console.warn(msg),
      ...deps,
    };
  }

  async answer(
    metro: SnapshotMetro,
    center: Point,
    radiusKm: number,
    nights: NightDate[],
    unplacedMetroId: string | null,
  ): Promise<Listing[] | null> {
    // 1. Not the city's own query -> return null WITHOUT touching KV, shared or stamps
    const rounded = roundedCenter(center);
    const metroRounded = roundedCenter(metro.center);
    if (
      rounded.lat !== metroRounded.lat ||
      rounded.lng !== metroRounded.lng ||
      radiusKm !== metro.radiusKm
    ) {
      return null;
    }

    // 2. Read snapshot
    const snap = await this.read(metro.slug);
    if (snap === null) {
      this.schedule(metro);
      return null;
    }

    // 3. Get current stamp (if stamps() throws, treat as not stale)
    let stamp: number;
    try {
      const stamps = await this.currentStamps();
      stamp = metroStamp(stamps, metro.id);
    } catch {
      stamp = snap.stamp; // treat as not stale
    }

    // 4. If stale, schedule rebuild (still use old snapshot)
    if (snapshotStale(snap, stamp, nights)) {
      this.schedule(metro, snap.builtAt);
    }

    // 5. Return answerFromSnapshot (may be null)
    return answerFromSnapshot(snap, rounded, radiusKm, nights, unplacedMetroId);
  }

  private async read(slug: string): Promise<CitySnapshot | null> {
    // Per‑isolate cache
    const now = this.deps.now!().getTime();
    const cached = this.cache.get(slug);
    if (cached && now < cached.expires) {
      return cached.value;
    }

    const SNAP_URL = snapshotUrl(slug);

    // Try shared store first
    if (this.deps.shared) {
      try {
        const sharedText = await this.deps.shared.get(SNAP_URL);
        if (sharedText !== null) {
          const decoded = decodeSnapshot(sharedText);
          if (decoded !== null) {
            this.setCache(slug, decoded);
            return decoded;
          }
        }
      } catch {
        // fall through
      }
    }

    // Try KV
    try {
      const kvText = await this.deps.store.get(snapshotKey(slug));
      if (kvText !== null) {
        const decoded = decodeSnapshot(kvText);
        if (decoded !== null) {
          // Store in shared cache (ignore errors)
          if (this.deps.shared) {
            this.deps.shared.put(SNAP_URL, kvText, SNAPSHOT_SHARED_SECONDS).catch(() => {});
          }
          this.setCache(slug, decoded);
          return decoded;
        }
      }
    } catch {
      // fall through
    }

    // No snapshot found
    this.setCache(slug, null);
    return null;
  }

  private setCache(slug: string, value: CitySnapshot | null): void {
    const ttl = this.deps.ttlMs!;
    if (ttl === 0) {
      // ttlMs 0 means never cache
      return;
    }
    const expires = this.deps.now!().getTime() + ttl;
    this.cache.set(slug, { value, expires });

    // Keep at most 32 entries
    if (this.cache.size > 32) {
      // Delete the oldest inserted (first key in insertion order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  private async currentStamps(): Promise<Map<string | null, number>> {
    const now = this.deps.now!().getTime();
    if (this.stampCache && now < this.stampCache.expires) {
      return this.stampCache.value;
    }

    const STAMP_URL = "https://shared-cache.dancetonight.internal/metro-stamps-v1/current";

    // Try shared store
    if (this.deps.shared) {
      try {
        const sharedText = await this.deps.shared.get(STAMP_URL);
        if (sharedText !== null) {
          const parsed = JSON.parse(sharedText) as unknown;
          if (Array.isArray(parsed)) {
            const map = new Map<string | null, number>();
            for (const [key, ms] of parsed) {
              if ((typeof key === "string" || key === null) && typeof ms === "number") {
                map.set(key, ms);
              }
            }
            this.stampCache = {
              value: map,
              expires: now + this.deps.ttlMs!,
            };
            return map;
          }
        }
      } catch {
        // fall through
      }
    }

    // Fall back to deps.stamps()
    const stamps = await this.deps.stamps();
    // Store in shared cache (ignore errors)
    if (this.deps.shared) {
      const arr = Array.from(stamps.entries());
      const text = JSON.stringify(arr);
      this.deps.shared.put(STAMP_URL, text, SNAPSHOT_SHARED_SECONDS).catch(() => {});
    }
    this.stampCache = {
      value: stamps,
      expires: now + this.deps.ttlMs!,
    };
    return stamps;
  }

  private schedule(metro: SnapshotMetro, staleBuiltAt?: Date): void {
    if (this.deps.background === null) {
      return;
    }
    const now = this.deps.now!().getTime();
    const lastAttempt = this.attempts.get(metro.slug);
    if (lastAttempt !== undefined && now - lastAttempt < SNAPSHOT_RETRY_MS) {
      return;
    }
    // Keep at most 64 entries
    if (this.attempts.size >= 64) {
      const firstKey = this.attempts.keys().next().value;
      if (firstKey !== undefined) {
        this.attempts.delete(firstKey);
      }
    }
    this.attempts.set(metro.slug, now);
    this.deps.background(this.rebuild(metro.slug, metro.id, staleBuiltAt));
  }

  async rebuild(
    slug: string,
    metroId: string,
    staleBuiltAt?: Date,
  ): Promise<"built" | "fresh" | "locked" | "too-big" | "missing" | "failed"> {
    const { store, shared, build, stamps, now, log, maxBytes } = this.deps;

    // 1. Lock
    try {
      if (await store.get("lock/" + slug)) {
        return "locked";
      }
    } catch {
      // If get throws, we still try to put the lock (best effort)
    }
    try {
      await store.put("lock/" + slug, "1", { expirationTtl: SNAPSHOT_LOCK_SECONDS });
    } catch {
      // continue anyway
    }

    // 2. Fresh check (bypass caches)
    let current: CitySnapshot | null = null;
    let currentText: string | null = null;
    try {
      currentText = await store.get(snapshotKey(slug));
      if (currentText !== null) {
        current = decodeSnapshot(currentText);
      }
    } catch {
      // treat as missing
    }
    let stampMap: Map<string | null, number>;
    try {
      stampMap = await stamps();
    } catch {
      // If stamps() throws, we cannot do fresh check; proceed to build
      stampMap = new Map();
    }
    if (
      current !== null &&
      metroStamp(stampMap, metroId) <= current.stamp &&
      (staleBuiltAt === undefined || current.builtAt.getTime() > staleBuiltAt.getTime())
    ) {
      // Put in isolate cache and shared
      this.setCache(slug, current);
      if (shared && currentText !== null) {
        shared.put(snapshotUrl(slug), currentText, SNAPSHOT_SHARED_SECONDS).catch(() => {});
      }
      return "fresh";
    }

    // 3. Build
    let built: CitySnapshot | null;
    try {
      built = await build(slug, now!());
    } catch {
      return "failed";
    }
    if (built === null) {
      return "missing";
    }

    // 4. Encode and check size
    const text = encodeSnapshot(built, maxBytes);
    if (text === null) {
      log!(`city snapshot too big: ${slug}`);
      return "too-big";
    }

    // 5. Store
    try {
      await store.put(snapshotKey(slug), text);
    } catch {
      return "failed";
    }

    // Update caches
    this.setCache(slug, built);
    if (shared) {
      shared.put(snapshotUrl(slug), text, SNAPSHOT_SHARED_SECONDS).catch(() => {});
    }
    return "built";
  }
}
