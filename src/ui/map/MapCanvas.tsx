"use client";

// The only module that knows what MapLibre is (D-013). It is never imported directly: MapPanel
// reaches it through `next/dynamic`, so maplibre-gl and its stylesheet are their own chunk and a
// phone that stays on the list downloads them only when the browser is idle.
//
// "use client" because a WebGL map is a browser thing from end to end: it needs a canvas, a
// worker, `matchMedia` and pointer events, and none of that exists while the page is rendered
// on the server.
//
// Pins carry a number and no family colour, because a colour with no label beside it would be a
// fact only a sighted visitor could read (DESIGN.md section 11). The colour lives on the
// highlighted card, next to its family name. Everything a pin shows is in the list as words.
//
// D-068 settled how it behaves on a phone: the map opens framed on the pins (no second framing
// once the tiles are in), the pins are drawn as soon as the style is, a cluster names the list
// numbers it holds and opens rather than zooming forever, the map makes room for the selected
// card below it and keeps the pin in view, and "Show all" brings back every pin.
//
// The card is below the map, not laid over it: Chromium's compositor, drawing a WebGL canvas
// half covered by an opaque sheet, skipped the wrong half of the canvas (measured in the iPhone
// emulation, 2026-09-28), and a map that ends where the card starts has nothing hidden under it.

import { Map as MapLibreMap, Marker, getWorkerUrl, setWorkerUrl } from "maplibre-gl";
import { useCallback, useEffect, useRef, useState } from "react";

import "maplibre-gl/dist/maplibre-gl.css";

import { t } from "@/src/i18n";
import { clusterName, pinName } from "@/src/ui/map/labels";
import { MapCredits } from "@/src/ui/map/MapCredits";
import {
  CLUSTER_ZOOM_CAP,
  FIT_PADDING_PX,
  MAX_FIT_ZOOM,
  TARGET_PX,
  boundsOf,
  framingKeyFor,
  groupPins,
  rowPinsFor,
} from "@/src/ui/map/pins";
import { MapFailed } from "@/src/ui/map/MapStates";
import { resolveStyle } from "@/src/ui/map/tile-style";
import { MAPLIBRE_WORKER_URL } from "@/src/ui/map/worker";
import type { MapBounds, MapCanvasProps, MapPlace } from "@/src/ui/map/types";
import type { PinGroup } from "@/src/ui/map/pins";

/** Cheap identity for a drawn set of markers; see signatureOf. */
type PinGroupsSignature = string;

/**
 * MapLibre's style type, taken from `setStyle` rather than imported: the package does not export
 * `StyleSpecification` by name. `resolveStyle` only promises a JSON object, because validating a
 * style document is MapLibre's job and duplicating its rules here would be a second source of
 * truth; a style it rejects raises its own error, which the failed state below reports.
 */
type MapLibreStyle = NonNullable<Parameters<MapLibreMap["setStyle"]>[0]>;

/** Where the map opens with no pins to frame: the search centre, at a city's width (D-068). */
const NO_PLACES_ZOOM = 11;

/** Half a pin's 44px target: a pin nearer the edge than this is not fully tappable. */
const PIN_MARGIN_PX = 22;

/** A cluster tap that would zoom in by less than this is treated as one that cannot separate. */
const MIN_USEFUL_ZOOM_STEP = 0.05;

/**
 * The pin's hit area: the 44px minimum, wider when a cluster's numbers need it. `font-sans`
 * because MapLibre sets its own font on the map container, which the markers sit inside.
 */
const TARGET =
  "font-sans grid h-11 min-w-11 cursor-pointer place-items-center border-0 bg-transparent p-0";
/**
 * A 28px-tall spot sticker printing the start time, with a 2px paper halo (DESIGN.md section 5).
 * The halo is a ring (a box shadow), which follows the circle everywhere; an outline is drawn
 * square by Safari before iOS 16.4. The pill grows with its text.
 */
const PIN =
  "type-stamp-sm ring-paper grid h-7 min-w-7 place-items-center whitespace-nowrap rounded-full px-1.5 ring-2";
