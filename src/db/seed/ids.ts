// Deterministic ids for seed rows: UUID v5 (RFC 4122, SHA-1) of "<kind>:<key>" under one project
// namespace, so re-seeding upserts the same rows instead of duplicating them (D-011).

import { createHash } from "node:crypto";

/** The DanceTonight seed namespace (itself a fixed v4-shaped UUID; never change it). */
export const SEED_NAMESPACE = "5a1c3d2e-7b64-4f0a-9c8e-2d1f0e9c8b7a";

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) throw new Error(`Not a UUID: ${uuid}`);
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** UUID v5 of `name` in `namespace`. */
export function uuidV5(name: string, namespace: string = SEED_NAMESPACE): string {
  const hash = createHash("sha1");
  hash.update(uuidBytes(namespace));
  hash.update(name, "utf8");
  const digest = hash.digest();
  const bytes = Uint8Array.prototype.slice.call(digest, 0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type SeedEntity =
  "metro" | "venue" | "organizer" | "source" | "series" | "event" | "event_source" | "provenance";

/** The stable id of one seed row: the same `kind` and `key` always give the same UUID. */
export function seedId(kind: SeedEntity, key: string): string {
  return uuidV5(`${kind}:${key}`);
}
