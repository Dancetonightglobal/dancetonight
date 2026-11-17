"use client";

// The list and the map, arranged (DESIGN.md sections 5 and 6, D-068). From 1024px they sit side
// by side, the list at 440px and the map filling the rest; below that they are one screen with a
// toggle across its foot. This component owns the two pieces of state that both halves need --
// which view a phone is showing, and which listing is highlighted -- and hands them down through
// `MapSelectionProvider`, so a card can highlight itself without importing a mapping library.
//
// "use client" because it reads the viewport width and the page theme, and because the toggle
// and the highlight are state that changes on the page.
//
// On a phone the map is laid over the list rather than swapped for it: once shown it stays
// mounted, and the list underneath keeps its place, so going back to the list is where you were
// and going back to the map does not build a new one. The map pane ends above the toggle, so the
// attribution and every message on the map stay readable.
//
// The list is `children`: the home screen renders its own bill of times and passes it in, which
// keeps this file out of the business of what a card looks like. The strip across the top of the
// phone's map view comes the same way.

import { type ReactNode, useCallback, useEffect, useState, useRef, useLayoutEffect } from "react";

import { t } from "@/src/i18n";
import { SPLIT_QUERY, useMapTheme, useMediaQuery } from "@/src/ui/map/browser";
import { ListMapToggle } from "@/src/ui/map/ListMapToggle";
import { MapPanel, preloadMapCanvas } from "@/src/ui/map/MapPanel";
import { MapSelectionProvider, useMapSelection } from "@/src/ui/map/selection";
import { OPENFREEMAP_STYLES } from "@/src/ui/map/tile-style";
import type { LatLng, MapPlace, MapView, TileStyles } from "@/src/ui/map/types";

export interface MapSplitProps {
  /** The listings the list is showing, numbered in the order it shows them. */
  places: readonly MapPlace[];
  /** The primary tile styles; defaults to OpenFreeMap (D-013). */
  styles?: TileStyles;
  /**
   * The fallback styles from `fallbackTileStyles(env)`, or null. A server component reads the
   * environment and passes the result, so no map file ever imports the server's environment.
   */
  fallbackStyles?: TileStyles | null;
  /** Where the map opens when there is nothing to fit to; normally the search centre. */
  center?: LatLng;
  /** Whether the night has places within reach that the filters hide (see MapCanvasProps). */
  hiddenByFilters?: boolean;
  /** How many listed places have no pin (see MapCanvasProps, D-082). */
  unplaced?: number;
  /** What the dancer asked for, which the map frames on (see MapCanvasProps). */
  frameKey?: string;
  /** The bill of times. */
  children: ReactNode;
  /**
   * Which pane the phone opens on. The home page reads it from `?view=`, so a shared map link
   * opens on the map and the back button still works; after that the toggle owns it client-side.
   */
  initialView?: MapView;
  /** This page without `view`, and with `view=map`: the toggle's two links (D-068). */
  listHref: string;
  mapHref: string;
  /** The strip across the top of the phone's map view: the night, the place, the count. */
  strip?: ReactNode;
}

/** Run once the browser has nothing better to do; Safari has no requestIdleCallback. */
function whenIdle(task: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(task, { timeout: 4_000 });
    return () => window.cancelIdleCallback(handle);
  }
  const handle = window.setTimeout(task, 1_500);
  return () => window.clearTimeout(handle);
}

