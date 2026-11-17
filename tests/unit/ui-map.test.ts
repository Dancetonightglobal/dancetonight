// The map's pure parts (D-013). MapLibre needs WebGL, a worker and a real canvas, so it is not
// run here: what is tested is everything the map decides before it draws -- the pin numbers, the
// light and dark style choice, the fallback, the bounds and the clustering.

import { describe, expect, it, vi } from "vitest";

import type { Listing } from "@/src/domain/listing";
import { en } from "@/src/i18n";
import {
  CLUSTER_TEXT_MAX_CHARS,
  clusterName,
  clusterText,
  numberParts,
  pinName,
} from "@/src/ui/map/labels";
import {
  FAN_STEP_PX,
  MAX_FAN_PINS,
  rowPinsFor,
  SAME_SPOT_DEGREES,
  TARGET_PX,
  allAtOneSpot,
  boundsOf,
  centerOf,
  estimatedClusterWidth,
  estimatedPinWidth,
  fanOffsets,
  groupPins,
  sameSpot,
  type PinGroup,
  type ProjectedPlace,
} from "@/src/ui/map/pins";
import {
  FALLBACK_STYLE_FILES,
  OPENFREEMAP_STYLES,
  fallbackTileStyles,
  resolveMapTheme,
  resolveStyle,
  tileStyleUrl,
} from "@/src/ui/map/tile-style";
import { toMapPlaces, type MapPlace } from "@/src/ui/map/types";
import { framingKeyFor } from "@/src/ui/map/pins";

// Mock formatTime to return a predictable string for tests
// --- fixtures ---------------------------------------------------------------------------------

function listing(id: string, title: string, lat: number, lng: number): Listing {
  return {
    id,
    slug: id,
    title,
    startsAt: null,
    tz: "America/New_York",
    venue: { name: `${title} venue`, location: { lat, lng } },
  } as unknown as Listing;
}

function place(
  id: string,
  number: number,
  lat: number,
  lng: number,
  time: string | null = null,
): MapPlace {
  return { id, number, title: id, time, venueName: `${id} venue`, location: { lat, lng } };
}

function projected(entries: readonly [MapPlace, number, number][]): ProjectedPlace[] {
  return entries.map(([p, x, y]) => ({ place: p, x, y }));
}

interface DrawnBox {
  label: string;
  places: string[];
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where MapLibre draws each group's target: centred on the screen point of its `center` (the
 * selected place for a row, the lowest-numbered place for a cluster) plus its offset, 44px tall,
 * and 44px wide for a pin or `width(places)` for a cluster. Positions are whole pixels, as
 * MapLibre rounds them.
 */
function drawnBoxes(
  groups: readonly PinGroup[],
  entries: readonly ProjectedPlace[],
  width: (places: readonly MapPlace[]) => number,
): DrawnBox[] {
  const at = (center: { lat: number; lng: number }) => {
    const entry = entries.find(
      (candidate) =>
        candidate.place.location.lat === center.lat && candidate.place.location.lng === center.lng,
    );
    if (entry === undefined) throw new Error("a group is drawn at no place's point");
    return entry;
  };
  return groups.map((group) => {
    const point = at(group.center);
    const [dx, dy] = group.kind === "pin" ? group.offset : [0, 0];
    const w = group.kind === "pin" ? TARGET_PX : width(group.places);
    return {
      label: group.kind === "pin" ? group.place.id : group.places.map((p) => p.id).join("+"),
      places: group.kind === "pin" ? [group.place.id] : group.places.map((p) => p.id),
      x: Math.round(point.x + dx) - w / 2,
      y: Math.round(point.y + dy) - TARGET_PX / 2,
      width: w,
      height: TARGET_PX,
    };
  });
}

function overlap(first: DrawnBox, second: DrawnBox): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  );
}

// --- pin numbering ----------------------------------------------------------------------------

describe("toMapPlaces", () => {
  it("numbers pins from the list order, starting at one, and gives the start time", () => {
    // 23:00 and 02:30 UTC are 7pm and 10:30pm in New York (EDT), in the listing's own zone.
    const places = toMapPlaces([
      {
        ...listing("a", "Salsa Sundays", 40.72, -74.0),
        startsAt: new Date("2026-10-17T23:00:00Z"),
      },
      { ...listing("b", "Midtown Sunday Hop", 40.75, -73.99), startsAt: null },
      {
        ...listing("c", "Milonga la Nacional", 40.73, -73.98),
        startsAt: new Date("2026-10-18T02:30:00Z"),
      },
    ] as Listing[]);
    expect(places.map((p) => [p.id, p.number, p.time])).toEqual([
      ["a", 1, "7pm"],
      ["b", 2, null],
      ["c", 3, "10:30pm"],
    ]);
  });

  it("renumbers when the list is reordered, because the number is the card's position", () => {
    const byStart = [listing("a", "A", 1, 1), listing("b", "B", 2, 2)];
    const byDistance = [byStart[1]!, byStart[0]!];
    expect(toMapPlaces(byStart).map((p) => p.id)).toEqual(["a", "b"]);
    expect(toMapPlaces(byDistance).map((p) => [p.id, p.number])).toEqual([
      ["b", 1],
      ["a", 2],
    ]);
  });

  it("carries the venue name and the title through for the pin's labels", () => {
    const [only] = toMapPlaces([listing("a", "Mister Sunday", 40.7, -73.9)]);
    expect(only).toEqual({
      id: "a",
      number: 1,
      title: "Mister Sunday",
      time: null,
      venueName: "Mister Sunday venue",
      location: { lat: 40.7, lng: -73.9 },
    });
  });

  it("numbers nothing when the list is empty", () => {
    expect(toMapPlaces([])).toEqual([]);
  });
});

