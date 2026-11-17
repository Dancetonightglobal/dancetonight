/**
 * A random token made once per isolate (crypto.randomUUID()), kept on globalThis under
 * Symbol.for("dancetonight.internal-token"). worker.ts's scheduled() sends it to the internal route through the
 * in-process handler; no outside request can know it.
 */
export function internalToken(): string {
  const symbol = Symbol.for("dancetonight.internal-token");
  let token = (globalThis as Record<symbol, unknown>)[symbol];
  if (typeof token === "string") {
    return token;
  }
  token = crypto.randomUUID();
  (globalThis as Record<symbol, unknown>)[symbol] = token;
  return token as string;
}

/**
 * True when `value` equals this isolate's token (constant-time compare not needed: the token never leaves the isolate).
 * Must NOT create a token when none exists: if no token was made in this isolate, return false.
 */
export function isInternalToken(value: string | null): boolean {
  if (value === null || value === "") {
    return false;
  }
  const symbol = Symbol.for("dancetonight.internal-token");
  const token = (globalThis as Record<symbol, unknown>)[symbol];
  return typeof token === "string" && token === value;
}
