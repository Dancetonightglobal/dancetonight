// Neighbourhood outlines from Who's On First (CC-BY 4.0; New York's geometries mostly from
// Pediacities, ODC-By; London's from Mapzen and Quattroshapes, D-200; New Orleans' from the City of
// New Orleans GIS, nolagis, D-340; Philadelphia's mostly Azavea, D-300; Miami's from Zetashapes and
// Quattroshapes, with WOF localities as the fallback, D-320; Buenos Aires' the City of Buenos Aires'
// official barrios, D-400; Barcelona's the Ajuntament's 73 barris, D-360; Mexico City's IECM 2019
// colonias (CC BY 4.0) over its 16 alcaldías (Quattroshapes), D-440; Rio de Janeiro's the city's 167
// official bairros, Instituto Pereira Passos, CC BY 4.0, none yet for Niterói, D-420; Lisbon's DGT's official parishes and towns,
// D-380; Raleigh's from Zetashapes with Wake County's towns as the fallback, D-600; Istanbul's Who's On First mahalle over its 39 districts, D-680; Berlin's Geoportal Berlin 97 Ortsteile over its 12 Bezirke, dl-de/zero-2.0, D-1020; Beirut's from HDX COD-AB cadastral areas, D-1000; Tokyo's wards and Tama municipalities from HDX COD-AB, D-1221), Paris's Who's On First quartiers over its arrondissements and the Grand Paris communes (IGN), D-1040; D-176; the smallest outline holding the point wins; null
// outside them.
import beirutNeighbourhoods from "@/config/neighbourhoods/beirut.json";
import tulumNeighbourhoods from "@/config/neighbourhoods/tulum.json";
import tokyoNeighbourhoods from "@/config/neighbourhoods/tokyo.json";
import istanbulNeighbourhoods from "@/config/neighbourhoods/istanbul.json";
import berlinNeighbourhoods from "@/config/neighbourhoods/berlin.json";
import parisNeighbourhoods from "@/config/neighbourhoods/paris.json";
import nashvilleNeighbourhoods from "@/config/neighbourhoods/nashville.json";
import lisbonNeighbourhoods from "@/config/neighbourhoods/lisbon.json";
import barcelonaNeighbourhoods from "@/config/neighbourhoods/barcelona.json";
import londonNeighbourhoods from "@/config/neighbourhoods/london.json";
import miamiNeighbourhoods from "@/config/neighbourhoods/miami.json";
import raleighNeighbourhoods from "@/config/neighbourhoods/raleigh.json";
import losAngelesNeighbourhoods from "@/config/neighbourhoods/los-angeles.json";
import austinNeighbourhoods from "@/config/neighbourhoods/austin.json";
import mexicoCityNeighbourhoods from "@/config/neighbourhoods/mexico-city.json";
import hongKongNeighbourhoods from "@/config/neighbourhoods/hong-kong.json";
import newOrleansNeighbourhoods from "@/config/neighbourhoods/new-orleans.json";
import nycNeighbourhoods from "@/config/neighbourhoods/nyc.json";
import philadelphiaNeighbourhoods from "@/config/neighbourhoods/philadelphia.json";
import buenosAiresNeighbourhoods from "@/config/neighbourhoods/buenos-aires.json";
import rioDeJaneiroNeighbourhoods from "@/config/neighbourhoods/rio-de-janeiro.json";
import sanJuanNeighbourhoods from "@/config/neighbourhoods/san-juan.json";
import mumbaiNeighbourhoods from "@/config/neighbourhoods/mumbai.json";
import delhiNeighbourhoods from "@/config/neighbourhoods/delhi.json";
import puneNeighbourhoods from "@/config/neighbourhoods/pune.json";
import medellinNeighbourhoods from "@/config/neighbourhoods/medellin.json";
import type { Point } from "@/src/domain/listing";

type Ring = ReadonlyArray<readonly [number, number]>;
export interface Neighbourhood {
  name: string;
  polygons: ReadonlyArray<ReadonlyArray<Ring>>;
}

interface PreparedPolygon {
  neighbourhood: Neighbourhood;
  outer: Ring;
  holes: Ring[];
  minLng: number;
  maxLng: number;
  minLat: number;
  maxLat: number;
  area: number;
}

interface PreparedOutlines {
  polygons: PreparedPolygon[];
}

const preparedCache = new WeakMap<ReadonlyArray<Neighbourhood>, PreparedOutlines>();