// --- the light and dark style choice ----------------------------------------------------------

describe("resolveMapTheme", () => {
  it("follows the visitor's recorded choice over the device", () => {
    expect(resolveMapTheme("dark", false)).toBe("dark");
    expect(resolveMapTheme("light", true)).toBe("light");
  });

  it("follows the device when no choice is recorded", () => {
    expect(resolveMapTheme(null, true)).toBe("dark");
    expect(resolveMapTheme(null, false)).toBe("light");
  });

  it("ignores an attribute that is not one of the two themes", () => {
    expect(resolveMapTheme("navy", true)).toBe("dark");
    expect(resolveMapTheme("", false)).toBe("light");
  });
});

describe("tileStyleUrl", () => {
  it("serves a different OpenFreeMap style per theme, so the map agrees with the page", () => {
    expect(tileStyleUrl("light")).toBe(OPENFREEMAP_STYLES.light);
    expect(tileStyleUrl("dark")).toBe(OPENFREEMAP_STYLES.dark);
    expect(OPENFREEMAP_STYLES.light).not.toBe(OPENFREEMAP_STYLES.dark);
  });

  it("uses OpenFreeMap, keyless and same for both themes' host (D-013)", () => {
    for (const url of [OPENFREEMAP_STYLES.light, OPENFREEMAP_STYLES.dark]) {
      expect(new URL(url).host).toBe("tiles.openfreemap.org");
      expect(new URL(url).search).toBe("");
    }
  });

  it("takes an explicit style pair, which is how the fallback is drawn", () => {
    const styles = { light: "https://r2.example/light.json", dark: "https://r2.example/dark.json" };
    expect(tileStyleUrl("dark", styles)).toBe(styles.dark);
  });
});

describe("fallbackTileStyles", () => {
  it("is null when no fallback is configured, which is the normal state in mock mode", () => {
    expect(fallbackTileStyles({})).toBeNull();
    expect(fallbackTileStyles({ TILES_FALLBACK_URL: "   " })).toBeNull();
  });

  it("builds one style document per theme under the configured base", () => {
    const styles = fallbackTileStyles({ TILES_FALLBACK_URL: "https://tiles.example.com/nyc" });
    expect(styles).toEqual({
      light: `https://tiles.example.com/nyc/${FALLBACK_STYLE_FILES.light}`,
      dark: `https://tiles.example.com/nyc/${FALLBACK_STYLE_FILES.dark}`,
    });
  });

  it("keeps the whole path when the base already ends in a slash", () => {
    const styles = fallbackTileStyles({ TILES_FALLBACK_URL: "https://tiles.example.com/nyc/" });
    expect(styles?.light).toBe(`https://tiles.example.com/nyc/${FALLBACK_STYLE_FILES.light}`);
  });

  it("refuses a base that is not a URL rather than breaking the map", () => {
    expect(fallbackTileStyles({ TILES_FALLBACK_URL: "not a url" })).toBeNull();
  });
});

