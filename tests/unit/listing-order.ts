// Order invariants for a listNight result (D-060), shared by the repository tests. They check each
// adjacent pair against the rule in words, so a seed that gains rows cannot make them stale.

import { expect } from "vitest";

import type { Listing } from "@/src/domain/listing";

/** Ascending with null after every known value; 0 for a tie (both null included). */
function nullsLast(a: number | null, b: number | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return a - b;
}

const startOf = (l: Listing) => l.startsAt?.getTime() ?? null;

/**
 * Sort "start": timed listings by start, ties by distance then slug; then every listing whose time
 * is not listed, by distance (unknown last), then slug.
 */
export function expectStartOrder(listings: readonly Listing[]): void {
  for (let i = 1; i < listings.length; i++) {
    const a = listings[i - 1];
    const b = listings[i];
    if (!a || !b) throw new Error("unreachable");
    const pair = `${a.slug} before ${b.slug}`;
    const start = nullsLast(startOf(a), startOf(b));
    expect(start, `${pair}: start, no time last`).toBeLessThanOrEqual(0);
    if (start !== 0) continue;
    const distance = nullsLast(a.distanceKm, b.distanceKm);
    expect(distance, `${pair}: distance`).toBeLessThanOrEqual(0);
    if (distance === 0) expect(a.slug.localeCompare(b.slug), `${pair}: slug`).toBeLessThan(0);
  }
}

/** Sort "distance": by distance (unknown last), ties by start with no time last, then slug. */
export function expectDistanceOrder(listings: readonly Listing[]): void {
  for (let i = 1; i < listings.length; i++) {
    const a = listings[i - 1];
    const b = listings[i];
    if (!a || !b) throw new Error("unreachable");
    const pair = `${a.slug} before ${b.slug}`;
    const distance = nullsLast(a.distanceKm, b.distanceKm);
    expect(distance, `${pair}: distance`).toBeLessThanOrEqual(0);
    if (distance !== 0) continue;
    const start = nullsLast(startOf(a), startOf(b));
    expect(start, `${pair}: start, no time last`).toBeLessThanOrEqual(0);
    if (start === 0) expect(a.slug.localeCompare(b.slug), `${pair}: slug`).toBeLessThan(0);
  }
}
