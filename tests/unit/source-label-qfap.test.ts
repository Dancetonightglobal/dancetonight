// Que faire à Paris (ODbL) rows must credit the City of Paris wherever the source name renders (D-1045).

import { describe, expect, it } from "vitest";

import { QFAP_CREDIT, sourceLabel } from "@/src/data/listing-mapper";
import { QFAP_URL } from "@/src/adapters/apis/qfap";

describe("sourceLabel for Que faire à Paris", () => {
  it("prints the ODbL credit for the dataset URL", () => {
    expect(sourceLabel(QFAP_URL)).toBe(QFAP_CREDIT);
    expect(QFAP_CREDIT).toBe("Que faire à Paris, Ville de Paris (ODbL)");
  });

  it("leaves other opendata.paris.fr and paris.fr URLs as host labels", () => {
    expect(sourceLabel("https://opendata.paris.fr/explore/dataset/velib/")).not.toBe(QFAP_CREDIT);
    expect(sourceLabel("https://www.paris.fr/evenements/bal-123")).not.toBe(QFAP_CREDIT);
  });
});
