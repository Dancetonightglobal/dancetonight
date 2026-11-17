import { describe, expect, it, vi, afterEach } from "vitest";
import { parisMetroRow, PARIS_METRO, PARIS_METRO_ID } from "@/src/db/seed/paris";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("paris seed module (D-1040)", () => {
  it("returns the metro row", () => {
    const row = parisMetroRow();
    expect(row.slug).toBe("paris");
    expect(row.name).toBe("Paris");
    expect(row.countryCode).toBe("FR");
    expect(row.tz).toBe("Europe/Paris");
    expect(row.radiusKm).toBe(30);
    expect(row.center.lat).toBeCloseTo(48.8534);
    expect(row.center.lng).toBeCloseTo(2.3488);
    expect(row.status).toBe("active");
    expect(row.id).toBe(PARIS_METRO_ID);
    expect(row.id).toBe(seedId("metro", "paris"));
    expect(row.languages).toEqual(["fr", "en"]);
    expect(row.geonamesId).toBe(2988507);
    expect(row.population).toBe(7115576);
    expect(row.adHoc).toBe(false);
    expect(PARIS_METRO.slug).toBe("paris");
  });

  it("has its centre inside the Grand Paris outline", () => {
    const row = parisMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.paris).toBe(parisMetroRow);
  });
});

describe("seed runner with --metro paris", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Paris metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "paris", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Paris metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
