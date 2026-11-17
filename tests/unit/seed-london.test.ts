import { describe, expect, it, vi, afterEach } from "vitest";
import { londonMetroRow, LONDON_METRO_ID } from "@/src/db/seed/london";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("london seed module", () => {
  it("returns a metro row with correct properties", () => {
    const row = londonMetroRow();
    expect(row.slug).toBe("london");
    expect(row.countryCode).toBe("GB");
    expect(row.tz).toBe("Europe/London");
    expect(row.radiusKm).toBe(35);
    expect(row.center.lat).toBeCloseTo(51.5074);
    expect(row.center.lng).toBeCloseTo(-0.1278);
    expect(row.status).toBe("active");
    expect(row.id).toBe(LONDON_METRO_ID);
    expect(row.id).toBe(seedId("metro", "london"));
    expect(row.id).not.toBe(seedId("metro", "nyc"));
    expect(row.languages).toEqual(["en"]);
    expect(row.geonamesId).toBe(2643743);
    expect(row.population).toBe(8945309);
    expect(row.adHoc).toBe(false);
  });

  it("is inside the London metro bounds", () => {
    const row = londonMetroRow();
    expect(insideMetro(row, { lat: 51.5074, lng: -0.1278 })).toBe(true);
  });
});

describe("seed runner with --metro london", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs about London and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await main(["--metro", "london", "--dry-run"]);
    expect(logSpy).toHaveBeenCalled();
    const logs = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logs).toContain("London metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });

  it("treats --metro-only as a flag wherever it stands", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro-only", "--metro", "london", "--dry-run"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("London metro row");
  });

  it("rejects unknown metro slug", async () => {
    await expect(main(["--metro", "atlantis", "--dry-run"])).rejects.toThrow(
      /Unknown metro "atlantis"/,
    );
  });
});
