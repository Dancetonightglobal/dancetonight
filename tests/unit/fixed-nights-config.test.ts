// Every metro's fixed weekly nights (D-524 follow-up): a night's title keys its row (page#fixed:title),
// so two entries on one source with the same title (split hours, Tue-Thu and Fri-Sat) would overwrite
// each other. Titles must be unique per source, case-insensitive, and each entry cites its dancing.
import { describe, expect, it } from "vitest";

import { METRO_SOURCES } from "@/config/sources";

describe("fixedNights in every metro's sources", () => {
  const withFixed = Object.entries(METRO_SOURCES).flatMap(([metro, seeds]) =>
    seeds.filter((s) => s.fixedNights?.length).map((s) => ({ metro, seed: s })),
  );

  it("has at least the Philadelphia entries", () => {
    expect(withFixed.some(({ metro }) => metro === "philadelphia")).toBe(true);
  });

  it("gives each source's fixed nights unique titles (case-insensitive)", () => {
    for (const { metro, seed } of withFixed) {
      const titles = seed.fixedNights!.map((f) => f.title.trim().toLowerCase());
      expect(new Set(titles).size, `${metro} ${seed.url}: ${titles.join(", ")}`).toBe(
        titles.length,
      );
    }
  });

  it("cites where dancing is stated for every fixed night (D-527)", () => {
    for (const { metro, seed } of withFixed) {
      for (const f of seed.fixedNights!) {
        expect(f.danceCited.trim().length, `${metro} ${seed.url} ${f.title}`).toBeGreaterThan(0);
      }
    }
  });

  it("gives every closed range valid dates and a citation", () => {
    for (const { metro, seed } of withFixed) {
      for (const f of seed.fixedNights!) {
        if (f.closed) {
          for (const range of f.closed) {
            expect(range.from, `${metro} ${seed.url} ${f.title}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(range.to, `${metro} ${seed.url} ${f.title}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
            expect(
              range.from <= range.to,
              `${metro} ${seed.url} ${f.title}: from ${range.from} > to ${range.to}`,
            ).toBe(true);
            expect(range.cited.trim().length, `${metro} ${seed.url} ${f.title}`).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});

describe("hand-checked seeds (D-796, D-797)", () => {
  const all = Object.entries(METRO_SOURCES).flatMap(([metro, seeds]) =>
    seeds.map((s) => ({ metro, seed: s })),
  );

  it("never makes an Instagram page a fetched source: every instagram.com seed is handChecked", () => {
    for (const { metro, seed } of all) {
      if (/^https?:\/\/(www\.)?instagram\.com\//i.test(seed.url)) {
        expect(seed.handChecked, `${metro} ${seed.url}`).toBe(true);
      }
    }
  });

  // D-798: a venue's own site that blocks our bot may be hand-checked too; any https URL.
  it("gives every hand-checked night a checkedOn date and an https evidence post", () => {
    for (const { metro, seed } of all.filter(({ seed }) => seed.handChecked)) {
      expect(seed.url, `${metro} ${seed.url}`).toMatch(/^https:\/\//);
      expect(seed.fixedNights?.length ?? 0, `${metro} ${seed.url}`).toBeGreaterThan(0);
      for (const f of seed.fixedNights ?? []) {
        expect(f.checkedOn, `${metro} ${seed.url} ${f.title}`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(f.evidenceUrl, `${metro} ${seed.url} ${f.title}`).toMatch(/^https:\/\//);
      }
    }
  });
});
