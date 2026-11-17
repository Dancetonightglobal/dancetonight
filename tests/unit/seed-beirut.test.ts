import { describe, expect, it, vi, afterEach } from "vitest";
import { beirutMetroRow, BEIRUT_METRO, BEIRUT_METRO_ID } from "@/src/db/seed/beirut";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("beirut seed module (D-1000)", () => {
  it("returns the metro row", () => {
    const row = beirutMetroRow();
    expect(row.slug).toBe("beirut");
    expect(row.name).toBe("Beirut");
    expect(row.countryCode).toBe("LB");
    expect(row.tz).toBe("Asia/Beirut");
    expect(row.radiusKm).toBe(15);
    expect(row.center.lat).toBeCloseTo(33.8959);
    expect(row.center.lng).toBeCloseTo(35.5069);
    expect(row.status).toBe("active");
    expect(row.id).toBe(BEIRUT_METRO_ID);
    expect(row.id).toBe(seedId("metro", "beirut"));
    // English first so cards get "In short" summaries; French and Arabic after (the owner, 2026-11-06, D-1000).
    expect(row.languages).toEqual(["en", "fr", "ar"]);
    expect(row.geonamesId).toBe(276781);
    expect(row.population).toBe(2400000);
    expect(row.adHoc).toBe(false);
    expect(BEIRUT_METRO.slug).toBe("beirut");
  });

  it("has its centre (Martyrs' Square) inside the outline", () => {
    const row = beirutMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.beirut).toBe(beirutMetroRow);
  });
});

describe("seed runner with --metro beirut", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Beirut metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "beirut", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Beirut metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
