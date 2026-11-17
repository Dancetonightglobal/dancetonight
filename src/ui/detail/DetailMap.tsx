"use client";

// The map in WHERE (DESIGN.md section 7, amended by D-068 at the owner's request: "the map only
// turns on when clicked, which is a problem"). It loads by itself once WHERE comes within about
// 300px of the screen, so it is drawn by the time the dancer scrolls to it, and nothing of
// MapLibre is fetched for a visitor who never scrolls that far: one venue is still not worth
// 200KB on first paint. Until then the halftone sheet holds the space with the numbered pin.
//
// The canvas has the whole 176px sheet, with the attribution below it; one finger scrolls the
// page and two move the map (cooperative gestures); and the venue's pin is the spot sticker, not
// the ink of a selection, because there is nothing else on this map to select it from.
//
// The frame is drawn here, not by the map: the hairline, a 176px area, and the attribution under
// it, from first paint. The sheet, the loading placeholder and the map then take turns in the
// same area, so nothing below WHERE moves when the map arrives (it moved 78px; review,
// 2026-09-28).
//
// "use client" because whether WHERE is near the screen is something only the browser knows.

import { useEffect, useRef, useState } from "react";

import { t } from "@/src/i18n";
import { MapPanel, useMapTheme, OPENFREEMAP_STYLES } from "@/src/ui/map";
import { MapCredits } from "@/src/ui/map/MapCredits";
import type { MapPlace, TileStyles } from "@/src/ui/map";

/** The one place on this page, so its pin is number 1 (the owner chose numbered pins). */
export const PIN_NUMBER = 1;

/** How near the screen WHERE has to come before the map starts loading. */
export const LOAD_MARGIN = "300px 0px";

const noSelection = () => {};

export function DetailMap({
  place,
  fallbackStyles,
  styles = OPENFREEMAP_STYLES,
}: {
  place: MapPlace;
  /** From `fallbackTileStyles(env)` on the server, or null when none is configured. */
  fallbackStyles: TileStyles | null;
  styles?: TileStyles;
}) {
  const [near, setNear] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const theme = useMapTheme();

  useEffect(() => {
    const frame = frameRef.current;
    if (near || frame === null) return;
    // A browser without IntersectionObserver loads the map at once rather than never.
    if (typeof IntersectionObserver === "undefined") {
      const handle = window.setTimeout(() => setNear(true), 0);
      return () => window.clearTimeout(handle);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(frame);
    return () => observer.disconnect();
  }, [near]);

  return (
    <div ref={frameRef} className="bg-halftone chip-edge rounded-control overflow-hidden">
      <div className="relative h-44">
        {near ? (
          <MapPanel
            places={[place]}
            selectedId={null}
            onSelect={noSelection}
            theme={theme}
            styles={styles}
            fallbackStyles={fallbackStyles}
            label={t("a11y.mapWithCount", { count: 1 })}
            center={place.location}
            inline
          />
        ) : (
          <div role="status" className="grid h-full w-full place-items-center">
            <span className="type-secondary text-ink px-4 text-center">{t("map.loading")}</span>
            {/* The pin is drawn, not announced: the status line says what the sheet is. */}
            <span
              aria-hidden="true"
              className="bg-spot text-paper type-stamp-sm ring-paper grid h-7 min-w-7 place-items-center whitespace-nowrap rounded-full px-1.5 ring-2"
            >
              {place.time ?? ""}
            </span>
          </div>
        )}
        <MapCredits />
      </div>
    </div>
  );
}
