import { describe, expect, it, vi, afterEach } from "vitest";
import { mumbaiMetroRow, MUMBAI_METRO, MUMBAI_METRO_ID } from "@/src/db/seed/mumbai";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("mumbai seed module (D-620)", () => {
  it("returns the metro row", () => {
    const row = mumbaiMetroRow();
    expect(row.slug).toBe("mumbai");
    expect(row.name).toBe("Mumbai");
    expect(row.countryCode).toBe("IN");
    expect(row.tz).toBe("Asia/Kolkata");
    expect(row.radiusKm).toBe(40);
    expect(row.center.lat).toBeCloseTo(18.9398);
    expect(row.center.lng).toBeCloseTo(72.8355);
    expect(row.status).toBe("active");
    expect(row.id).toBe(MUMBAI_METRO_ID);
    expect(row.id).toBe(seedId("metro", "mumbai"));
    // English first, so summaries are written (D-109)
    expect(row.languages).toEqual(["en", "hi", "mr"]);
    expect(row.geonamesId).toBe(1275339);
    expect(row.population).toBe(12442373);
    expect(row.adHoc).toBe(false);
    expect(MUMBAI_METRO.slug).toBe("mumbai");
  });

  it("has its centre inside the Greater Mumbai outline", () => {
    const row = mumbaiMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.mumbai).toBe(mumbaiMetroRow);
  });
});

describe("seed runner with --metro mumbai", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Mumbai metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "mumbai", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Mumbai metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