/**
 * A cluster is the negative of a pin: paper with a 2px spot edge and spot numbers, printing how
 * many places it holds, so it cannot be read as one place (D-068).
 */
const CLUSTER =
  "type-stamp-sm bg-paper text-spot border-spot grid h-9 min-w-9 place-items-center rounded-full border-2 px-1.5";
/** A sticker's type as the marker sets it: TARGET's family and the sticker's own role. */
const STICKER_TYPE = "font-sans type-stamp-sm";

function markerElement(options: {
  accessibleName: string;
  title: string;
  text: string;
  circleClass: string;
  /** Null draws a picture of a pin rather than a control (the detail page's one venue). */
  onActivate: (() => void) | null;
  kind: "pin" | "cluster";
  numbers: readonly number[];
}): HTMLElement {
  const target = document.createElement(options.onActivate === null ? "span" : "button");
  if (target instanceof HTMLButtonElement) target.type = "button";
  else target.setAttribute("role", "img");
  target.className = TARGET;
  target.setAttribute("aria-label", options.accessibleName);
  target.title = options.title;
  target.dataset.marker = options.kind;
  target.dataset.numbers = [...options.numbers].sort((a, b) => a - b).join(" ");
  const activate = options.onActivate;
  if (activate !== null) {
    target.addEventListener("click", (event) => {
      // A pin is a control, not a place on the map: the click must not also reach the map, whose
      // own click clears the selection.
      event.stopPropagation();
      activate();
    });
  }

  const circle = document.createElement("span");
  circle.className = options.circleClass;
  circle.setAttribute("aria-hidden", "true");
  circle.textContent = options.text;
  target.append(circle);
  return target;
}

/** How wide a cluster's target is drawn for the text it prints, in pixels. */
interface StickerMeter {
  width(text: string): number;
  /** Forget what was measured, when a font arrives and the figures change width. */
  reset(): void;
}

/**
 * Measure cluster stickers in the page's own type, so the grouping allows for the loaded font
 * and the visitor's text size (review, 2026-09-28: a sticker grew past the room it was given and
 * a neighbour sat on its end). Each character is measured once, in a hidden copy of the sticker's
 * type inside the map, and a text is the sum of its characters: grouping asks for the width of
 * every text a cluster could print while it forms, which a layout per text would make slow.
 */
function stickerMeter(host: HTMLElement): StickerMeter {
  const glyphs = new Map<string, number>();
  let chrome: number | null = null;
  const RUN = 10;

  const probe = (className: string, text: string): number => {
    const element = document.createElement("span");
    element.className = `invisible absolute whitespace-pre ${className}`;
    element.textContent = text;
    host.append(element);
    const width = element.getBoundingClientRect().width;
    element.remove();
    return width;
  };
  const glyph = (character: string): number => {
    let width = glyphs.get(character);
    if (width === undefined) {
      width = probe(STICKER_TYPE, character.repeat(RUN)) / RUN;
      glyphs.set(character, width);
    }
    return width;
  };

  return {
    width(text) {
      // The sticker's padding and edge: a sticker holding a long run, less the run itself.
      chrome ??= probe(`${STICKER_TYPE} ${CLUSTER}`, "0".repeat(RUN)) - glyph("0") * RUN;
      let inner = 0;
      for (const character of text) inner += glyph(character);
      return Math.max(TARGET_PX, Math.ceil(chrome + inner));
    },
    reset() {
      glyphs.clear();
      chrome = null;
    },
  };
}

