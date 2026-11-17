import { describe, expect, it } from "vitest";

import { zoneForPoint, zonesForPoint } from "@/src/domain/zone";

describe("zoneForPoint", () => {
  it("resolves city coordinates to their IANA zone", () => {
    expect(zoneForPoint(40.7128, -74.006)).toBe("America/New_York"); // Manhattan
    expect(zoneForPoint(40.7439, -74.0324)).toBe("America/New_York"); // Hoboken
    expect(zoneForPoint(30.2672, -97.7431)).toBe("America/Chicago"); // Austin
    expect(zoneForPoint(48.8566, 2.3522)).toBe("Europe/Paris");
    expect(zoneForPoint(-33.8688, 151.2093)).toBe("Australia/Sydney");
    expect(zoneForPoint(19.076, 72.8777)).toBe("Asia/Kolkata"); // Mumbai
    expect(zoneForPoint(33.4484, -112.074)).toBe("America/Phoenix");
  });

  it("returns a fixed-offset zone for open ocean", () => {
    expect(zoneForPoint(0, -30)).toMatch(/^Etc\/GMT/);
  });

  it("returns null for an invalid point", () => {
    expect(zoneForPoint(91, 0)).toBeNull();
    expect(zoneForPoint(0, -181)).toBeNull();
    expect(zoneForPoint(Number.NaN, 0)).toBeNull();
    expect(zonesForPoint(0, 200)).toEqual([]);
  });
});
