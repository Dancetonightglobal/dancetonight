import { describe, it, expect } from "vitest";
import {
  type CitySnapshot,
  snapshotKey,
  encodeSnapshot,
  decodeSnapshot,
  answerFromSnapshot,
  metroStamp,
  snapshotStale,
} from "@/src/data/city-snapshot";
import type { Listing } from "@/src/domain/listing";
import type { NightDate } from "@/src/domain/tonight";

describe("city-snapshot", () => {
  // Helper to create a minimal listing
  function makeListing(slug: string, nightDate: NightDate, startsAt?: Date): unknown {
    return {
      slug,
      nightDate,
      startsAt: startsAt ?? new Date("2026-11-03T20:00:00Z"),
    };
  }

  // Helper to create a snapshot
  function createTestSnapshot(): CitySnapshot {
    return {
      v: 1,
      metroId: "test-metro",
      slug: "test-city",
      center: { lat: 40.7128, lng: -74.006 },
      radiusKm: 50,
      unplacedMetroId: null,
      stamp: 1000,
      builtAt: new Date("2026-11-03T10:00:00Z"),
      nights: ["2026-11-02", "2026-11-03", "2026-11-04"],
      listings: [
        makeListing("event-1", "2026-11-02") as unknown as Listing,
        makeListing("event-2", "2026-11-03") as unknown as Listing,
        makeListing("event-3", "2026-11-03") as unknown as Listing,
        makeListing("event-4", "2026-11-04") as unknown as Listing,
      ],
    };
  }

  describe("snapshotKey", () => {
    it('returns "city/new-york" for slug "new-york"', () => {
      expect(snapshotKey("new-york")).toBe("city/new-york");
    });
  });

  describe("encodeSnapshot and decodeSnapshot", () => {
    it("round trip deep-equals the input, with Dates preserved", () => {
      const snapshot = createTestSnapshot();
      const encoded = encodeSnapshot(snapshot);
      expect(encoded).not.toBeNull();

      if (encoded) {
        const decoded = decodeSnapshot(encoded);
        expect(decoded).toEqual(snapshot);
        // Check that builtAt is a Date
        expect(decoded!.builtAt).toBeInstanceOf(Date);
        // Check that listing startsAt is a Date
        expect(decoded!.listings[0]!.startsAt).toBeInstanceOf(Date);
      }
    });

    it("returns null when byte length exceeds maxBytes", () => {
      const snapshot = createTestSnapshot();
      // Create a snapshot with a large slug to exceed 10 bytes
      const largeSnapshot: CitySnapshot = {
        ...snapshot,
        slug: "é".repeat(20), // Each "é" is 2 bytes in UTF-8
      };
      const encoded = encodeSnapshot(largeSnapshot, 10);
      expect(encoded).toBeNull();
    });

    it("returns non-null for default maxBytes", () => {
      const snapshot = createTestSnapshot();
      const encoded = encodeSnapshot(snapshot);
      expect(encoded).not.toBeNull();
    });
  });

  describe("decodeSnapshot", () => {
    it("returns null for invalid JSON", () => {
      expect(decodeSnapshot("not json")).toBeNull();
    });

    it("returns null for v !== 1", () => {
      const invalid = {
        v: 2,
        metroId: "test",
        slug: "test",
        center: { lat: 0, lng: 0 },
        radiusKm: 50,
        unplacedMetroId: null,
        stamp: 1000,
        builtAt: new Date(),
        nights: ["2026-11-03"],
        listings: [],
      };
      expect(decodeSnapshot(JSON.stringify(invalid))).toBeNull();
    });

    it("returns null for missing listings", () => {
      const invalid = {
        v: 1,
        metroId: "test",
        slug: "test",
        center: { lat: 0, lng: 0 },
        radiusKm: 50,
        unplacedMetroId: null,
        stamp: 1000,
        builtAt: new Date(),
        nights: ["2026-11-03"],
        // listings missing
      };
      expect(decodeSnapshot(JSON.stringify(invalid))).toBeNull();
    });

    it("returns null for stamp as string", () => {
      const invalid = {
        v: 1,
        metroId: "test",
        slug: "test",
        center: { lat: 0, lng: 0 },
        radiusKm: 50,
        unplacedMetroId: null,
        stamp: "1000", // string instead of number
        builtAt: new Date(),
        nights: ["2026-11-03"],
        listings: [],
      };
      expect(decodeSnapshot(JSON.stringify(invalid))).toBeNull();
    });

    it("returns null for builtAt not a Date", () => {
      const invalid = {
        v: 1,
        metroId: "test",
        slug: "test",
        center: { lat: 0, lng: 0 },
        radiusKm: 50,
        unplacedMetroId: null,
        stamp: 1000,
        builtAt: "2026-11-03", // string instead of Date
        nights: ["2026-11-03"],
        listings: [],
      };
      expect(decodeSnapshot(JSON.stringify(invalid))).toBeNull();
    });

    it("returns null for nights containing a number", () => {
      const invalid = {
        v: 1,
        metroId: "test",
        slug: "test",
        center: { lat: 0, lng: 0 },
        radiusKm: 50,
        unplacedMetroId: null,
        stamp: 1000,
        builtAt: new Date(),
        nights: ["2026-11-03", 123], // number in array
        listings: [],
      };
      expect(decodeSnapshot(JSON.stringify(invalid))).toBeNull();
    });

    it("never throws", () => {
      // This should not throw
      expect(() => decodeSnapshot("{}")).not.toThrow();
    });
  });

  describe("answerFromSnapshot", () => {
    const snapshot = createTestSnapshot();

    it("returns matching night's rows in original order", () => {
      const result = answerFromSnapshot(
        snapshot,
        { lat: 40.7128, lng: -74.006 },
        50,
        ["2026-11-03"],
        null,
      );
      expect(result).toHaveLength(2);
      expect(result![0]!.slug).toBe("event-2");
      expect(result![1]!.slug).toBe("event-3");
    });

    it("returns multiple nights' rows in snapshot order", () => {
      const result = answerFromSnapshot(
        snapshot,
        { lat: 40.7128, lng: -74.006 },
        50,
        ["2026-11-03", "2026-11-02"],
        null,
      );
      expect(result).toHaveLength(3);
      // Order should be as in snapshot: event-1 (2026-11-02), event-2, event-3 (both 2026-11-03)
      expect(result![0]!.slug).toBe("event-1");
      expect(result![1]!.slug).toBe("event-2");
      expect(result![2]!.slug).toBe("event-3");
    });

    it("returns null for lat differing by 1e-9", () => {
      const result = answerFromSnapshot(
        snapshot,
        { lat: 40.7128 + 1e-9, lng: -74.006 },
        50,
        ["2026-11-03"],
        null,
      );
      expect(result).toBeNull();
    });

    it("returns null for different radius", () => {
      const result = answerFromSnapshot(
        snapshot,
        { lat: 40.7128, lng: -74.006 },
        51,
        ["2026-11-03"],
        null,
      );
      expect(result).toBeNull();
    });

    it("returns null for different unplacedMetroId", () => {
      const result = answerFromSnapshot(
        snapshot,
        { lat: 40.7128, lng: -74.006 },
        50,
        ["2026-11-03"],
        "other-metro",
      );
      expect(result).toBeNull();
    });

    it("returns null for night outside snapshot.nights", () => {
      const result = answerFromSnapshot(
        snapshot,
        { lat: 40.7128, lng: -74.006 },
        50,
        ["2026-11-05"], // not in snapshot
        null,
      );
      expect(result).toBeNull();
    });

    it("returns null for empty nights", () => {
      const result = answerFromSnapshot(snapshot, { lat: 40.7128, lng: -74.006 }, 50, [], null);
      expect(result).toBeNull();
    });

    it("does not mutate the snapshot's listings array", () => {
      const originalLength = snapshot.listings.length;
      answerFromSnapshot(snapshot, { lat: 40.7128, lng: -74.006 }, 50, ["2026-11-03"], null);
      expect(snapshot.listings).toHaveLength(originalLength);
    });
  });

  describe("metroStamp", () => {
    it("returns max(own, null-key) when both present", () => {
      const map = new Map<string | null, number>([
        ["metro1", 5],
        [null, 7],
      ]);
      expect(metroStamp(map, "metro1")).toBe(7); // max(5,7)
    });

    it("returns own when larger than null", () => {
      const map = new Map<string | null, number>([
        ["metro1", 9],
        [null, 7],
      ]);
      expect(metroStamp(map, "metro1")).toBe(9); // max(9,7)
    });

    it("ignores other metros when own entry exists", () => {
      const map = new Map<string | null, number>([
        ["a", 5],
        ["b", 100],
        [null, 7],
      ]);
      expect(metroStamp(map, "a")).toBe(7); // max(5,7) - ignores b's 100
      expect(metroStamp(map, "b")).toBe(100); // max(100,7)
    });

    it("returns global max when no own entry", () => {
      const map = new Map<string | null, number>([
        ["a", 3],
        ["b", 11],
        [null, 4],
      ]);
      expect(metroStamp(map, "c")).toBe(11); // max of all values
    });

    it("returns 0 for empty map", () => {
      const map = new Map<string | null, number>();
      expect(metroStamp(map, "any")).toBe(0);
    });

    it("returns null-key when no own entry and null present", () => {
      const map = new Map<string | null, number>([[null, 4]]);
      expect(metroStamp(map, "metro1")).toBe(4);
    });
  });

  describe("snapshotStale", () => {
    const snapshot = createTestSnapshot();

    it("returns false when same stamp and needed nights inside", () => {
      expect(snapshotStale(snapshot, 1000, ["2026-11-03"])).toBe(false);
    });

    it("returns true when currentStamp > snapshot.stamp", () => {
      expect(snapshotStale(snapshot, 2000, ["2026-11-03"])).toBe(true);
    });

    it("returns false when currentStamp < snapshot.stamp", () => {
      expect(snapshotStale(snapshot, 500, ["2026-11-03"])).toBe(false);
    });

    it("returns true when a needed night is not in snapshot.nights", () => {
      expect(snapshotStale(snapshot, 1000, ["2026-11-05"])).toBe(true);
    });
  });
});