describe("resolveStyle", () => {
  const styles = { light: "https://primary.example/light", dark: "https://primary.example/dark" };
  const fallbackStyles = {
    light: "https://backup.example/light",
    dark: "https://backup.example/dark",
  };
  const doc = { version: 8, sources: {}, layers: [] };

  function respond(map: Record<string, Response | Error>): typeof fetch {
    return vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const answer = map[url];
      if (answer === undefined) throw new Error(`unexpected fetch: ${url}`);
      if (answer instanceof Error) throw answer;
      return answer;
    }) as unknown as typeof fetch;
  }

  function ok(body: unknown): Response {
    return { ok: true, json: async () => body } as Response;
  }

  it("uses the primary style when OpenFreeMap answers", async () => {
    const fetchImpl = respond({ [styles.dark]: ok(doc) });
    const resolved = await resolveStyle("dark", { styles, fallbackStyles, fetchImpl });
    expect(resolved).toEqual({ style: doc, source: "primary" });
  });

  it("falls back to the configured extract when OpenFreeMap does not answer (D-013)", async () => {
    const fetchImpl = respond({
      [styles.light]: new Error("network down"),
      [fallbackStyles.light]: ok(doc),
    });
    const resolved = await resolveStyle("light", { styles, fallbackStyles, fetchImpl });
    expect(resolved).toEqual({ style: doc, source: "fallback" });
  });

  it("falls back on a non-ok response as well as on a thrown request", async () => {
    const fetchImpl = respond({
      [styles.light]: { ok: false, json: async () => doc } as Response,
      [fallbackStyles.light]: ok(doc),
    });
    await expect(resolveStyle("light", { styles, fallbackStyles, fetchImpl })).resolves.toEqual({
      style: doc,
      source: "fallback",
    });
  });

  it("falls back when the primary answers with something that is not a style document", async () => {
    const fetchImpl = respond({ [styles.light]: ok([1, 2, 3]), [fallbackStyles.light]: ok(doc) });
    const resolved = await resolveStyle("light", { styles, fallbackStyles, fetchImpl });
    expect(resolved.source).toBe("fallback");
  });

  it("throws when neither answers, so the caller can say so and leave the list standing", async () => {
    const fetchImpl = respond({
      [styles.dark]: new Error("down"),
      [fallbackStyles.dark]: new Error("down too"),
    });
    await expect(resolveStyle("dark", { styles, fallbackStyles, fetchImpl })).rejects.toThrow(
      /dark theme/,
    );
  });

  it("throws rather than retrying forever when no fallback is configured", async () => {
    const fetchImpl = respond({ [styles.light]: new Error("down") });
    await expect(
      resolveStyle("light", { styles, fallbackStyles: null, fetchImpl }),
    ).rejects.toThrow();
  });
});

// --- bounds -----------------------------------------------------------------------------------

describe("boundsOf", () => {
  it("is null with nothing to frame", () => {
    expect(boundsOf([])).toBeNull();
  });

  it("wraps every place", () => {
    expect(
      boundsOf([
        place("a", 1, 40.72, -74.01),
        place("b", 2, 40.75, -73.98),
        place("c", 3, 40.7, -73.95),
      ]),
    ).toEqual({ south: 40.7, west: -74.01, north: 40.75, east: -73.95 });
  });

  it("is the point itself for a single place, so a fit is a zoom not a guess", () => {
    expect(boundsOf([place("a", 1, 40.72, -74.01)])).toEqual({
      south: 40.72,
      west: -74.01,
      north: 40.72,
      east: -74.01,
    });
  });

  it("handles southern and eastern hemispheres", () => {
    expect(boundsOf([place("a", 1, -33.87, 151.21), place("b", 2, -33.9, 151.18)])).toEqual({
      south: -33.9,
      west: 151.18,
      north: -33.87,
      east: 151.21,
    });
  });

  it("centres on the middle of the box", () => {
    expect(centerOf({ south: 40, west: -74, north: 42, east: -72 })).toEqual({
      lat: 41,
      lng: -73,
    });
  });
});

// --- clustering -------------------------------------------------------------------------------

