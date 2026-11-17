import { describe, expect, it, vi, afterEach } from "vitest";
import { sanJuanMetroRow, SAN_JUAN_METRO, SAN_JUAN_METRO_ID } from "@/src/db/seed/san-juan";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("san juan seed module (D-460)", () => {
  it("returns the metro row", () => {
    const row = sanJuanMetroRow();
    expect(row.slug).toBe("san-juan");
    expect(row.name).toBe("San Juan");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/Puerto_Rico");
    expect(row.radiusKm).toBe(35);
    expect(row.center.lat).toBeCloseTo(18.4494);
    expect(row.center.lng).toBeCloseTo(-66.0663);
    expect(row.status).toBe("active");
    expect(row.id).toBe(SAN_JUAN_METRO_ID);
    expect(row.id).toBe(seedId("metro", "san-juan"));
    // Spanish first, so summaries are still written (D-109); English for the style and weekly-rule words.
    expect(row.languages).toEqual(["en", "es"]);
    expect(row.geonamesId).toBe(4568127);
    expect(row.population).toBe(795196);
    expect(row.adHoc).toBe(false);
    expect(SAN_JUAN_METRO.slug).toBe("san-juan");
  });

  it("has its centre inside the San Juan outline", () => {
    const row = sanJuanMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS["san-juan"]).toBe(sanJuanMetroRow);
  });
});

describe("seed runner with --metro san-juan", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the San Juan metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "san-juan", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("San Juan metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
