import { describe, expect, it, vi, afterEach } from "vitest";
import { raleighMetroRow, RALEIGH_METRO, RALEIGH_METRO_ID } from "@/src/db/seed/raleigh";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("raleigh seed module (D-600)", () => {
  it("returns the metro row", () => {
    const row = raleighMetroRow();
    expect(row.slug).toBe("raleigh");
    expect(row.name).toBe("Raleigh");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/New_York");
    expect(row.radiusKm).toBe(45);
    expect(row.center.lat).toBeCloseTo(35.7804);
    expect(row.center.lng).toBeCloseTo(-78.6391);
    expect(row.status).toBe("active");
    expect(row.id).toBe(RALEIGH_METRO_ID);
    expect(row.id).toBe(seedId("metro", "raleigh"));
    // English first, so summaries are still written (D-109); Spanish for the Latin scene's style and weekly words.
    expect(row.languages).toEqual(["en", "es"]);
    expect(row.geonamesId).toBe(4487042);
    expect(row.population).toBe(1232444);
    expect(row.adHoc).toBe(false);
    expect(RALEIGH_METRO.slug).toBe("raleigh");
  });

  it("has its centre inside the Wake County outline", () => {
    const row = raleighMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.raleigh).toBe(raleighMetroRow);
  });
});

describe("seed runner with --metro raleigh", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Raleigh metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "raleigh", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Raleigh metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
