// D-807: San Juan's metro row is countryCode "US" (D-460), so a Platea reader limited to "PR" never ran there
// (SJ run 42482662383: "serves PR only"; plateapr.com/eventos 0 rows since #1183).
import { describe, expect, it } from "vitest";

import { plateaAdapter } from "@/src/adapters/apis/platea";
import { SAN_JUAN_METRO } from "@/src/db/seed/san-juan";

describe("Platea's countries (D-807)", () => {
  it("serves San Juan's metro country code", () => {
    expect(plateaAdapter.countries).toContain(SAN_JUAN_METRO.countryCode);
  });

  it("still serves a metro stored as PR", () => {
    expect(plateaAdapter.countries).toContain("PR");
  });
});
