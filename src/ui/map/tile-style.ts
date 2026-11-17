// Which tiles the map draws, and what happens when they are not there (D-013).
//
// D-013 settles the stack: MapLibre GL JS with OpenFreeMap vector tiles (keyless, donation
// funded, planet rebuilt weekly, no SLA) and a per-metro Protomaps extract on Cloudflare R2 as
// the fallback. "No SLA" is the whole reason the fallback exists, so it is not decoration: the
// style document is fetched before the map is built and the fallback is used when that fetch
// does not produce one.
//
// Two styles, not one. The page theme and the map must agree: a bright map inside the navy
// print run reads as a hole cut in the page. OpenFreeMap serves several OpenMapTiles styles;
// `positron` is the quiet one, which is what a flyer wants under loud spot-coloured pins, and
// `fiord` is its navy-grey counterpart rather than a near-black one, so the dark map sits on
// the navy stock instead of fighting it. `liberty` is the style OpenFreeMap maintains most
// actively and is the one to move to if either of these is withdrawn.

import type { MapTheme, TileStyles } from "@/src/ui/map/types";

/** OpenFreeMap's style documents. No key, no account, no per-load cost (D-013). */
export const OPENFREEMAP_STYLES: TileStyles = Object.freeze({
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/fiord",
});

/** The file name each theme's fallback style takes under `TILES_FALLBACK_URL`. */
export const FALLBACK_STYLE_FILES: Readonly<Record<MapTheme, string>> = Object.freeze({
  light: "positron.json",
  dark: "fiord.json",
});

/** The style document for a theme. */
export function tileStyleUrl(theme: MapTheme, styles: TileStyles = OPENFREEMAP_STYLES): string {
  return theme === "dark" ? styles.dark : styles.light;
}

/**
 * The fallback styles under a configured base URL, or null when none is configured (which is
 * the normal state in mock mode and in development: no fallback, and OpenFreeMap's failure is
 * then simply reported rather than papered over).
 *
 * The argument is the environment object rather than a module-level read of it, so this file
 * stays importable from a client component without dragging the server's environment along.
 */
export function fallbackTileStyles(env: {
  TILES_FALLBACK_URL?: string | undefined;
}): TileStyles | null {
  const base = env.TILES_FALLBACK_URL;
  if (base === undefined || base.trim() === "") return null;
  const root = base.endsWith("/") ? base : `${base}/`;
  try {
    return {
      light: new URL(FALLBACK_STYLE_FILES.light, root).toString(),
      dark: new URL(FALLBACK_STYLE_FILES.dark, root).toString(),
    };
  } catch {
    // A base that is not a URL is a configuration mistake, not a reason to break the map.
    return null;
  }
}

/**
 * The theme the page is printed in. `data-theme` is the visitor's own choice, stamped on <html>
 * before first paint by `themeInitScript`; with no choice recorded the device decides. Pure, so
 * the rule is tested rather than trusted.
 */
export function resolveMapTheme(dataTheme: string | null, prefersDark: boolean): MapTheme {
  if (dataTheme === "dark") return "dark";
  if (dataTheme === "light") return "light";
  return prefersDark ? "dark" : "light";
}

/** A fetched style document. MapLibre validates it; we only check that we got an object. */
export type StyleDocument = Record<string, unknown>;

export interface ResolvedStyle {
  style: StyleDocument;
  /** Which of the two answered, so a caller can log a fallback rather than discover it later. */
  source: "primary" | "fallback";
}

function isStyleDocument(value: unknown): value is StyleDocument {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Fetch the style document for a theme, falling back per D-013 when the primary does not
 * answer. Fetching it ourselves rather than handing MapLibre a URL is what makes the fallback
 * possible at all: MapLibre's own style load failure arrives after the map is built, by which
 * point the visitor has already seen an empty grey square.
 *
 * Throws only when neither answers, which is the honest outcome: the caller draws the "map
 * unavailable" state and the list, which has every fact the map has, is still there.
 */
export async function resolveStyle(
  theme: MapTheme,
  options: {
    styles?: TileStyles;
    fallbackStyles?: TileStyles | null;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
  } = {},
): Promise<ResolvedStyle> {
  const styles = options.styles ?? OPENFREEMAP_STYLES;
  const fallbackStyles = options.fallbackStyles ?? null;
  const fetchImpl = options.fetchImpl ?? fetch;
  const init = options.signal === undefined ? undefined : { signal: options.signal };

  const attempt = async (url: string): Promise<StyleDocument | null> => {
    try {
      const response = await fetchImpl(url, init);
      if (!response.ok) return null;
      const body: unknown = await response.json();
      return isStyleDocument(body) ? body : null;
    } catch {
      return null;
    }
  };

  const primary = await attempt(tileStyleUrl(theme, styles));
  if (primary !== null) return { style: primary, source: "primary" };

  if (fallbackStyles !== null) {
    const fallback = await attempt(tileStyleUrl(theme, fallbackStyles));
    if (fallback !== null) return { style: fallback, source: "fallback" };
  }

  throw new Error(`No map style could be loaded for the ${theme} theme`);
}
