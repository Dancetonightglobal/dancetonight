// D-791: Paris 11-08. tango-argentin.fr/ile-de-france was seeded kind "html" with platform "tango_argentin".
// ingest probes every "html" row whose platform is not "probed" and writes the probe's platform over the seed's,
// so the reader never ran and the model read the page instead (#1344 fixed the seed). Every city: a seed of kind
// "html" names no platform, or "probed"; a platform reader's seed takes the reader's kind (for example "jsonld").
import { describe, expect, it } from "vitest";

import { METRO_SOURCES } from "@/config/sources";

describe("seeds: an html page names no platform reader (D-791)", () => {
  it("no seed of kind html carries a platform other than probed", () => {
    const wrong: string[] = [];
    for (const [metro, seeds] of Object.entries(METRO_SOURCES)) {
      for (const seed of seeds) {
        const platform = (seed as { platform?: string | null }).platform;
        if (seed.kind === "html" && platform != null && platform !== "probed") {
          wrong.push(`${metro} ${seed.url} platform ${platform}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });
});
