// Shared by the map specs (D-068). The tile host is never reached: every style and tile request
// is answered here, so a test about our pins cannot fail because a network cannot reach
// OpenFreeMap, and cannot pass because it could.

import type { Page, Route } from "@playwright/test";

/** A valid style with nothing to fetch: the map loads at once. */
export const EMPTY_STYLE = {
  version: 8,
  name: "test",
  sources: {},
  layers: [{ id: "paper", type: "background", paint: { "background-color": "#F2EDE3" } }],
};

/** A style with one tiled source, so "load" waits for its tiles and their z/x/y can be read. */
export const TILED_STYLE = {
  version: 8,
  name: "test-tiled",
  sources: {
    streets: {
      type: "vector",
      tiles: ["https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf"],
      minzoom: 0,
      maxzoom: 14,
    },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#F2EDE3" } },
    { id: "water", type: "fill", source: "streets", "source-layer": "water" },
  ],
};

const TILE_HOST = /(openfreemap|protomaps|maptiler|tiles)\./i;
const CORS = { "access-control-allow-origin": "*" };

export interface StubOptions {
  /** The style served; the empty one by default. */
  style?: object;
  /** "empty" answers tiles with nothing; "hang" never answers, so "load" never fires. */
  tiles?: "empty" | "hang";
  /** Held this long before the style is served, in ms. */
  styleDelayMs?: number;
  /**
   * Style requests fail (HTTP 500) while this returns true. A switch the test turns off, not a
   * count: under `next dev` React mounts the map twice, and the first mount's request, aborted,
   * can still reach the stub and use up a count, so "fail the first one" failed nothing.
   */
  failStylesWhile?: () => boolean;
  /** Every tile URL requested, in order. */
  tileLog?: string[];
}

export async function stubTiles(page: Page, options: StubOptions = {}): Promise<void> {
  await page.route(TILE_HOST, async (route: Route) => {
    const url = route.request().url();
    if (/\.pbf/i.test(url)) {
      options.tileLog?.push(url);
      if (options.tiles === "hang") return; // never answered
      await route.fulfill({ status: 204, headers: CORS, body: "" });
      return;
    }
    if (options.failStylesWhile?.() === true) {
      await route.fulfill({ status: 500, headers: CORS, body: "" });
      return;
    }
    if (options.styleDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, options.styleDelayMs));
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS,
      body: JSON.stringify(options.style ?? EMPTY_STYLE),
    });
  });
}

/** The zoom level of a logged tile URL (".../{z}/{x}/{y}.pbf"). */
export function tileZoom(url: string): number {
  const match = /\/(\d+)\/\d+\/\d+\.pbf/.exec(url);
  return match === null ? Number.NaN : Number(match[1]);
}

/** The New York seed's centre (src/db/seed/nyc-data.ts). */
export const SEED_CENTER = { lat: 40.7128, lng: -74.006 };
/** Boston: a real place with nothing the seed knows near it. */
export const FAR_AWAY = { lat: 42.3601, lng: -71.0589 };

export function homePath(
  params: Record<string, string> = {},
  center: { lat: number; lng: number } = SEED_CENTER,
): string {
  const query = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    ...params,
  });
  return `/?${query.toString()}`;
}

/** Every marker on the map (a pin or a cluster); MapLibre gives each this class. */
export const MARKER = ".maplibregl-marker[aria-label]";
/** A single pin: "9pm, Milonga la Nacional". */
export const PIN = '.maplibregl-marker[data-marker="pin"]';
/** A cluster: "2 places, Stepping Out Studios". */
export const CLUSTER = '.maplibregl-marker[data-marker="cluster"]';
/** A card link the dancer can reach: not one in the list while the phone map covers it. */
export const REACHABLE_CARD = 'a[href^="/e/"]:not([inert] a)';
/** The phone's List/Map bar. */
export const TOGGLE = '[role="group"][aria-label="List or map"]';

/** The list numbers a marker stands for, read from its data-numbers attribute. */
export function numbersIn(dataNumbers: string): number[] {
  return dataNumbers
    .split(/\s+/)
    .filter((part) => part !== "")
    .map(Number);
}

export interface MapChunkOptions {
  /** The chunk request fails while this returns true, as on a dropped connection. */
  failWhile?: () => boolean;
  /** The chunk is held back until this settles, as on a slow one. */
  holdUntil?: Promise<void>;
}

/**
 * Stand between the page and the map's code: the JavaScript chunk that draws `maplibregl-canvas`
 * (MapCanvas and MapLibre, which MapPanel loads on its own). Every other chunk passes untouched.
 */
export async function interceptMapChunk(page: Page, options: MapChunkOptions): Promise<void> {
  await page.route(/\/_next\/static\/chunks\/.*\.js/, async (route: Route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes("maplibregl-canvas")) {
      if (options.failWhile?.() === true) {
        await route.abort("failed");
        return;
      }
      if (options.holdUntil !== undefined) await options.holdUntil;
    }
    await route.fulfill({ response, body });
  });
}
