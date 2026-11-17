// The map's arithmetic, kept away from MapLibre so it can be tested without a browser
// (DESIGN.md section 5; D-013, D-068). Everything here is a pure function of its arguments.

import type { LatLng, MapBounds, MapPlace } from "@/src/ui/map/types";

/**
 * A marker's tap target, in screen pixels: 44 by 44 for a pin, and 44 tall for a cluster, which is
 * as wide as its sticker when the numbers it prints need more (DESIGN.md section 5).
 */
export const TARGET_PX = 44;

/**
 * Space kept between two targets. MapLibre draws each marker at a whole pixel, so two targets
 * exactly a target apart can be drawn a pixel into each other; one pixel of room prevents it.
 */
export const CLEARANCE_PX = 1;

/** Never fit closer than this, so a single pin does not land the map on one building. */
export const MAX_FIT_ZOOM = 15;

/**
 * A cluster tap zooms no closer than this. At it (or when the members share one spot, which no
 * zoom separates) the tap selects the cluster's first place instead (D-068).
 */
export const CLUSTER_ZOOM_CAP = MAX_FIT_ZOOM + 2;

/** Clear space kept around the fitted pins, in pixels. */
export const FIT_PADDING_PX = 48;

/**
 * Two places closer than this in both latitude and longitude are one spot: two nights at one
 * studio, or two rooms of one building. About 11m north to south, so no zoom separates them.
 */
export const SAME_SPOT_DEGREES = 1e-4;

/**
 * How far apart, in pixels, the pins of one spot are laid out once one of them is selected: the
 * 44px target, so each pin has its own and none covers another.
 */
export const FAN_STEP_PX = 44;

/**
 * The most pins the selected pin's row holds when the map's width is not known: 7 × 44px = 308px
 * fits a 320px phone. MapCanvas passes `maxRowPins` for the pane it draws in (rowPinsFor). The row
 * holds only places at the same spot as the selected pin (two nights at one studio), never places
 * merely near it, because a pin moved off its venue is a false fact (owner's screenshots
 * 2026-10-17: a row of all 78 pins from New Jersey to Fire Island).
 */
export const MAX_FAN_PINS = 7;

/** How many row pins fit across a map `widthPx` wide, inside a `marginPx` edge: never below 3. */
export function rowPinsFor(widthPx: number, marginPx: number): number {
  return Math.max(3, Math.floor((widthPx - 2 * marginPx) / FAN_STEP_PX));
}

/**
 * The rectangle that holds every place, or null when there are none. Metro-sized boxes only:
 * a night's listings never straddle the antimeridian, so no wrapping is attempted and a pair
 * that did would simply fit wide rather than silently fit wrong.
 */
export function boundsOf(places: readonly MapPlace[]): MapBounds | null {
  const first = places[0];
  if (first === undefined) return null;
  let { lat: south, lng: west } = first.location;
  let north = south;
  let east = west;
  for (const place of places) {
    const { lat, lng } = place.location;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  }
  return { south, west, north, east };
}

