// A cache shared by every Worker isolate in a data centre (D-578): Cloudflare's Cache API, under
// the per-isolate TtlCache (D-153). Keys carry a change stamp, so when a read (or any job) finishes
// the old entries are never asked for again; the Cache API drops them after SHARED_TTL_SECONDS.
// Values are JSON with Dates kept as Dates. A store failure never fails a page: it reads the DB.
// After the stamp moves, the previous copy is served while one background load refreshes it (D-586),
// so a page can trail a finished job by one refresh.

export const SHARED_TTL_SECONDS = 6 * 60 * 60;
/** How long the change stamp is shared in a data centre's cache (D-582). */
export const STAMP_SHARED_SECONDS = 60;
export const STAMP_URL = "https://shared-cache.dancetonight.internal/stamp-v1/current";

export interface SharedStore {
  get(url: string): Promise<string | null>;
  put(url: string, body: string, ttlSeconds: number): Promise<void>;
}

/** Minimal Cache interface for Cloudflare's Cache API. */
interface Cache {
  match(url: string): Promise<Response | undefined>;
  put(url: string, response: Response): Promise<void>;
}

/** The Cache API's default cache, or null where there is none (Node, tests, mock mode). */
export function cloudflareStore(): SharedStore | null {
  const c = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  if (!c) return null;
  return {
    async get(url: string): Promise<string | null> {
      const r = await c.match(url);
      return r ? await r.text() : null;
    },
    async put(url: string, body: string, ttlSeconds: number): Promise<void> {
      await c.put(
        url,
        new Response(body, {
          headers: {
            "content-type": "application/json",
            "cache-control": `public, max-age=${ttlSeconds}`,
          },
        }),
      );
    },
  };
}

export function encodeShared(value: unknown): string {
  return JSON.stringify(value, function (k, v) {
    const raw = (this as Record<string, unknown>)[k];
    return raw instanceof Date ? { $date: raw.getTime() } : v;
  });
}

export function decodeShared<V>(text: string): V {
  return JSON.parse(text, (_k, v) => {
    if (
      v !== null &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).length === 1 &&
      typeof (v as { $date?: unknown }).$date === "number"
    ) {
      return new Date((v as { $date: number }).$date);
    }
    return v;
  }) as V;
}

/**
 * The change stamp from the shared store, else read() (then stored for STAMP_SHARED_SECONDS).
 * No store -> read(). A store get/put that throws is ignored (get failure = miss). read()'s own error propagates.
 */
export async function sharedStamp(options: {
  store: SharedStore | null;
  read: () => Promise<string>;
}): Promise<string> {
  const { store, read } = options;
  if (store === null) return read();

  try {
    const hit = await store.get(STAMP_URL);
    if (hit !== null && hit !== "") return hit;
  } catch {
    // fall through
  }

  const stamp = await read();
  try {
    await store.put(STAMP_URL, stamp, STAMP_SHARED_SECONDS);
  } catch {
    // ignore
  }
  return stamp;
}

/** The running Worker request's waitUntil, else null (Node, tests, mock mode). */
export function currentWaitUntil(): ((p: Promise<unknown>) => void) | null {
  try {
    const store = (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
    const ctx = (store as { ctx?: { waitUntil?: unknown } } | undefined)?.ctx;
    const waitUntil = ctx?.waitUntil;
    if (typeof waitUntil === "function") return (p) => void waitUntil.call(ctx, p);
  } catch {
    // no context: no background work
  }
  return null;
}

/** URLs whose background refresh is running in this isolate: one at a time per key (D-586). */
const refreshing = new Set<string>();

/**
 * The shared entry for `key` under the current stamp, else load() (stored on success). With no
 * store, or when stamp() or the store throws, it is just load().
 * After the stamp moves, the previous copy is served while one background load refreshes it (D-586),
 * if `background` is a function (defaults to `currentWaitUntil()`).
 */
export async function sharedGet<V>(options: {
  store: SharedStore | null;
  namespace: string;
  key: string;
  stamp: () => Promise<string>;
  load: () => Promise<V>;
  background?: ((p: Promise<unknown>) => void) | null;
}): Promise<V> {
  const { store, namespace, key, stamp, load } = options;
  const background = options.background === undefined ? currentWaitUntil() : options.background;
  if (store === null) return load();

  let stampValue: string;
  let url: string;
  try {
    stampValue = await stamp();
    url = `https://shared-cache.dancetonight.internal/${namespace}/${encodeURIComponent(
      stampValue,
    )}/${encodeURIComponent(key)}`;
  } catch {
    return load();
  }

  // Stamped hit -> return it
  try {
    const hit = await store.get(url);
    if (hit !== null) return decodeShared<V>(hit);
  } catch {
    // fall through
  }

  // Stamped miss -> try latest
  const latestUrl = `https://shared-cache.dancetonight.internal/${namespace}/~latest/${encodeURIComponent(key)}`;
  let latest: { stamp: string; body: string } | null = null;
  try {
    const latestText = await store.get(latestUrl);
    if (latestText !== null) {
      const parsed = JSON.parse(latestText) as unknown;
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "stamp" in parsed &&
        typeof parsed.stamp === "string" &&
        "body" in parsed &&
        typeof parsed.body === "string"
      ) {
        latest = { stamp: parsed.stamp, body: parsed.body };
      }
    }
  } catch {
    // treat as no latest
  }

  if (latest !== null && background !== null) {
    // Serve latest while refreshing in background
    const value = decodeShared<V>(latest.body);
    if (!refreshing.has(url)) {
      refreshing.add(url);
      const refresh = async (): Promise<void> => {
        try {
          const newValue = await load();
          const newBody = encodeShared(newValue);
          const newLatest = JSON.stringify({ stamp: stampValue, body: newBody });
          await Promise.allSettled([
            store.put(url, newBody, SHARED_TTL_SECONDS),
            store.put(latestUrl, newLatest, SHARED_TTL_SECONDS),
          ]);
        } catch {
          // If background load fails, we should not update the latest cache
          // But we need to ensure the running set is cleared
        } finally {
          refreshing.delete(url);
        }
      };
      background(refresh());
    }
    return value;
  }

  // No latest or no background -> foreground load
  const value = await load();
  const newLatest = JSON.stringify({ stamp: stampValue, body: encodeShared(value) });
  try {
    await Promise.allSettled([
      store.put(url, encodeShared(value), SHARED_TTL_SECONDS),
      store.put(latestUrl, newLatest, SHARED_TTL_SECONDS),
    ]);
  } catch {
    // ignore
  }
  return value;
}
