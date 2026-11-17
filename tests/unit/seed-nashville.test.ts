import { describe, expect, it, vi, afterEach } from "vitest";
import { nashvilleMetroRow, NASHVILLE_METRO, NASHVILLE_METRO_ID } from "@/src/db/seed/nashville";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("nashville seed module (D-1200)", () => {
  it("returns the metro row", () => {
    const row = nashvilleMetroRow();
    expect(row.slug).toBe("nashville");
    expect(row.name).toBe("Nashville");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/Chicago");
    expect(row.radiusKm).toBe(35);
    expect(row.center.lat).toBeCloseTo(36.1659);
    expect(row.center.lng).toBeCloseTo(-86.7844);
    expect(row.status).toBe("active");
    expect(row.id).toBe(NASHVILLE_METRO_ID);
    expect(row.id).toBe(seedId("metro", "nashville"));
    // English only (the owner, 2026-11-07); English first, so summaries are written (D-109).
    expect(row.languages).toEqual(["en"]);
    expect(row.geonamesId).toBe(4644585);
    expect(row.population).toBe(729505);
    expect(row.adHoc).toBe(false);
    expect(NASHVILLE_METRO.slug).toBe("nashville");
  });

  it("has its centre inside the Davidson County outline", () => {
    const row = nashvilleMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.nashville).toBe(nashvilleMetroRow);
  });
});

describe("seed runner with --metro nashville", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Nashville metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "nashville", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Nashville metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
