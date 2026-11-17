// The adapter registry that five parallel lanes add to, each in its own file (docs/WORKSTREAMS.md).
import { describe, expect, it } from "vitest";

import { ticketmasterAdapter } from "@/src/adapters/apis/ticketmaster";
import { adapterRegistry, REGISTRY } from "@/src/pipeline/ingest";

describe("the adapter registry", () => {
  it("holds every adapter under its own id", () => {
    for (const [id, adapter] of REGISTRY) expect(adapter.id).toBe(id);
    expect(REGISTRY.get("ticketmaster")).toBe(ticketmasterAdapter);
  });

  it("refuses two adapters with one id, rather than keeping the last", () => {
    expect(() => adapterRegistry([ticketmasterAdapter, { ...ticketmasterAdapter }])).toThrow(
      "two adapters share the id ticketmaster",
    );
  });
});
