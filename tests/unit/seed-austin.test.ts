import { describe, expect, it, vi, afterEach } from "vitest";
import { austinMetroRow, AUSTIN_METRO, AUSTIN_METRO_ID } from "@/src/db/seed/austin";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("austin seed module (D-1180)", () => {
  it("returns the metro row", () => {
    const row = austinMetroRow();
    expect(row.slug).toBe("austin");
    expect(row.name).toBe("Austin");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/Chicago");
    expect(row.radiusKm).toBe(50);
    expect(row.center.lat).toBeCloseTo(30.2747);
    expect(row.center.lng).toBeCloseTo(-97.7404);
    expect(row.status).toBe("active");
    expect(row.id).toBe(AUSTIN_METRO_ID);
    expect(row.id).toBe(seedId("metro", "austin"));
    // English first, so summaries are still written (D-109); Spanish for the Latin scene's style and weekly words.
    expect(row.languages).toEqual(["en", "es"]);
    expect(row.geonamesId).toBe(4671654);
    expect(row.population).toBe(1363767);
    expect(row.adHoc).toBe(false);
    expect(AUSTIN_METRO.slug).toBe("austin");
  });

  it("has its centre inside the Travis County outline", () => {
    const row = austinMetroRow();
    expect(insideMetro(row, { lat: row.center.lat, lng: row.center.lng })).toBe(true);
  });

  it("is a row-only metro", () => {
    expect(ROW_ONLY_METROS.austin).toBe(austinMetroRow);
  });
});

describe("seed runner with --metro austin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the Austin metro row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "austin", "--metro-only", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("Austin metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });
});
