// What the rest of the app imports. The pure modules (`types`, `pins`, `labels`, `tile-style`) can
// also be imported directly from a server component; nothing here pulls MapLibre into a bundle,
// because the canvas is only ever reached through MapPanel's lazy import.

export { MapSplit, type MapSplitProps } from "@/src/ui/map/MapSplit";
export { MapPanel, preloadMapCanvas } from "@/src/ui/map/MapPanel";
export { MapCard } from "@/src/ui/map/MapCard";
export { MapStrip, type MapStripProps } from "@/src/ui/map/MapStrip";
export { ListMapToggle, TOGGLE_HEIGHT_PX, ViewLink } from "@/src/ui/map/ListMapToggle";
export { MapSelectionProvider, useMapSelection } from "@/src/ui/map/selection";
export { SPLIT_QUERY, useMapTheme, useMediaQuery } from "@/src/ui/map/browser";
export {
  FALLBACK_STYLE_FILES,
  OPENFREEMAP_STYLES,
  fallbackTileStyles,
  resolveMapTheme,
  resolveStyle,
  tileStyleUrl,
} from "@/src/ui/map/tile-style";
export {
  CLEARANCE_PX,
  CLUSTER_ZOOM_CAP,
  FAN_STEP_PX,
  FIT_PADDING_PX,
  MAX_FIT_ZOOM,
  SAME_SPOT_DEGREES,
  TARGET_PX,
  allAtOneSpot,
  boundsOf,
  centerOf,
  estimatedClusterWidth,
  fanOffsets,
  groupPins,
  sameSpot,
  type GroupOptions,
  type PinGroup,
  type ProjectedPlace,
} from "@/src/ui/map/pins";
export {
  CLUSTER_TEXT_MAX_CHARS,
  clusterName,
  clusterText,
  numberParts,
  pinName,
} from "@/src/ui/map/labels";
export {
  toMapPlaces,
  type LatLng,
  type MapBounds,
  type MapCanvasProps,
  type MapPlace,
  type MapSelection,
  type MapTheme,
  type MapView,
  type SelectionSource,
  type TileStyles,
} from "@/src/ui/map/types";
