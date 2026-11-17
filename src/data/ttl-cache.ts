// A small per-isolate cache of finished reads (D-153). Only resolved values are stored: a pending
// promise is never shared, because on Workers a promise driven by one request's I/O must not be
// awaited by another (if the first visitor goes away, the second would hang).

export interface TtlCache<V> {
  /** The cached value for key if younger than ttlMs, else load() (stored on success). */
  get(key: string, load: () => Promise<V>): Promise<V>;
  readonly size: number;
}

export function createTtlCache<V>(options: {
  ttlMs: number;
  maxEntries: number;
  now?: () => number;
}): TtlCache<V> {
  const { ttlMs, maxEntries, now = Date.now } = options;
  const store = new Map<string, { value: V; storedAt: number }>();

  return {
    async get(key: string, load: () => Promise<V>): Promise<V> {
      if (ttlMs <= 0) return load();
      const entry = store.get(key);
      if (entry && now() - entry.storedAt < ttlMs) return entry.value;
      const startedAt = now();
      const value = await load();
      // Re-inserted at the end, so the Map's order stays oldest first.
      store.delete(key);
      store.set(key, { value, storedAt: startedAt });
      for (const oldest of store.keys()) {
        if (store.size <= maxEntries) break;
        store.delete(oldest);
      }
      return value;
    },

    get size(): number {
      return store.size;
    },
  };
}