/** The centre of a box, for the opening view when there is nothing to fit to. */
export function centerOf(bounds: MapBounds): LatLng {
  return { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
}

/** Whether two points are one spot on the map (see SAME_SPOT_DEGREES). */
export function sameSpot(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < SAME_SPOT_DEGREES && Math.abs(a.lng - b.lng) < SAME_SPOT_DEGREES;
}

/** Whether every place is at the first one's spot, so zooming in could never pull them apart. */
export function allAtOneSpot(places: readonly MapPlace[]): boolean {
  const first = places[0];
  if (first === undefined) return false;
  return places.every((place) => sameSpot(place.location, first.location));
}

/** A place with its position on screen, as MapLibre's `project` reports it. */
export interface ProjectedPlace {
  place: MapPlace;
  x: number;
  y: number;
}

/**
 * One thing drawn on the map: a single numbered pin, or a cluster carrying its members' numbers.
 * `offset` is the pin's shift in pixels from its point: zero, except for the pins of a spot that
 * has been opened by selecting one of them, which are laid out side by side. `inRow` is true for
 * every pin in that row, including the selected place and any middle pin whose offset is zero.
 */
export type PinGroup =
  | { kind: "pin"; place: MapPlace; center: LatLng; offset: [number, number]; inRow: boolean }
  | { kind: "cluster"; places: MapPlace[]; center: LatLng; count: number; oneSpot: boolean };

const NO_OFFSET: [number, number] = [0, 0];

/**
 * The offsets of `count` pins laid out in a row centred on their shared point, `step` pixels apart:
 * one pin stays put, two sit step/2 either side, three at -step, 0 and step.
 */
export function fanOffsets(count: number, step: number = FAN_STEP_PX): [number, number][] {
  const out: [number, number][] = [];
  for (let index = 0; index < count; index += 1) {
    out.push([(index - (count - 1) / 2) * step, 0]);
  }
  return out;
}

/**
 * How wide a pin's target is drawn when it cannot be measured: its printed time at a
 * generous 8px a character plus the sticker's 16px of padding and edge, and never narrower than
 * TARGET_PX. MapCanvas measures the real width in the page's own type; this is for callers with
 * no page, such as the unit tests.
 */
export function estimatedPinWidth(place: MapPlace): number {
  return Math.max(TARGET_PX, 16 + 8 * [...(place.time ?? "")].length);
}

/**
 * How wide a cluster's target is drawn when it cannot be measured: its printed count at a
 * generous 8px a character plus the sticker's 16px of padding and edge, and never narrower than
 * a pin. MapCanvas measures the real width in the page's own type; this is for callers with no
 * page, such as the unit tests.
 */
export function estimatedClusterWidth(places: readonly MapPlace[]): number {
  return Math.max(TARGET_PX, 16 + 8 * String(places.length).length);
}

/** A drawn target: its centre on screen and half its width (every target is TARGET_PX tall). */
interface TargetBox {
  x: number;
  y: number;
  halfWidth: number;
}

/** Whether two targets would overlap, or come within CLEARANCE_PX of each other. */
function crowds(a: TargetBox, b: TargetBox, height: number): boolean {
  return (
    Math.abs(a.x - b.x) < a.halfWidth + b.halfWidth + CLEARANCE_PX &&
    Math.abs(a.y - b.y) < height + CLEARANCE_PX
  );
}

/** Places gathered under one marker, drawn at the first of them (its lowest number). */
interface Gathering {
  anchor: ProjectedPlace;
  members: ProjectedPlace[];
  box: TargetBox;
}

export interface GroupOptions {
  /** A pin's target, square, in pixels; TARGET_PX by default. Zero clusters nothing. */
  targetPx?: number;
  selectedId?: string | null;
  /** The most pins the selected pin's row may hold; MAX_FAN_PINS by default. */
  maxRowPins?: number;
  /** How wide a pin is drawn, target included; an estimate by default. */
  pinWidth?: (place: MapPlace) => number;
  /** How wide a cluster of these places is drawn, target included; an estimate by default. */
  clusterWidth?: (places: readonly MapPlace[]) => number;
}

/**
 * Group pins whose targets would overlap into clusters, so every marker on the map can be tapped
 * (D-068; the owner: "you can't click on the buttons in the map"). Two markers crowd each other
 * when the targets they are drawn with would overlap, and a cluster is drawn as wide as the
 * numbers it prints: grouping by the distance between points let a neighbour sit on the end of a
 * wide sticker (review, 2026-09-28). Places are taken in list order; each joins the first
 * gathering whose drawn target its own would overlap, or starts its own, and a gathering that
 * widens as it grows takes in any it now overlaps. No two markers are left overlapping; and
 * panning moves every point together, so the groups do not change while the map is dragged.
 *
 * The selected place is never clustered away. Selecting a card must always show its pin, which
 * is the whole point of the numbering (DESIGN.md section 5). It stays at its own point and is drawn
 * above other markers (MapCanvas), which may sit partly under it. Places at its very spot are laid
 * out in a row beside it, FAN_STEP_PX apart, at most `maxRowPins`, so each night at one studio has
 * its own target. Places merely near it stay at their own points, because a pin moved off its venue
 * is a false fact (owner's screenshots 2026-10-17: a row of all 78 pins from New Jersey to Fire
 * Island). Past the cap, same-spot places stay in a cluster.
 *
 * Groups come back in list order (a group takes the position of its lowest-numbered member), so
 * the DOM order of the markers matches the list.
 */
export function groupPins(
  projected: readonly ProjectedPlace[],
  options: GroupOptions = {},
): PinGroup[] {
  const target = options.targetPx ?? TARGET_PX;
  const selectedId = options.selectedId ?? null;
  const maxRow = options.maxRowPins ?? MAX_FAN_PINS;
  const pinWidthOf = options.pinWidth ?? estimatedPinWidth;
  const clusterWidthOf = options.clusterWidth ?? estimatedClusterWidth;
  const clusters = target > 0;
  const pinBox = (entry: ProjectedPlace): TargetBox => ({
    x: entry.x,
    y: entry.y,
    halfWidth: target > 0 ? Math.max(target, pinWidthOf(entry.place)) / 2 : 0,
  });
  const byNumberOf = (a: ProjectedPlace, b: ProjectedPlace) => a.place.number - b.place.number;

  const selected = projected.find((entry) => entry.place.id === selectedId);
  // Build the initial open set: the selected place, then places at the same spot, capped at maxRow.
  const openCandidates: ProjectedPlace[] = [];
  if (selected !== undefined) {
    // 1. The selected place itself.
    openCandidates.push(selected);
    // 2. Places at the same spot, by list number.
    const sameSpotEntries = projected
      .filter(
        (entry) => entry !== selected && sameSpot(entry.place.location, selected.place.location),
      )
      .sort(byNumberOf);
    // Add same-spot places until we reach maxRow total (including selected)
    for (const entry of sameSpotEntries) {
      if (openCandidates.length >= maxRow) break;
      openCandidates.push(entry);
    }
  }
  const open = new Set<ProjectedPlace>(openCandidates);

  const row = [...open].sort(byNumberOf);
  const gatherings = gather(
    projected.filter((entry) => !open.has(entry)).sort(byNumberOf),
    clusters,
    target,
    pinBox,
    clusterWidthOf,
  );

  const groups: PinGroup[] = [];
  // Compute step for the row: the widest pin's width plus clearance, but not less than FAN_STEP_PX.
  const rowStep =
    row.length > 1
      ? Math.max(FAN_STEP_PX, ...row.map((e) => pinWidthOf(e.place))) + CLEARANCE_PX
      : FAN_STEP_PX;
  const offsets = fanOffsets(row.length, rowStep);
  row.forEach((entry, index) => {
    groups.push({
      kind: "pin",
      place: entry.place,
      // One point for the whole row, so the pins line up rather than wobble by a metre.
      center: selected?.place.location ?? entry.place.location,
      offset: offsets[index] ?? NO_OFFSET,
      inRow: true,
    });
  });
  for (const { anchor, members } of gatherings) {
    if (members.length === 1) {
      groups.push({
        kind: "pin",
        place: anchor.place,
        center: anchor.place.location,
        offset: NO_OFFSET,
        inRow: false,
      });
    } else {
      const places = members.map((member) => member.place);
      groups.push({
        kind: "cluster",
        places,
        center: anchor.place.location,
        count: places.length,
        oneSpot: allAtOneSpot(places),
      });
    }
  }

  return groups.sort((a, b) => lowestNumber(a) - lowestNumber(b));
}

/** The places left once the row is laid out, gathered so no two targets overlap (groupPins). */
function gather(
  rest: readonly ProjectedPlace[],
  clusters: boolean,
  height: number,
  pinBox: (entry: ProjectedPlace) => TargetBox,
  widthOf: (places: readonly MapPlace[]) => number,
): Gathering[] {
  const gatherings: Gathering[] = [];
  const boxOf = (gathering: Omit<Gathering, "box">): TargetBox =>
    gathering.members.length === 1
      ? pinBox(gathering.anchor)
      : {
          x: gathering.anchor.x,
          y: gathering.anchor.y,
          halfWidth: widthOf(gathering.members.map((member) => member.place)) / 2,
        };

  for (const entry of rest) {
    const own = pinBox(entry);
    let index = clusters ? gatherings.findIndex((g) => crowds(g.box, own, height)) : -1;
    if (index < 0) {
      gatherings.push({ anchor: entry, members: [entry], box: own });
      continue;
    }
    const home = gatherings[index];
    if (home === undefined) continue;
    home.members.push(entry);
    home.box = boxOf(home);
    // A wider sticker can reach a neighbour: the two become one, drawn at the earlier (lower
    // numbered) of them, which may be wider still.
    for (;;) {
      const grown = gatherings[index];
      if (grown === undefined) break;
      const other = gatherings.findIndex((g, k) => k !== index && crowds(g.box, grown.box, height));
      if (other < 0) break;
      const [keep, drop] = other < index ? [other, index] : [index, other];
      const kept = gatherings[keep];
      const dropped = gatherings[drop];
      if (kept === undefined || dropped === undefined) break;
      kept.members.push(...dropped.members);
      kept.members.sort((a, b) => a.place.number - b.place.number);
      kept.box = boxOf(kept);
      gatherings.splice(drop, 1);
      index = keep;
    }
  }
  return gatherings;
}

function lowestNumber(group: PinGroup): number {
  if (group.kind === "pin") return group.place.number;
  return group.places.reduce((low, place) => Math.min(low, place.number), Infinity);
}

/**
 * The key the map is framed on: the dancer's request when given (MapCanvasProps.frameKey), else
 * the pins themselves, ids and points. The map frames every pin again only when this changes, so
 * a new array of the same pins (the minute refresh) never moves it, and neither does a night that
 * has ended leaving the list under the same request.
 */
export function framingKeyFor(frameKey: string | undefined, places: readonly MapPlace[]): string {
  if (frameKey !== undefined) return `ask:${frameKey}`;
  return `pins:${places.map((place) => `${place.id}@${place.location.lat},${place.location.lng}`).join("|")}`;
}