/** Every metro's neighbourhood outlines: New York's, London's, Philadelphia's, New Orleans', Miami's, Buenos Aires', Barcelona's, Mexico City's and Rio de Janeiro's, San Juan's, Raleigh's and Medellín's (they never overlap). */
export const NEIGHBOURHOODS: ReadonlyArray<Neighbourhood> = [
  ...(nycNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(londonNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(philadelphiaNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(newOrleansNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(miamiNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(barcelonaNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(buenosAiresNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(mexicoCityNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Hong Kong's 18 districts (HAD, data.gov.hk), D-660.
  ...(hongKongNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(rioDeJaneiroNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Lisbon: the City of Lisbon's 24 parishes, then the other 17 municipalities by town name (DGT CAOP2025, D-380).
  ...(lisbonNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(sanJuanNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Raleigh: WOF neighbourhoods with Wake County's towns as the fallback (D-600).
  ...(raleighNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Los Angeles: LA County's Countywide Statistical Areas (City of LA communities, cities, unincorporated), D-1160.
  ...(losAngelesNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Mumbai: 68 common neighbourhood names, each the area nearest its centre point (our own outlines, D-620).
  ...(mumbaiNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Delhi: 93 common area names in NCT Delhi, Gurugram and Noida, each the part of its district nearest its centre point
  // (our own outlines, D-1140).
  ...(delhiNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(puneNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Medellín: CNMH barrios and comunas, then the 10 municipalities (D-640).
  ...(medellinNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Istanbul: Who's On First's 726 mahalle, then the 39 districts (ilçe) as the fallback (D-680).
  ...(istanbulNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(berlinNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  ...(parisNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Beirut: HDX COD-AB's 38 cadastral areas (13 Beirut quarters, 25 Metn/Baabda towns), CC BY-IGO (D-1000).
  ...(beirutNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Tulum: the towns Tulum, Playa del Carmen and Puerto Aventuras (Who's On First), then the two municipios (D-1080).
  ...(tulumNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Nashville: WOF neighbourhoods with Davidson County's satellite cities as the fallback (D-1200).
  ...(nashvilleNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Tokyo: HDX COD-AB's 23 special wards and 30 Tama municipalities, CC BY-IGO (D-1221).
  ...(tokyoNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
  // Austin: WOF neighbourhoods with Travis County's towns as the fallback (D-1180).
  ...(austinNeighbourhoods.neighbourhoods as unknown as ReadonlyArray<Neighbourhood>),
];

/** Ray casting: whether [lng, lat] lies inside a ring. */
function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Shoelace formula for polygon area (signed). */
function ringArea(ring: Ring): number {
  let area = 0;
  const n = ring.length;
  if (n < 3) return 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % n]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

function prepareOutlines(outlines: ReadonlyArray<Neighbourhood>): PreparedOutlines {
  const polygons: PreparedPolygon[] = [];
  for (const neighbourhood of outlines) {
    for (let polygonIndex = 0; polygonIndex < neighbourhood.polygons.length; polygonIndex++) {
      const polygon = neighbourhood.polygons[polygonIndex]!;
      if (polygon.length === 0) continue;
      const outer = polygon[0]!;
      if (outer.length < 4) continue; // Need at least 4 points (closed ring)
      const holes = polygon.slice(1);

      // Compute bounding box
      let minLng = outer[0]![0];
      let maxLng = outer[0]![0];
      let minLat = outer[0]![1];
      let maxLat = outer[0]![1];
      for (const [lng, lat] of outer) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }

      const area = ringArea(outer);

      polygons.push({
        neighbourhood,
        outer,
        holes,
        minLng,
        maxLng,
        minLat,
        maxLat,
        area,
      });
    }
  }
  return { polygons };
}

function getPrepared(outlines: ReadonlyArray<Neighbourhood>): PreparedOutlines {
  let prepared = preparedCache.get(outlines);
  if (!prepared) {
    prepared = prepareOutlines(outlines);
    preparedCache.set(outlines, prepared);
  }
  return prepared;
}

function pointInBBox(lng: number, lat: number, poly: PreparedPolygon): boolean {
  return lng >= poly.minLng && lng <= poly.maxLng && lat >= poly.minLat && lat <= poly.maxLat;
}

function pointInPolygon(lng: number, lat: number, poly: PreparedPolygon): boolean {
  if (!pointInBBox(lng, lat, poly)) return false;
  if (!inRing(lng, lat, poly.outer)) return false;
  // Check holes
  for (const hole of poly.holes) {
    if (inRing(lng, lat, hole)) return false;
  }
  return true;
}

/**
 * The neighbourhood a point is in, or null when it is outside every neighbourhood.
 * Among overlapping outlines, returns the one with the smallest outer-ring area.
 */
export function neighbourhoodAt(
  point: Point,
  outlines: ReadonlyArray<Neighbourhood> = NEIGHBOURHOODS,
): string | null {
  const { lat, lng } = point;
  // Check for non-finite numbers
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  const prepared = getPrepared(outlines);
  let bestNeighbourhood: string | null = null;
  let bestArea = Infinity;

  for (const poly of prepared.polygons) {
    if (pointInPolygon(lng, lat, poly)) {
      if (poly.area < bestArea) {
        bestArea = poly.area;
        bestNeighbourhood = poly.neighbourhood.name;
      }
    }
  }

  return bestNeighbourhood;
}
