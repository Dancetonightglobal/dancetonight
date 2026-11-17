import { describe, expect, it } from "vitest";
import { screenNoDance } from "@/src/domain/listing-screen";

describe("mixed calendar: style counts as dance evidence only when title names it (D-237)", () => {
  const tz = "America/New_York";
  const night = "2026-11-06";
  const at8pm = (title: string, styles: string[] = [], evidenceText?: string | null) => ({
    title,
    styles,
    startsAt: new Date("2026-11-06T20:00:00-05:00"),
    nightDate: night,
    tz,
    evidenceText,
  });
  const mixed = { mixedCalendar: true, styles: [] };

  it("screens 'Blu DeTiger' with styles ['hip_hop_club']", () => {
    const result = screenNoDance(at8pm("Blu DeTiger", ["hip_hop_club"]), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Drag Show' with styles ['queer_party']", () => {
    const result = screenNoDance(at8pm("Drag Show", ["queer_party"]), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Tuesday Bands' with styles ['swing']", () => {
    const result = screenNoDance(at8pm("Tuesday Bands", ["swing"]), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Hamilton Leithauser + Rostam' with styles ['hip_hop_club'] (band billing)", () => {
    const result = screenNoDance(at8pm("Hamilton Leithauser + Rostam", ["hip_hop_club"]), mixed);
    expect(result?.kind).toBe("not_dance_scope");
  });

  it("screens 'Blu DeTiger + Special Guest' with no styles", () => {
    const result = screenNoDance(at8pm("Blu DeTiger + Special Guest", []), mixed);
    expect(result?.kind).toBe("not_dance_scope");
  });

  it("keeps 'Salsa Night' with styles ['salsa'] (title names style)", () => {
    const result = screenNoDance(at8pm("Salsa Night", ["salsa"]), mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Tango Milonga' with styles ['tango']", () => {
    const result = screenNoDance(at8pm("Tango Milonga", ["tango"]), mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Swing at the Barbary' with styles ['swing']", () => {
    const result = screenNoDance(at8pm("Swing at the Barbary", ["swing"]), mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Blu DeTiger' with styles ['hip_hop_club'] at 10:30pm (late rule)", () => {
    const listing = {
      title: "Blu DeTiger",
      styles: ["hip_hop_club"],
      startsAt: new Date("2026-11-06T22:30:00-05:00"),
      nightDate: night,
      tz,
    };
    const result = screenNoDance(listing, mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Blu DeTiger' with styles ['hip_hop_club'] and no time", () => {
    const listing = {
      title: "Blu DeTiger",
      styles: ["hip_hop_club"],
      startsAt: null,
      nightDate: night,
      tz,
    };
    const result = screenNoDance(listing, mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Drag Show' on non-mixed calendar", () => {
    const listing = at8pm("Drag Show", ["queer_party"]);
    const source = { mixedCalendar: false, styles: [] };
    const result = screenNoDance(listing, source);
    expect(result).toBeNull();
  });

  it("keeps 'Salsa + Bachata Social' with styles ['salsa','bachata'] (names styles)", () => {
    const result = screenNoDance(at8pm("Salsa + Bachata Social", ["salsa", "bachata"]), mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Hamilton Leithauser + Rostam' on bandsForDancers source", () => {
    const listing = at8pm("Hamilton Leithauser + Rostam", []);
    const source = { mixedCalendar: true, bandsForDancers: true, styles: [] };
    const result = screenNoDance(listing, source);
    expect(result).toBeNull();
  });

  it("keeps 'Tye Turner + ZABAAN presents X' at 10:30pm on a mixed calendar (no styles)", () => {
    const listing = {
      title: "Tye Turner + ZABAAN presents X",
      styles: [],
      startsAt: new Date("2026-11-06T22:30:00-05:00"),
      nightDate: night,
      tz,
    };
    const result = screenNoDance(listing, mixed);
    expect(result).toBeNull();
  });

  it("still screens 'Hamilton Leithauser + Rostam' at 8pm", () => {
    const result = screenNoDance(at8pm("Hamilton Leithauser + Rostam", []), mixed);
    expect(result?.kind).toBe("not_dance_scope");
  });

  it("keeps 'Slow Magic, Maxo' at 8pm with styles ['club'] and evidenceText with dance words", () => {
    const result = screenNoDance(
      at8pm("Slow Magic, Maxo", ["club"], "Live set, then a dance party with DJs until late."),
      mixed,
    );
    expect(result).toBeNull();
  });

  it("screens 'Slow Magic, Maxo' at 8pm with styles ['club'] and evidenceText without dance words", () => {
    const result = screenNoDance(
      at8pm("Slow Magic, Maxo", ["club"], "Doors 7pm. All ages."),
      mixed,
    );
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Blu DeTiger' at 8pm with styles ['hip_hop_club'] and evidenceText null", () => {
    const result = screenNoDance(at8pm("Blu DeTiger", ["hip_hop_club"], null), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });
});

describe("Ball & Chain venue name false friend (D-234)", () => {
  const tz = "America/New_York";
  const night = "2026-11-06";
  const at8pm = (title: string, styles: string[] = []) => ({
    title,
    styles,
    startsAt: new Date("2026-11-06T20:00:00-05:00"),
    nightDate: night,
    tz,
  });
  const mixed = { mixedCalendar: true, styles: [] };

  it("screens 'Tuesday at Ball & Chain'", () => {
    const result = screenNoDance(at8pm("Tuesday at Ball & Chain"), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("screens 'Ball and Chain Presents: Tito Puente Jr'", () => {
    const result = screenNoDance(at8pm("Ball and Chain Presents: Tito Puente Jr"), mixed);
    expect(result?.kind).toBe("not_a_dance");
  });

  it("keeps 'Salsa Night at Ball & Chain' with styles ['salsa']", () => {
    const result = screenNoDance(at8pm("Salsa Night at Ball & Chain", ["salsa"]), mixed);
    expect(result).toBeNull();
  });

  it("keeps 'Ball de Gitanes' (Catalan dance)", () => {
    const result = screenNoDance(at8pm("Ball de Gitanes"), mixed);
    expect(result).toBeNull();
  });
});
