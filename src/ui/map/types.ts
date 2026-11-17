// The line between the map and everything else (DESIGN.md section 5, D-013).
//
// Nothing in this file imports MapLibre, React or the repository, so the home screen can drive
// the map -- hand it places, read the selection, print a pin number in the rail -- without
// pulling a mapping library into its bundle. `MapCanvas` is the only module that knows what a
// MapLibre `Map` is, and it is reached through a lazy import.

import { isPlaced, type Listing } from "@/src/domain/listing";
import { formatTime } from "@/src/domain/time";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * One place as the map draws it. The pin prints the start time ("7pm", "10:30pm") and no family
 * colour: the colour belongs to the highlighted card, which is where the family name is
 * (DESIGN.md section 11, "colour never the sole carrier"). The number is still the place's list
 * position, kept for ordering and accessible names.
 */
export interface MapPlace {
  /** The listing id. The same id the card carries, so selection needs no second key. */
  id: string;
  /** 1-based position in the current list order: start time, or distance under distance sort. */
  number: number;
  /** The listing title, for the pin's title attribute and the marker's accessible name. */
  title: string;
  /** The start time the pin prints, "7pm" or "10:30pm" in the listing's zone; null when the time is not listed. */
  time: string | null;
  /** The venue name, so a pin's tooltip says where rather than only what. */
  venueName: string;
  location: LatLng;
}

/** A rectangle in degrees. Metro-sized, so no antimeridian wrapping is attempted. */
export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Which print run the page is showing. The map's tiles follow it, so the two agree. */
export type MapTheme = "light" | "dark";

/** A style URL per theme. Two styles, because a light map under a navy page would shout. */
export interface TileStyles {
  light: string;
  dark: string;
}

/** Phone only: the list and the map are the same screen, one at a time. */
export type MapView = "list" | "map";

/**
 * Where a selection came from. A pick on the map scrolls its card into view; a card that is
 * hovered or focused only lights its pin, because moving the list under the pointer would fight
 * the visitor (D-068).
 */
export type SelectionSource = "map" | "card";

/**
 * What a card needs from the map, and all it needs. A card calls `select` on hover and focus and
 * reads `selectedId` and `numberOf` to render itself; it never learns that MapLibre exists.
 */
export interface MapSelection {
  /** The highlighted listing, or null. */
  selectedId: string | null;
  /** Where the current selection came from, or null when nothing is selected. */
  selectedFrom: SelectionSource | null;
  /**
   * Highlight a listing (or clear with null). Selecting a card brings its pin into view; picking a
   * pin scrolls its card into view once the list is on screen.
   */
  select: (id: string | null, from?: SelectionSource) => void;
  /** The pin number for a listing, or null when it has no pin in the current list. */
  numberOf: (id: string) => number | null;
  /**
   * Whether a map is on screen. The rail prints its pin number only when it is, because on a
   * phone list with no map a number would be a label for nothing (DESIGN.md section 5).
   */
  mapOnScreen: boolean;
  /** Whether the list is on screen: always in the split view, and in the phone's list view. */
  listOnScreen: boolean;
  /** Phone only: which of the two the visitor is looking at. */
  view: MapView;
  setView: (view: MapView) => void;
}

/** Everything the map canvas is given. Plain data, so it can be built on the server. */
export interface MapCanvasProps {
  places: readonly MapPlace[];
  selectedId: string | null;
  onSelect: (id: string | null, from?: SelectionSource) => void;
  theme: MapTheme;
  /** The primary styles, one per theme (OpenFreeMap). */
  styles: TileStyles;
  /** The same-shape fallback (a Protomaps extract, D-013), or null when none is configured. */
  fallbackStyles: TileStyles | null;
  /** The map's accessible name, from `a11y.mapWithCount`. */
  label: string;
  /** Where to open when there is nothing to fit to; normally the search centre. */
  center?: LatLng;
  /**
   * Whether the night has places within reach that the filters hide, so an empty map can say the
   * filters are why. False (the default) when there is simply nothing to show.
   */
  hiddenByFilters?: boolean;
  /**
   * How many of the list's places have no location, so no pin (D-082). A map with no pins and some
   * such places says they are in the list, rather than that there is nothing to show.
   */
  unplaced?: number;
  /**
   * What the dancer asked for: the night and the page's query without `view`. The map frames every
   * pin again when this changes (another day, a filter, the sort), and keeps the dancer's view when
   * only the list changes under the same request: tonight's page is rendered again each minute,
   * and a night that has ended leaves the list then, which used to snap a panned map back
   * (2026-09-28). Without it the map frames again whenever the pins change.
   */
  frameKey?: string;
  /**
   * The detail page's one-venue map: a canvas filling the 176px frame DetailMap draws, with the
   * frame's hairline and the attribution below it drawn there rather than here, one finger
   * scrolling the page rather than the map, and a pin that is a picture rather than a control,
   * because there is nothing to choose between (DESIGN.md section 7, D-068).
   */
  inline?: boolean;
}

/**
 * The listings the current list is showing, numbered in the order they are shown. The number is
 * the card's position, so the map and the list can be read against each other without colour.
 * Listings are taken in order; nothing is sorted here, because the list order is the truth.
 */
export function toMapPlaces(listings: readonly Listing[]): MapPlace[] {
  return listings.filter(isPlaced).map((listing, index) => ({
    id: listing.id,
    number: index + 1,
    title: listing.title,
    time: listing.startsAt === null ? null : formatTime(listing.startsAt, listing.tz),
    venueName: listing.venue.name,
    location: { lat: listing.venue.location.lat, lng: listing.venue.location.lng },
  }));
}