/** Cheap identity for a set of groups, so panning does not rebuild markers that did not change. */
function signatureOf(groups: readonly PinGroup[], selectedId: string | null): PinGroupsSignature {
  const parts = groups.map((group) =>
    group.kind === "pin"
      ? `p${group.place.id}@${group.offset.join(",")}`
      : `c${group.places.map((place) => place.id).join(",")}`,
  );
  return `${selectedId ?? ""}|${parts.join("|")}`;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function corners(bounds: MapBounds): [[number, number], [number, number]] {
  return [
    [bounds.west, bounds.south],
    [bounds.east, bounds.north],
  ];
}

/** Frame every place, the same way the map first opened. */
/** What framing depends on: which pins, in what order, where. */
function fitAll(map: MapLibreMap, places: readonly MapPlace[], animate: boolean): void {
  const bounds = boundsOf(places);
  if (bounds === null) return;
  map.fitBounds(corners(bounds), {
    padding: FIT_PADDING_PX,
    maxZoom: MAX_FIT_ZOOM,
    animate: animate && !prefersReducedMotion(),
  });
}

/**
 * Ease a selected pin into view when it is not fully on the map: too near an edge to tap, or cut
 * off by the card sheet the map has just made room for. A pin already in view is left alone, so
 * picking one never moves the map under the finger.
 */
function keepInView(map: MapLibreMap, place: MapPlace | undefined): void {
  if (place === undefined) return;
  const container = map.getContainer();
  const point = map.project([place.location.lng, place.location.lat]);
  const visible =
    point.x >= PIN_MARGIN_PX &&
    point.x <= container.clientWidth - PIN_MARGIN_PX &&
    point.y >= PIN_MARGIN_PX &&
    point.y <= container.clientHeight - PIN_MARGIN_PX;
  if (visible) return;
  map.easeTo({
    center: [place.location.lng, place.location.lat],
    duration: prefersReducedMotion() ? 0 : 400,
  });
}

export default function MapCanvas({
  places,
  selectedId,
  onSelect,
  theme,
  styles,
  fallbackStyles,
  label,
  center,
  hiddenByFilters = false,
  unplaced = 0,
  frameKey,
  inline = false,
}: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  /** The place ids each drawn marker stands for, so focus can follow a place through a redraw. */
  const markerIdsRef = useRef(new WeakMap<HTMLElement, readonly string[]>());
  const signatureRef = useRef<PinGroupsSignature>("");
  const meterRef = useRef<StickerMeter | null>(null);
  // "ready" once the style is in, which is when the pins can be drawn; the tiles come after.
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [tilesDrawn, setTilesDrawn] = useState(false);
  const [everyPinInView, setEveryPinInView] = useState(true);
  const [attempt, setAttempt] = useState(0);

  // The imperative draw and the MapLibre event handlers read the latest props through refs, so
  // panning the map does not tear down and rebuild the map itself. The refs are refreshed in an
  // effect declared before every effect that reads them, which is what keeps them current.
  const selectRef = useRef(onSelect);
  const placesRef = useRef(places);
  const frameKeyRef = useRef(frameKey);
  const selectedRef = useRef(selectedId);
  useEffect(() => {
    selectRef.current = onSelect;
    placesRef.current = places;
    frameKeyRef.current = frameKey;
    selectedRef.current = selectedId;
  });

  // Read once, when the map is built: a re-render does not rebuild it. The theme at mount picks
  // the first style; later changes swap it in the theme effect below.
  const themeRef = useRef(theme);
  const stylesRef = useRef(styles);
  const fallbackRef = useRef(fallbackStyles);
  const centerRef = useRef(center);
  const inlineRef = useRef(inline);
  /**
   * The list the map is framed on, by what it holds, so the same list is not framed twice. Not by
   * identity: tonight's page is rendered again each minute (MinuteTick), which hands the map a new
   * array of the same pins, and framing it again threw away the dancer's pan and zoom once a
   * minute.
   */
  const fittedRef = useRef<string | null>(null);

  /** Whether every pin is inside the view, which is when "Show all" has nothing to do. */
  const measure = useCallback(() => {
    const map = mapRef.current;
    if (map === null) return;
    const view = map.getBounds();
    setEveryPinInView(
      placesRef.current.every((place) => view.contains([place.location.lng, place.location.lat])),
    );
  }, []);

  const draw = useCallback(() => {
    const map = mapRef.current;
    if (map === null) return;
    const currentPlaces = placesRef.current;
    const selected = selectedRef.current;
    const interactive = !inlineRef.current;

    const projected = currentPlaces.map((place) => {
      const point = map.project([place.location.lng, place.location.lat]);
      return { place, x: point.x, y: point.y };
    });
    const meter = (meterRef.current ??= stickerMeter(map.getContainer()));
    const groups = groupPins(projected, {
      selectedId: selected,
      // A row no wider than the map: an unbounded one once laid all 78 pins of a night in a line
      // from New Jersey to Fire Island (owner's screenshots, 2026-10-17).
      maxRowPins: rowPinsFor(map.getContainer().clientWidth, PIN_MARGIN_PX),
      pinWidth: (place) => meter.width(place.time ?? ""),
      clusterWidth: (places) => meter.width(String(places.length)),
    });

    const signature = signatureOf(groups, selected);
    if (signature === signatureRef.current) return;
    signatureRef.current = signature;

    // Every marker is replaced, including one that has the keyboard's focus: a pin just chosen
    // with Enter, or a cluster whose tap is zooming in. Focus then fell to the page and the next
    // Tab started again at pin 1 (review, 2026-09-28; WCAG 2.4.3). It follows the first place the
    // focused marker stood for to the new marker holding it: the pin now selected, or the part of
    // the cluster that holds that place.
    const ids = markerIdsRef.current;
    const active = document.activeElement;
    const followed =
      active instanceof HTMLElement &&
      markersRef.current.some((marker) => marker.getElement() === active)
        ? ids.get(active)?.[0]
        : undefined;

    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [];

    const add = (marker: Marker, placeIds: readonly string[]) => {
      ids.set(marker.getElement(), placeIds);
      markersRef.current.push(marker.addTo(map));
    };

    for (const group of groups) {
      if (group.kind === "pin") {
        const isSelected = group.place.id === selected;
        const element = markerElement({
          accessibleName: pinName(group.place, isSelected),
          title: group.place.title,
          text: group.place.time ?? "",
          // Selected is ink with a paper number; the rest are the spot sticker.
          circleClass: `${PIN} ${isSelected ? "bg-ink text-paper" : "bg-spot text-paper"}`,
          onActivate: interactive ? () => selectRef.current(group.place.id, "map") : null,
          kind: "pin",
          numbers: [group.place.number],
        });
        // Above every other marker: the selected pin stays at its own point and its spot's other
        // nights fan out beside it, so a neighbouring marker may sit partly under them (groupPins).
        const raised = isSelected || group.inRow;
        if (raised) {
          element.style.zIndex = isSelected ? "3" : "2";
          element.dataset.raised = "true";
        }
        add(
          new Marker({ element, offset: group.offset }).setLngLat([
            group.center.lng,
            group.center.lat,
          ]),
          [group.place.id],
        );
        continue;
      }

      const first = group.places[0];
      const element = markerElement({
        accessibleName: clusterName(group.places),
        title: group.places.map((place) => place.title).join(", "),
        text: String(group.places.length),
        circleClass: CLUSTER,
        onActivate:
          !interactive || first === undefined
            ? null
            : () => {
                // Zoom in only when zooming can pull the members apart. Two nights at one studio
                // never separate, and past the zoom cap nothing is gained: the tap selects the
                // first of them, which opens the spot so each pin has its own target (D-068).
                const bounds = boundsOf(group.places);
                const camera =
                  group.oneSpot || bounds === null
                    ? undefined
                    : map.cameraForBounds(corners(bounds), {
                        padding: FIT_PADDING_PX,
                        maxZoom: CLUSTER_ZOOM_CAP,
                      });
                if (
                  camera?.zoom !== undefined &&
                  camera.zoom > map.getZoom() + MIN_USEFUL_ZOOM_STEP
                ) {
                  map.easeTo({ ...camera, duration: prefersReducedMotion() ? 0 : 400 });
                  return;
                }
                selectRef.current(first.id, "map");
              },
        kind: "cluster",
        numbers: group.places.map((place) => place.number),
      });
      add(
        new Marker({ element }).setLngLat([group.center.lng, group.center.lat]),
        group.places.map((place) => place.id),
      );
    }

    if (followed !== undefined) {
      const heir = markersRef.current
        .map((marker) => marker.getElement())
        .find((element) => ids.get(element)?.includes(followed) === true);
      heir?.focus({ preventScroll: true });
    }
  }, []);

  // Build the map once per attempt ("Load the map again" makes a new attempt).
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    let cancelled = false;
    const abort = new AbortController();

    // Open on the pins, not on the centre with a framing afterwards: the first tiles fetched are
    // then the ones on screen, rather than a set for a view that is replaced a moment later.
    const opening = boundsOf(placesRef.current);
    const camera =
      opening !== null
        ? {
            bounds: corners(opening),
            fitBoundsOptions: { padding: FIT_PADDING_PX, maxZoom: MAX_FIT_ZOOM },
          }
        : centerRef.current !== undefined
          ? {
              center: [centerRef.current.lng, centerRef.current.lat] as [number, number],
              zoom: NO_PLACES_ZOOM,
            }
          : { center: [0, 0] as [number, number], zoom: 1 };

    void resolveStyle(themeRef.current, {
      styles: stylesRef.current,
      fallbackStyles: fallbackRef.current,
      signal: abort.signal,
    })
      .then(({ style }) => {
        if (cancelled) return;
        // Before the first map: the worker it starts must be the copy we serve (see worker.ts).
        if (getWorkerUrl() !== MAPLIBRE_WORKER_URL) setWorkerUrl(MAPLIBRE_WORKER_URL);
        const map = new MapLibreMap({
          container,
          style: style as unknown as MapLibreStyle,
          ...camera,
          // Our own credits button sits in the map's corner (MapCredits), because the default
          // control is a rounded white box in MapLibre's own type.
          attributionControl: false,
          keyboard: true,
          // The detail page's map sits in a scrolling page: one finger scrolls the page, two
          // move the map, so a thumb passing over WHERE never gets stuck on it.
          cooperativeGestures: inlineRef.current,
          locale: {
            "Map.Title": t("a11y.map"),
            "CooperativeGesturesHandler.WindowsHelpText": t("map.gestures.windows"),
            "CooperativeGesturesHandler.MacHelpText": t("map.gestures.mac"),
            "CooperativeGesturesHandler.MobileHelpText": t("map.gestures.mobile"),
          },
        });
        mapRef.current = map;
        fittedRef.current = framingKeyFor(frameKeyRef.current, placesRef.current);
        // Markers are DOM positioned from the camera, so they can be drawn once the style is in;
        // "load" waits for every tile, which on a slow phone is seconds of an empty map.
        map.once("style.load", () => {
          if (cancelled) return;
          setStatus("ready");
          measure();
        });
        map.once("load", () => {
          if (!cancelled) setTilesDrawn(true);
        });
        // Redrawn on the map's own event rather than through React state: panning would
        // otherwise re-render the component once a frame to move markers React does not own.
        map.on("move", draw);
        map.on("moveend", measure);
        // Clicking the map itself, away from any pin, clears the highlight.
        map.on("click", () => selectRef.current(null));
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      abort.abort();
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      signatureRef.current = "";
      meterRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [draw, measure, attempt]);

  // A font that arrives after the stickers were measured changes their width: measure again and
  // regroup.
  useEffect(() => {
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts === undefined) return;
    const remeasure = () => {
      meterRef.current?.reset();
      signatureRef.current = "";
      draw();
    };
    fonts.addEventListener("loadingdone", remeasure);
    return () => fonts.removeEventListener("loadingdone", remeasure);
  }, [draw]);

  const retry = () => {
    setStatus("loading");
    setTilesDrawn(false);
    setAttempt((count) => count + 1);
  };

  // The page theme and the map must agree, so a theme change swaps the style in place.
  const appliedThemeRef = useRef(theme);
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== "ready" || appliedThemeRef.current === theme) return;
    appliedThemeRef.current = theme;
    const abort = new AbortController();
    void resolveStyle(theme, { styles, fallbackStyles, signal: abort.signal })
      .then(({ style }) => {
        // Markers are DOM, not style layers, so they survive the swap untouched.
        mapRef.current?.setStyle(style as unknown as MapLibreStyle);
      })
      .catch(() => {
        // Keep the tiles that are already drawn rather than blanking a working map.
      });
    return () => abort.abort();
  }, [theme, styles, fallbackStyles, status]);

  // Frame the night again when the dancer asks for another list (see frameKey); the list the map
  // was built with is already framed. The same request's list changing under it (the minute
  // refresh, a night that has ended) keeps the view: the markers are redrawn, the camera stays.
  useEffect(() => {
    const map = mapRef.current;
    const key = framingKeyFor(frameKey, places);
    if (map === null || status !== "ready" || fittedRef.current === key) return;
    fittedRef.current = key;
    fitAll(map, places, false);
    measure();
  }, [frameKey, places, status, measure]);

  // A selected pin is kept where it can be seen (see keepInView), when it is selected and not
  // again: the places are read through the ref, so the minute refresh, which hands the map a new
  // array of the same pins, does not ease a pin the dancer has panned away from back into view
  // (review, 2026-09-28).
  useEffect(() => {
    const map = mapRef.current;
    if (map === null || status !== "ready" || selectedId === null) return;
    keepInView(
      map,
      placesRef.current.find((candidate) => candidate.id === selectedId),
    );
  }, [selectedId, status]);

  // Redraw when the list changes or the highlight moves; the map's own "move" covers panning.
  useEffect(() => {
    if (status !== "ready") return;
    draw();
  }, [draw, status, places, selectedId]);

  // The split pane appears and disappears at 1024px, the phone rotates, and on a phone the map
  // makes room for the selected card below it. The map keeps its top edge where it was when it
  // grows or shrinks (MapLibre alone keeps the centre), so the pins do not jump when the card
  // comes and goes; the card then covers nothing, and the selected pin is eased into view when
  // the room it left is too small.
  const heightRef = useRef(0);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const observer = new ResizeObserver(() => {
      const map = mapRef.current;
      const before = heightRef.current;
      const after = container.clientHeight;
      heightRef.current = after;
      if (map === null) return;
      map.resize();
      if (before > 0 && after !== before) {
        map.panBy([0, (after - before) / 2], { duration: 0 });
        // Drawn now rather than on the next frame, so a resized canvas is never shown blank.
        map.redraw();
      }
      const selected = selectedRef.current;
      if (selected !== null) {
        keepInView(
          map,
          placesRef.current.find((candidate) => candidate.id === selected),
        );
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const showAll = () => {
    const map = mapRef.current;
    if (map !== null) fitAll(map, placesRef.current, true);
  };

  return (
    <section aria-label={label} className="bg-halftone flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="h-full w-full" />

        {status === "failed" ? (
          <MapFailed onRetry={retry} className="absolute inset-0 z-10" />
        ) : (
          <div className="pointer-events-none absolute start-2 end-2 top-2 z-10 flex flex-col items-start gap-2">
            {tilesDrawn ? null : (
              <p
                role="status"
                className="type-secondary bg-paper text-ink chip-edge rounded-control px-2 py-1"
              >
                {t("map.loading")}
              </p>
            )}
            {places.length === 0 ? (
              <p className="type-body bg-paper text-ink chip-edge rounded-control px-3 py-2">
                {/* Only filters that hid something are named as the reason (review,
                    2026-09-28): a place we do not cover, or a quiet night, is not their doing. */}
                {unplaced > 0
                  ? t("map.unplacedOnly", { count: unplaced })
                  : hiddenByFilters
                    ? t("map.noMatch")
                    : t("map.noPlaces")}
              </p>
            ) : null}
          </div>
        )}

        {status === "ready" && !everyPinInView ? (
          <button
            type="button"
            onClick={showAll}
            className="type-button bg-paper text-ink chip-edge rounded-control absolute end-2 top-2 z-10 min-h-11 px-3"
          >
            {t("map.showAll")}
          </button>
        ) : null}
        {inline ? null : <MapCredits />}
      </div>
    </section>
  );
}