describe("groupPins", () => {
  const a = place("a", 1, 40.72, -74.0, "7pm");
  const b = place("b", 2, 40.73, -73.99, "8pm");
  const c = place("c", 3, 40.74, -73.98, "9pm");

  it("leaves pins that are far apart on screen alone", () => {
    const groups = groupPins(
      projected([
        [a, 10, 10],
        [b, 400, 400],
      ]),
    );
    expect(groups.map((g) => g.kind)).toEqual(["pin", "pin"]);
  });

  it("draws pins on top of each other as one cluster, at its lowest-numbered place", () => {
    const groups = groupPins(
      projected([
        [a, 10, 10],
        [b, 12, 14],
        [c, 11, 9],
      ]),
    );
    expect(groups).toHaveLength(1);
    const [only] = groups;
    expect(only?.kind).toBe("cluster");
    if (only?.kind === "cluster") {
      expect(only.count).toBe(3);
      expect(only.places.map((p) => p.id)).toEqual(["a", "b", "c"]);
      expect(only.center).toEqual(a.location);
      expect(only.oneSpot).toBe(false);
    }
  });

  it("never draws two markers whose targets overlap, sticker widths and rows included (D-068)", () => {
    // A grid put these two in neighbouring cells, 2px apart: two markers, one over the other.
    const groups = groupPins(
      projected([
        [a, 43, 10],
        [b, 45, 10],
      ]),
    );
    expect(groups.map((g) => g.kind)).toEqual(["cluster"]);

    // Forty places scattered over a phone's map, each at its own point, grouped as they open, as
    // each is selected in turn, and with stickers drawn wider than the estimate. What is checked
    // is what is drawn: each marker's target where MapLibre puts it, at its full width.
    const scattered = projected(
      Array.from({ length: 40 }, (_, index) => {
        const x = (index * 37) % 300;
        const y = (index * 53) % 300;
        return [place(`p${index}`, index + 1, 40.7 + y / 1000, -74 + x / 1000), x, y];
      }),
    );
    const wider = (places: readonly MapPlace[]) =>
      Math.max(TARGET_PX, 16 + 11 * clusterText(places.map((p) => p.number)).length);
    const cases: [string, Parameters<typeof groupPins>[1]][] = [
      ["as opened", {}],
      ["wider stickers", { clusterWidth: wider }],
      ...scattered.map((entry): [string, Parameters<typeof groupPins>[1]] => [
        `${entry.place.id} selected`,
        { selectedId: entry.place.id },
      ]),
    ];
    for (const [name, options] of cases) {
      const width = options?.clusterWidth ?? estimatedClusterWidth;
      const groups = groupPins(scattered, options);
      const boxes = drawnBoxes(groups, scattered, width);
      expect(boxes.flatMap((box) => box.places).sort(), name).toEqual(
        scattered.map((entry) => entry.place.id).sort(),
      );
      // 2026-10-17: a neighbour may sit partly under the selected pin or its spot's fanned
      // nights, which MapCanvas draws on top. Nothing else may overlap.
      const selectedAt = scattered.find((e) => e.place.id === options?.selectedId)?.place.location;
      const raised = new Set(
        groups.flatMap((g) =>
          g.kind === "pin" && selectedAt !== undefined && g.center === selectedAt
            ? [g.place.id]
            : [],
        ),
      );
      for (const [i, first] of boxes.entries()) {
        for (const second of boxes.slice(i + 1)) {
          if (raised.has(first.label) || raised.has(second.label)) continue;
          expect(overlap(first, second), `${name}: ${first.label} and ${second.label}`).toBe(false);
        }
      }
    }
  });

  it("keeps a neighbour off the end of a sticker wider than a pin", () => {
    // The review's case: pin 12 drawn over the end of the 80px sticker "1·3·6·8–11". Its point was
    // 55px from the sticker's, more than a pin's 44, so it was left as a pin on top of it.
    const numbers = [1, 3, 6, 8, 9, 10, 11];
    const crowd = numbers.map((n, index): [MapPlace, number, number] => [
      place(`n${n}`, n, 40.7 + index / 1e4, -74 + index / 1e4, `${n}pm`),
      100 + index,
      100 + index,
    ]);
    const twelve = place("n12", 12, 40.8, -73.9, "12pm");
    const entries = projected([...crowd, [twelve, 155, 100]]);
    const boxes = drawnBoxes(groupPins(entries), entries, estimatedClusterWidth);
    for (const [i, first] of boxes.entries()) {
      for (const second of boxes.slice(i + 1)) expect(overlap(first, second)).toBe(false);
    }
  });

  it("keeps neighbours at their own points; only same-spot places fan out", () => {
    // s is selected, f and g are nearby but not at the same spot. They stay at their own points.
    const s = place("s", 1, 40.7, -74, "7pm");
    const f = place("f", 2, 40.71, -74, "8pm");
    const g = place("g", 3, 40.72, -74, "9pm");
    const entries = projected([
      [s, 100, 100],
      [f, 130, 100],
      [g, 160, 100],
    ]);
    const groups = groupPins(entries, { selectedId: "s" });
    // 2026-10-17: neighbours stay put. f and g, 30px apart, cluster at their own points.
    expect(groups.map((g) => g.kind)).toEqual(["pin", "cluster"]);
    // Check that s is the selected pin
    const selectedPin = groups.find((g) => g.kind === "pin" && g.place.id === "s");
    expect(selectedPin).toBeDefined();
    if (selectedPin?.kind === "pin") {
      expect(selectedPin.offset).toEqual([0, 0]);
    }
    // The cluster should contain f and g
    const cluster = groups.find((g) => g.kind === "cluster");
    expect(cluster).toBeDefined();
    if (cluster?.kind === "cluster") {
      expect(cluster.places.map((p) => p.id).sort()).toEqual(["f", "g"]);
    }
  });

  it("does not regroup while the map is dragged: every point moves together", () => {
    const at = (dx: number, dy: number) =>
      groupPins(
        projected([
          [a, 10 + dx, 10 + dy],
          [b, 40 + dx, 30 + dy],
          [c, 70 + dx, 50 + dy],
        ]),
      ).map((group) =>
        group.kind === "pin" ? group.place.id : group.places.map((p) => p.id).join("+"),
      );
    const still = at(0, 0);
    for (const [dx, dy] of [
      [1, 0],
      [17, 3],
      [-29, 41],
      [300, -250],
    ] as const) {
      expect(at(dx, dy)).toEqual(still);
    }
  });

  it("marks a cluster whose places share one spot, which no zoom can separate", () => {
    const studio = place("s1", 2, 40.75, -73.99, "8pm");
    const sameStudio = place("s2", 3, 40.75 + SAME_SPOT_DEGREES / 2, -73.99, "9pm");
    const groups = groupPins(
      projected([
        [studio, 100, 100],
        [sameStudio, 100, 100],
      ]),
    );
    expect(groups).toHaveLength(1);
    const [only] = groups;
    if (only?.kind !== "cluster") throw new Error("expected a cluster");
    expect(only.oneSpot).toBe(true);
  });

  it("opens the selected place's spot into a row of pins, each with its own target (D-068)", () => {
    const studio = place("s1", 2, 40.75, -73.99, "8pm");
    const sameStudio = place("s2", 3, 40.75, -73.99, "9pm");
    const farAway = place("f", 1, 40.6, -73.9, "7pm");
    const groups = groupPins(
      projected([
        [farAway, 400, 400],
        [studio, 100, 100],
        [sameStudio, 100, 100],
      ]),
      { selectedId: "s1" },
    );
    const pins = groups.filter(
      (group): group is Extract<PinGroup, { kind: "pin" }> => group.kind === "pin",
    );
    expect(pins.map((pin) => pin.place.id)).toEqual(["f", "s1", "s2"]);
    const [, first, second] = pins;
    // Side by side, a full target apart, on one line through the spot.
    // 2026-10-17: pins print the start time; width may be larger than FAN_STEP_PX.
    const step =
      Math.max(FAN_STEP_PX, estimatedPinWidth(studio), estimatedPinWidth(sameStudio)) + 1;
    expect(first?.offset).toEqual([-step / 2, 0]);
    expect(second?.offset).toEqual([step / 2, 0]);
    expect(first?.center).toEqual(studio.location);
    expect(second?.center).toEqual(studio.location);
    expect(pins[0]?.offset).toEqual([0, 0]);
  });

  it("never clusters the selected place away, and leaves its neighbours at their points", () => {
    // 2026-10-17: neighbours stay put; only places at the selected pin's very spot fan out.
    const groups = groupPins(
      projected([
        [a, 10, 10],
        [b, 12, 14],
        [c, 11, 9],
      ]),
      { selectedId: "b" },
    );
    const selectedPin = groups.find((g) => g.kind === "pin" && g.place.id === "b");
    expect(selectedPin).toBeDefined();
    if (selectedPin?.kind === "pin") expect(selectedPin.offset).toEqual([0, 0]);
    const allIds = groups.flatMap((g) =>
      g.kind === "pin" ? [g.place.id] : g.places.map((p) => p.id),
    );
    expect(allIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("lays out n pins in a centred row, a target apart", () => {
    expect(fanOffsets(1)).toEqual([[0, 0]]);
    expect(fanOffsets(2)).toEqual([
      [-22, 0],
      [22, 0],
    ]);
    expect(fanOffsets(3).map(([x]) => x)).toEqual([-44, 0, 44]);
    // 2026-10-17: pins print the start time; custom step.
    expect(fanOffsets(3, 73)).toEqual([
      [-73, 0],
      [0, 0],
      [73, 0],
    ]);
  });

  it("returns groups in list order, lowest pin number first", () => {
    const groups = groupPins(
      projected([
        [c, 10, 10],
        [a, 400, 400],
        [b, 12, 12],
      ]),
    );
    expect(groups[0]?.kind).toBe("pin");
    if (groups[0]?.kind === "pin") expect(groups[0].place.id).toBe("a");
  });

  it("uses the target size it is given, with a pixel of room between targets", () => {
    const wide = projected([
      [a, 0, 0],
      [b, TARGET_PX + 1, 0],
    ]);
    expect(groupPins(wide).map((g) => g.kind)).toEqual(["pin", "pin"]);
    expect(groupPins(wide, { targetPx: 400 }).map((g) => g.kind)).toEqual(["cluster"]);
    // Exactly a target apart would be drawn touching, or a pixel into each other once rounded.
    const touching = projected([
      [a, 0, 0],
      [b, TARGET_PX, 0],
    ]);
    expect(groupPins(touching).map((g) => g.kind)).toEqual(["cluster"]);
  });

  it("clusters nothing when the target is zero", () => {
    const groups = groupPins(
      projected([
        [a, 0, 0],
        [b, 0, 0],
      ]),
      { targetPx: 0 },
    );
    expect(groups.map((g) => g.kind)).toEqual(["pin", "pin"]);
  });

  it("fits the row to the map's width, never below three pins", () => {
    expect(rowPinsFor(390, 22)).toBe(7);
    expect(rowPinsFor(840, 22)).toBe(18);
    expect(rowPinsFor(100, 22)).toBe(3);
  });

  it("has nothing to group when the list is empty", () => {
    expect(groupPins([])).toEqual([]);
  });

  it("keeps the selected pin at its own point; only same-spot places join the row", () => {
    // 78 places on a dense grid (13 columns × 6 rows, 20px apart), all crowding each other.
    const places: MapPlace[] = [];
    const projectedEntries: ProjectedPlace[] = [];
    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 13; col++) {
        const id = `p${row * 13 + col}`;
        const number = row * 13 + col + 1;
        const lat = 40.7 + row * 0.001;
        const lng = -74 + col * 0.001;
        const placeObj = place(id, number, lat, lng, `${((row * 13 + col) % 12) + 1}pm`);
        places.push(placeObj);
        const x = col * 20;
        const y = row * 20;
        projectedEntries.push({ place: placeObj, x, y });
      }
    }
    // Select place 20 (Arthur's Tavern). No other place shares its exact spot, so there is no row.
    const selectedId = "p19"; // zero-based index 19 → number 20
    const groups = groupPins(projectedEntries, { selectedId });
    // The selected place is a pin with offset [0,0] at its own location.
    const selectedPin = groups.find((g) => g.kind === "pin" && g.place.id === selectedId);
    expect(selectedPin).toBeDefined();
    if (selectedPin?.kind === "pin") {
      expect(selectedPin.offset).toEqual([0, 0]);
      expect(selectedPin.center).toEqual(selectedPin.place.location);
    }
    // No pin has a non-zero offset (no row).
    const pinsWithOffset = groups.filter(
      (g): g is Extract<PinGroup, { kind: "pin" }> =>
        g.kind === "pin" && (g.offset[0] !== 0 || g.offset[1] !== 0),
    );
    expect(pinsWithOffset).toHaveLength(0);
    // Every one of the 78 ids appears exactly once across all groups.
    const allIds = groups.flatMap((g) =>
      g.kind === "pin" ? [g.place.id] : g.places.map((p) => p.id),
    );
    expect(allIds).toHaveLength(78);
    expect(new Set(allIds).size).toBe(78);
  });

  it("when 10 places share one spot and one is selected, row has MAX_FAN_PINS pins, rest cluster", () => {
    const spot = { lat: 40.75, lng: -73.99 };
    const places: MapPlace[] = [];
    const projectedEntries: ProjectedPlace[] = [];
    for (let i = 0; i < 10; i++) {
      const id = `s${i}`;
      const number = i + 1;
      const placeObj = place(id, number, spot.lat, spot.lng, `${(i % 12) + 1}pm`);
      places.push(placeObj);
      projectedEntries.push({ place: placeObj, x: 100, y: 100 });
    }
    const selectedId = "s5";
    const groups = groupPins(projectedEntries, { selectedId });
    // Find the row center from the selected pin
    const selectedPin = groups.find((g) => g.kind === "pin" && g.place.id === selectedId);
    const rowCenter = selectedPin?.center;
    // All pins that share the same center are part of the row
    const rowPins = groups.filter(
      (g): g is Extract<PinGroup, { kind: "pin" }> =>
        g.kind === "pin" && rowCenter !== undefined && sameSpot(g.center, rowCenter),
    );
    expect(rowPins).toHaveLength(MAX_FAN_PINS);
    // The selected place must be among the row pins.
    expect(rowPins.some((p) => p.place.id === selectedId)).toBe(true);
    // The remaining 3 places must be present (in a cluster).
    const cluster = groups.find((g) => g.kind === "cluster");
    expect(cluster).toBeDefined();
    if (cluster?.kind === "cluster") {
      expect(cluster.places).toHaveLength(3);
    }
    // All 10 ids appear exactly once.
    const allIds = groups.flatMap((g) =>
      g.kind === "pin" ? [g.place.id] : g.places.map((p) => p.id),
    );
    expect(allIds).toHaveLength(10);
    expect(new Set(allIds).size).toBe(10);
  });

  it("keeps the existing behaviour for 3 places at one spot, one selected", () => {
    const spot = { lat: 40.75, lng: -73.99 };
    const a = place("a", 1, spot.lat, spot.lng, "7pm");
    const b = place("b", 2, spot.lat, spot.lng, "8pm");
    const c = place("c", 3, spot.lat, spot.lng, "9pm");
    const entries = projected([
      [a, 100, 100],
      [b, 100, 100],
      [c, 100, 100],
    ]);
    const groups = groupPins(entries, { selectedId: "b" });
    const pins = groups.filter((g): g is Extract<PinGroup, { kind: "pin" }> => g.kind === "pin");
    expect(pins).toHaveLength(3);
    // 2026-10-17: pins print the start time; width may be larger than FAN_STEP_PX.
    const step =
      Math.max(FAN_STEP_PX, estimatedPinWidth(a), estimatedPinWidth(b), estimatedPinWidth(c)) + 1;
    expect(pins.map((p) => p.offset[0])).toEqual([-step, 0, step]);
  });

  it("marks every pin in the selected spot's row with inRow: true, even the middle one", () => {
    const spot = { lat: 40.75, lng: -73.99 };
    const a = place("a", 1, spot.lat, spot.lng, "7pm");
    const b = place("b", 2, spot.lat, spot.lng, "8pm");
    const c = place("c", 3, spot.lat, spot.lng, "9pm");
    const entries = projected([
      [a, 100, 100],
      [b, 100, 100],
      [c, 100, 100],
    ]);
    const groups = groupPins(entries, { selectedId: "a" });
    const pins = groups.filter((g): g is Extract<PinGroup, { kind: "pin" }> => g.kind === "pin");
    expect(pins).toHaveLength(3);
    // All three are in the row, including the middle pin whose offset is [0, 0].
    expect(pins.map((p) => p.inRow)).toEqual([true, true, true]);
    // The middle pin (b, number 2) has offset [0, 0] but is still inRow.
    const middlePin = pins.find((p) => p.place.id === "b");
    expect(middlePin?.offset).toEqual([0, 0]);
    expect(middlePin?.inRow).toBe(true);
  });

  it("marks pins as inRow: false when nothing is selected", () => {
    const a = place("a", 1, 40.72, -74.0, "7pm");
    const b = place("b", 2, 40.73, -73.99, "8pm");
    const entries = projected([
      [a, 100, 100],
      [b, 200, 200],
    ]);
    const groups = groupPins(entries);
    const pins = groups.filter((g): g is Extract<PinGroup, { kind: "pin" }> => g.kind === "pin");
    expect(pins).toHaveLength(2);
    expect(pins.every((p) => p.inRow === false)).toBe(true);
  });

  it("marks a nearby unclustered pin as inRow: false, not part of the selected spot's row", () => {
    const selected = place("s", 1, 40.75, -73.99, "7pm");
    const nearby = place("n", 2, 40.751, -73.991, "8pm"); // near but not same spot
    const entries = projected([
      [selected, 100, 100],
      [nearby, 130, 100], // 30px away, not at same spot
    ]);
    const groups = groupPins(entries, { selectedId: "s" });
    const pins = groups.filter((g): g is Extract<PinGroup, { kind: "pin" }> => g.kind === "pin");
    // Selected is a pin at its own point; nearby is also a pin (not clustered, not same spot).
    expect(pins).toHaveLength(2);
    const selectedPin = pins.find((p) => p.place.id === "s");
    const nearbyPin = pins.find((p) => p.place.id === "n");
    expect(selectedPin?.inRow).toBe(true);
    expect(nearbyPin?.inRow).toBe(false);
  });
});

// 2026-10-17: the map now prints a count on a cluster; clusterText is no longer drawn there.
describe("cluster numbers", () => {
  it("prints the list numbers a cluster holds, never a count (D-068)", () => {
    expect(clusterText([2, 3])).toBe("2·3");
    expect(clusterText([3, 2])).toBe("2·3");
    expect(clusterText([2, 3, 4, 5])).toBe("2–5");
    expect(clusterText([1, 4, 5, 6])).toBe("1·4–6");
    expect(clusterText([1, 3, 5])).toBe("1·3·5");
    expect(clusterText([7, 8, 9, 11, 12])).toBe("7–9·11·12");
  });

  it("splits runs of three or more and leaves shorter ones as numbers", () => {
    expect(numberParts([2, 3])).toEqual([2, 3]);
    expect(numberParts([2, 3, 4])).toEqual([[2, 4]]);
    expect(numberParts([4, 4, 5])).toEqual([4, 5]);
  });

  it("uses the separators from src/i18n", () => {
    expect(en.map.cluster.run).toBe("{first}–{last}");
    expect(en.map.cluster.join).toBe("{before}·{after}");
    expect(en.map.cluster.more).toBe("{shown} +{count}");
  });

  it("prints the first numbers and how many more, so a sticker stays a sane width", () => {
    expect(clusterText([1, 3, 6, 8, 9, 10, 11])).toBe("1·3·6 +4");
    expect(clusterText([2, 3, 5, 8])).toBe("2·3·5·8");
    expect(clusterText([1, 2, 3, 5, 6, 7, 8, 9, 10])).toBe("1–3·5–10");
    // Sixty scattered places print the first few and a count, never all sixty.
    const scattered = Array.from({ length: 60 }, (_, index) => index * 2 + 1);
    const text = clusterText(scattered);
    expect(text).toMatch(/ \+\d+$/);
    expect(text.length).toBeLessThanOrEqual(CLUSTER_TEXT_MAX_CHARS);
    // Every place is counted: those printed and those in the "+".
    const printed = text.replace(/ \+\d+$/, "").split("·").length;
    expect(printed + Number(/\+(\d+)$/.exec(text)?.[1])).toBe(60);
    // The first part is always printed, however long.
    expect(clusterText([100, 101, 102, 104, 106, 108])).toBe("100–102 +3");
  });
});

describe("one spot", () => {
  it("treats points within SAME_SPOT_DEGREES on both axes as one spot", () => {
    const here = { lat: 40.75, lng: -73.99 };
    expect(sameSpot(here, { lat: 40.75 + SAME_SPOT_DEGREES / 2, lng: -73.99 })).toBe(true);
    expect(sameSpot(here, { lat: 40.75 + SAME_SPOT_DEGREES * 2, lng: -73.99 })).toBe(false);
    expect(allAtOneSpot([place("a", 1, 40.75, -73.99), place("b", 2, 40.75, -73.99)])).toBe(true);
    expect(allAtOneSpot([place("a", 1, 40.75, -73.99), place("b", 2, 40.76, -73.99)])).toBe(false);
    expect(allAtOneSpot([])).toBe(false);
  });
});

// --- what pins and clusters say ------------------------------------------------------------------

describe("pin and cluster widths", () => {
  it("estimates pin width from its time", () => {
    expect(estimatedPinWidth(place("x", 1, 0, 0, null))).toBe(TARGET_PX);
    expect(estimatedPinWidth(place("x", 1, 0, 0, "7pm"))).toBe(Math.max(TARGET_PX, 16 + 8 * 3));
    expect(estimatedPinWidth(place("x", 1, 0, 0, "10:30pm"))).toBe(Math.max(TARGET_PX, 16 + 8 * 7));
  });

  it("estimates cluster width from its count", () => {
    expect(estimatedClusterWidth([])).toBe(TARGET_PX);
    expect(estimatedClusterWidth([place("a", 1, 0, 0, "7pm")])).toBe(
      Math.max(TARGET_PX, 16 + 8 * 1),
    );
    expect(
      estimatedClusterWidth(Array.from({ length: 12 }, (_, i) => place(`p${i}`, i, 0, 0, "7pm"))),
    ).toBe(Math.max(TARGET_PX, 16 + 8 * 2));
  });
});

describe("accessible names", () => {
  const milonga = place("m", 3, 40.7, -74, "9pm");
  milonga.title = "Milonga la Nacional";

  // A pin prints the start time, not its list number (D-149), so it is spoken the same way: the
  // printed time first, then the night (D-170). "20, Milonga" named a number nobody can see.
  it("names a pin by the time it prints and its night, and says when it is selected", () => {
    expect(pinName(milonga, false)).toBe("9pm, Milonga la Nacional");
    expect(pinName(milonga, true)).toBe("9pm, Milonga la Nacional, selected");
  });

  it("names a pin without a listed time by its night alone, never by its number", () => {
    const untimed = { ...milonga, time: null };
    expect(pinName(untimed, false)).toBe("Milonga la Nacional");
    expect(pinName(untimed, true)).toBe("Milonga la Nacional, selected");
  });

  it("names a cluster by the count it prints and its venues, once each", () => {
    const studio = (id: string, number: number) => ({
      ...place(id, number, 40.75, -73.99, "8pm"),
      venueName: "Stepping Out Studios",
    });
    expect(clusterName([studio("x", 3), studio("y", 2)])).toBe("2 places, Stepping Out Studios");
    expect(
      clusterName([
        studio("x", 2),
        studio("y", 3),
        { ...place("z", 5, 40.75, -73.99, "10pm"), venueName: "SOB's" },
      ]),
    ).toBe("3 places, Stepping Out Studios and SOB's");
    expect(clusterName([{ ...studio("x", 2), venueName: " " }, studio("y", 4)])).toBe(
      "2 places, Stepping Out Studios",
    );
    expect(
      clusterName([
        { ...studio("x", 2), venueName: "" },
        { ...studio("y", 4), venueName: "" },
      ]),
    ).toBe("2 places");
  });
});

describe("framing the map", () => {
  const place = (id: string, lat = 40.75): MapPlace => ({
    id,
    number: 1,
    title: id,
    time: "7pm",
    venueName: "A hall",
    location: { lat, lng: -73.99 },
  });

  it("keeps the view while the dancer's request is the same, whatever the list does under it", () => {
    // Tonight's page is rendered again each minute; a night that has ended leaves the list then.
    // The map used to frame every pin again, snapping a panned map back (2026-09-28).
    const ask = "2026-09-28 /?t=social";
    expect(framingKeyFor(ask, [place("a"), place("b")])).toBe(framingKeyFor(ask, [place("b")]));
  });

  it("frames again for another night, filter or sort", () => {
    const pins = [place("a")];
    expect(framingKeyFor("2026-09-28 /", pins)).not.toBe(
      framingKeyFor("2026-09-29 /?day=2026-09-29", pins),
    );
    expect(framingKeyFor("2026-09-28 /", pins)).not.toBe(
      framingKeyFor("2026-09-28 /?t=social", pins),
    );
  });

  it("follows the pins themselves when no request is given (the event page's one venue)", () => {
    expect(framingKeyFor(undefined, [place("a")])).toBe(framingKeyFor(undefined, [place("a")]));
    expect(framingKeyFor(undefined, [place("a")])).not.toBe(
      framingKeyFor(undefined, [place("a", 40.76)]),
    );
  });
});
