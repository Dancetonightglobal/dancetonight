import { describe, expect, it, vi, afterEach } from "vitest";
import { delhiMetroRow, DELHI_METRO, DELHI_METRO_ID } from "@/src/db/seed/delhi";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("delhi seed module (D-1140)", () => {
  it("returns the metro row", () => {
    const row = delhiMetroRow();
    expect(row.slug).toBe("delhi");
    expect(row.name).toBe("Delhi");
    expect(row.countryCode).toBe("IN");
    expect(row.tz).toBe("Asia/Kolkata");
    expect(row.radiusKm).toBe(75);
    expect(row.center.lat).toBeCloseTo(28.6315);
    expect(row.center.lng).toBeCloseTo(77.2167);
    expect(row.status).toBe("active");
    expect(row.id).toBe(DELHI_METRO_ID);
    expect(row.id).toBe(seedId("metro", "delhi"));
    // English first, so summaries are written (D-109)
    expect(row.languages).toEqual(["en", "hi", "pa"]);
    expect(row.geonamesId).toBe(1273294);
    expect(row.population).toBe(19950488);
    expect(row.adHoc).toBe(false);
    expect(DELHI_METRO.slug).toBe("delhi");
  });

  it("has its centre inside the Delhi + Gurugram + Noida outline", () => {
    const row = delhiMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.delhi).toBe(delhiMetroRow);
  });
});

describe("seed runner with --metro delhi", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Delhi metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "delhi", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Delhi metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
