/**
 * City result snapshots live in Cloudflare Workers KV, bound as SNAPSHOTS.
 * One JSON snapshot per city under `city/<slug>`, built when the city's read finishes,
 * kept until its next read. The binding is created by the deploy workflow.
 */

/** The subset of Workers KV the snapshot code uses. */
export interface SnapshotStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

let testOverride: SnapshotStore | null | undefined = undefined;

/** Test hook: when set (not undefined), snapshotStore() returns this instead of looking at the context. */
export function setSnapshotStoreForTests(store: SnapshotStore | null | undefined): void {
  testOverride = store;
}

/** The SNAPSHOTS KV binding of the running Worker, else null (Node, tests, mock mode). Never throws. */
export function snapshotStore(): SnapshotStore | null {
  if (testOverride !== undefined) {
    return testOverride;
  }

  try {
    const context = (globalThis as Record<symbol, unknown>)[Symbol.for("__cloudflare-context__")];
    const env = (context as { env?: { SNAPSHOTS?: unknown } } | undefined)?.env;
    const binding = env?.SNAPSHOTS;

    if (
      binding &&
      typeof binding === "object" &&
      typeof (binding as { get?: unknown }).get === "function" &&
      typeof (binding as { put?: unknown }).put === "function" &&
      typeof (binding as { delete?: unknown }).delete === "function"
    ) {
      // Wrap to ensure correct method signatures and this binding
      return {
        get: (key: string) =>
          (binding as { get: (k: string, t: "text") => Promise<string | null> }).get(key, "text"),
        put: (key: string, value: string, options?: { expirationTtl?: number }) => {
          if (options !== undefined) {
            return (
              binding as {
                put: (k: string, v: string, o?: { expirationTtl?: number }) => Promise<void>;
              }
            ).put(key, value, options);
          } else {
            return (binding as { put: (k: string, v: string) => Promise<void> }).put(key, value);
          }
        },
        delete: (key: string) => (binding as { delete: (k: string) => Promise<void> }).delete(key),
      };
    }
  } catch {
    // ignore any exception
  }

  return null;
}
