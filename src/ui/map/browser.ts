"use client";

// Two facts only the browser knows: which print run the page is showing, and whether the
// viewport is wide enough for the split view. Both are read with `useSyncExternalStore`, so the
// server renders the documented default (light, not split) and the browser corrects it in the
// same commit rather than in a second paint.
//
// This module is "use client" because `matchMedia`, `document.documentElement` and
// `MutationObserver` do not exist on the server. It imports nothing from MapLibre, so a card
// that wants to know the theme does not pay for a map.

import { useSyncExternalStore } from "react";

import { resolveMapTheme } from "@/src/ui/map/tile-style";
import type { MapTheme } from "@/src/ui/map/types";

/** The split view's breakpoint (DESIGN.md section 5: list at 440px with the map beside it). */
export const SPLIT_QUERY = "(min-width: 1024px)";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToQuery(query: string, onChange: () => void): () => void {
  const list = window.matchMedia(query);
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}

/**
 * Whether a media query matches now. On the server it is false: the phone layout is the one
 * that must be right without JavaScript, and the map is not part of it.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribeToQuery(query, onChange),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * The page's theme, watching both the visitor's recorded choice (the `data-theme` attribute
 * that `themeInitScript` stamps on <html>) and the device preference behind it, so a theme
 * toggle anywhere on the page moves the map's tiles with it.
 */
export function useMapTheme(): MapTheme {
  return useSyncExternalStore(
    (onChange) => {
      const observer = new MutationObserver(onChange);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      const unsubscribe = subscribeToQuery(DARK_QUERY, onChange);
      return () => {
        observer.disconnect();
        unsubscribe();
      };
    },
    () =>
      resolveMapTheme(
        document.documentElement.getAttribute("data-theme"),
        window.matchMedia(DARK_QUERY).matches,
      ),
    () => "light",
  );
}
