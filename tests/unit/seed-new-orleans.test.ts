import { describe, expect, it, vi, afterEach } from "vitest";
import {
  newOrleansMetroRow,
  NEW_ORLEANS_METRO,
  NEW_ORLEANS_METRO_ID,
} from "@/src/db/seed/new-orleans";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";
import { seedId } from "@/src/db/seed/ids";
import { insideMetro, metroPartAt } from "@/src/domain/metro-bounds";
import { main } from "@/src/db/seed/run";

const db = vi.hoisted(() => ({ getDb: vi.fn(), closeDb: vi.fn() }));
vi.mock("@/src/db/client", () => db);

describe("new-orleans seed module (D-340)", () => {
  it("returns the metro row", () => {
    const row = newOrleansMetroRow();
    expect(row.slug).toBe("new-orleans");
    expect(row.name).toBe("New Orleans");
    expect(row.countryCode).toBe("US");
    expect(row.tz).toBe("America/Chicago");
    expect(row.radiusKm).toBe(45);
    expect(row.center.lat).toBeCloseTo(29.9574);
    expect(row.center.lng).toBeCloseTo(-90.0629);
    expect(row.status).toBe("active");
    expect(row.id).toBe(NEW_ORLEANS_METRO_ID);
    expect(row.id).toBe(seedId("metro", "new-orleans"));
    expect(row.languages).toEqual(["en"]);
    expect(row.geonamesId).toBe(4335045);
    expect(row.population).toBe(824778);
    expect(row.adHoc).toBe(false);
    expect(NEW_ORLEANS_METRO.slug).toBe("new-orleans");
  });
});

describe("New Orleans's outline (D-340)", () => {
  const row = newOrleansMetroRow();
  it("Jackson Square is inside", () => {
    const centre = { lat: 29.9574, lng: -90.0629 };
    expect(insideMetro(row, centre)).toBe(true);
    expect(metroPartAt("new-orleans", centre)).toBe("New Orleans");
  });
});

describe("row-only metro registry", () => {
  it("lists London, Philadelphia, and New Orleans, not New York", () => {
    expect(ROW_ONLY_METROS.london!().slug).toBe("london");
    expect(ROW_ONLY_METROS.philadelphia!().slug).toBe("philadelphia");
    expect(ROW_ONLY_METROS["new-orleans"]!().id).toBe(NEW_ORLEANS_METRO_ID);
    expect(ROW_ONLY_METROS.nyc).toBeUndefined();
  });
});

describe("seed runner with --metro new-orleans", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dry-run logs the New Orleans row and does not call getDb", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await main(["--metro", "new-orleans", "--metro-only", "--dry-run"]);
    const logs = logSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logs).toContain("New Orleans metro row");
    expect(db.getDb).not.toHaveBeenCalled();
  });

  it("rejects an unknown slug and names the known ones", async () => {
    await expect(main(["--metro", "atlantis", "--dry-run"])).rejects.toThrow(
      /Unknown metro "atlantis".*new-orleans/,
    );
  });
});