function Panes({
  places,
  styles,
  fallbackStyles,
  center,
  hiddenByFilters,
  unplaced,
  frameKey,
  isSplit,
  children,
  listHref,
  mapHref,
  strip,
}: {
  places: readonly MapPlace[];
  styles: TileStyles;
  fallbackStyles: TileStyles | null;
  center: LatLng | undefined;
  hiddenByFilters: boolean;
  unplaced: number;
  frameKey: string | undefined;
  isSplit: boolean;
  children: ReactNode;
  listHref: string;
  mapHref: string;
  strip: ReactNode;
}) {
  const { selectedId, select, view } = useMapSelection();
  const theme = useMapTheme();
  const phoneMap = !isSplit && view === "map";
  const wanted = isSplit || view === "map";

  // Once the map has been shown it stays built; the phone's list view only hides it.
  const [mounted, setMounted] = useState(wanted);
  if (wanted && !mounted) setMounted(true);

  // A phone on the list fetches the map's code while it is idle, so tapping Map does not also
  // wait for MapLibre to download. A fetch that fails is left for the tap to try again, and to
  // report through the map's own failed notice (MapPanel).
  useEffect(() => {
    if (mounted || isSplit) return;
    return whenIdle(() => {
      preloadMapCanvas().catch(() => {});
    });
  }, [mounted, isSplit]);

  const label =
    places.length === 0 ? t("a11y.map") : t("a11y.mapWithCount", { count: places.length });
  // The sheet holds the picked pin's card. A card with no pin (its location is not listed, D-082)
  // can still be the selection, by a hover or a focus on the list, but it is no pin's card.
  const showSheet =
    phoneMap && selectedId !== null && places.some((place) => place.id === selectedId);

  return (
    <>
      <div className="lg:flex lg:items-start">
        {/* The list keeps its own 640px measure inside this pane; 440px is the split width. */}
        <div
          inert={phoneMap}
          aria-hidden={phoneMap ? true : undefined}
          className="pb-13 lg:w-split lg:shrink-0 lg:pb-0"
        >
          {children}
        </div>
        {mounted ? (
          // Phone: fixed over the list from the top of the screen to the toggle. Split view:
          // sticky and full height beside the list, so the map does not scroll away from it.
          <div
            className={`${phoneMap ? "" : "invisible"} bg-paper fixed inset-x-0 top-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-20 flex flex-col pt-[env(safe-area-inset-top)] lg:pt-0 lg:visible lg:sticky lg:inset-x-auto lg:bottom-auto lg:z-auto lg:h-dvh lg:flex-1`}
          >
            {strip === undefined ? null : <div className="touch-none lg:hidden">{strip}</div>}
            {/* The map keeps at least min-h-map; the card's sheet gives way first and scrolls. */}
            <div className="min-h-map flex-1">
              <MapPanel
                places={places}
                selectedId={selectedId}
                onSelect={select}
                theme={theme}
                styles={styles}
                fallbackStyles={fallbackStyles}
                label={label}
                hiddenByFilters={hiddenByFilters}
                unplaced={unplaced}
                {...(frameKey === undefined ? {} : { frameKey })}
                {...(center === undefined ? {} : { center })}
              />
            </div>
            {/* The picked pin's card, above the toggle; the map above it makes room for it. */}
            {showSheet && selectedId !== null ? (
              <div className="bg-paper border-halftone max-h-1/2 overflow-y-auto overscroll-contain border-t lg:hidden">
                <SheetCard id={selectedId} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <ListMapToggle
        view={view}
        listHref={listHref}
        mapHref={mapHref}
        className="fixed inset-x-0 bottom-0 z-30 lg:hidden"
      />
    </>
  );
}

/**
 * The picked pin's card, copied from the list on the page (the list draws every card once;
 * the sheet borrows the one picked rather than the page sending each card a second time).
 */
function SheetCard({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const host = ref.current;
    if (host === null) return;
    const source = document.querySelector(`[data-card-id="${CSS.escape(id)}"]`);
    // A card is its link and, beside it, its event line (src/ui/home/Card.tsx): copy them all.
    const copies = [...(source?.children ?? [])].map((child) => child.cloneNode(true) as Element);
    // The copy is a second rendering of the card: ids must stay unique on the page.
    for (const copy of copies) {
      for (const el of [copy, ...copy.querySelectorAll("[id]")]) el.removeAttribute("id");
    }
    host.replaceChildren(...copies);
  }, [id]);
  return <div ref={ref} />;
}

export function MapSplit({
  places,
  styles = OPENFREEMAP_STYLES,
  fallbackStyles = null,
  center,
  hiddenByFilters = false,
  unplaced = 0,
  frameKey,
  children,
  initialView = "list",
  listHref,
  mapHref,
  strip,
}: MapSplitProps) {
  const isSplit = useMediaQuery(SPLIT_QUERY);
  const [view, setViewState] = useState<MapView>(initialView);

  /*
   * The view lives in the URL like every other piece of state (PLAN section 11), so a map link is
   * shareable and the back button returns to the list. It is pushed rather than navigated: the
   * map is already mounted client-side, so a server round-trip would only cost a flash of the
   * list. `popstate` keeps the panes in step when the visitor goes back.
   */
  const setView = useCallback((next: MapView) => {
    setViewState(next);
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (next === "map") url.searchParams.set("view", "map");
    else url.searchParams.delete("view");
    if (url.href !== window.location.href) window.history.pushState(null, "", url);
  }, []);

  useEffect(() => {
    const sync = () => {
      setViewState(
        new URL(window.location.href).searchParams.get("view") === "map" ? "map" : "list",
      );
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  return (
    <MapSelectionProvider
      places={places}
      mapOnScreen={isSplit || view === "map"}
      listOnScreen={isSplit || view === "list"}
      view={view}
      setView={setView}
    >
      <Panes
        places={places}
        styles={styles}
        fallbackStyles={fallbackStyles}
        center={center}
        hiddenByFilters={hiddenByFilters}
        unplaced={unplaced}
        frameKey={frameKey}
        isSplit={isSplit}
        listHref={listHref}
        mapHref={mapHref}
        strip={strip}
      >
        {children}
      </Panes>
    </MapSelectionProvider>
  );
}
