// The pipeline writes provenance field names in snake_case (src/pipeline/store.ts) and the seed in
// camelCase; the detail page reads one spelling. Before this, a real disagreement between two
// crawled sources printed "dancing_at" and an ISO timestamp under each source.

import { describe, expect, it } from "vitest";

import { conflictValues, provenanceFieldName } from "@/src/data/listing-mapper";

const A = "https://a.example/";
const B = "https://b.example/";

describe("provenance field names", () => {
  it("reads snake_case and camelCase as one spelling", () => {
    expect(provenanceFieldName("dancing_at")).toBe("dancingAt");
    expect(provenanceFieldName("night_date")).toBe("nightDate");
    expect(provenanceFieldName("endsAt")).toBe("endsAt");
    expect(provenanceFieldName("title")).toBe("title");
  });

  it("shows a pipeline-written time disagreement as clock times under the view model's name", () => {
    const values = conflictValues(
      [
        { field: "ends_at", value: "2026-09-29T05:00:00.000Z", sourceUrl: A },
        { field: "ends_at", value: "2026-09-29T06:00:00.000Z", sourceUrl: B },
      ],
      "America/New_York",
    );
    expect(values.get(A)).toEqual({ endsAt: "1am" });
    expect(values.get(B)).toEqual({ endsAt: "2am" });
  });

  it("never prints a field the page has no words for, or a raw value", () => {
    const values = conflictValues(
      [
        { field: "venue_name", value: "Hall A", sourceUrl: A },
        { field: "venue_name", value: "Hall B", sourceUrl: B },
        { field: "prices", value: [{ label: "door", amount: 10 }], sourceUrl: A },
        { field: "prices", value: [{ label: "door", amount: 12 }], sourceUrl: B },
      ],
      "America/New_York",
    );
    expect(values.size).toBe(0);
  });

  it("does not report agreement as a disagreement across spellings", () => {
    const values = conflictValues(
      [
        { field: "ends_at", value: "2026-09-29T05:00:00.000Z", sourceUrl: A },
        { field: "endsAt", value: "2026-09-29T05:00:00.000Z", sourceUrl: B },
      ],
      "America/New_York",
    );
    expect(values.size).toBe(0);
  });
});
