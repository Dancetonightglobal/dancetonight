// Where a metro ends, where a circle is not enough (D-084). New York is the five boroughs: the
// 40 km circle around lower Manhattan also takes in Newark, Jersey City, Yonkers and Nassau
// County, which the owner left out on 2026-09-30. The outlines are NYC Planning's borough
// boundaries with their water areas (so a pier, a boat or an island venue is inside), as
// `config/metro-bounds/nyc.json` records.
import dubaiBounds from "@/config/metro-bounds/dubai.json";
import puneBounds from "@/config/metro-bounds/pune.json";
import tulumBounds from "@/config/metro-bounds/tulum.json";
import beirutBounds from "@/config/metro-bounds/beirut.json";
import tokyoBounds from "@/config/metro-bounds/tokyo.json";
import marrakeshBounds from "@/config/metro-bounds/marrakesh.json";
import istanbulBounds from "@/config/metro-bounds/istanbul.json";
import berlinBounds from "@/config/metro-bounds/berlin.json";
import parisBounds from "@/config/metro-bounds/paris.json";
import nashvilleBounds from "@/config/metro-bounds/nashville.json";
import lisbonBounds from "@/config/metro-bounds/lisbon.json";
import barcelonaBounds from "@/config/metro-bounds/barcelona.json";
import londonBounds from "@/config/metro-bounds/london.json";
import miamiBounds from "@/config/metro-bounds/miami.json";
import raleighBounds from "@/config/metro-bounds/raleigh.json";
import losAngelesBounds from "@/config/metro-bounds/los-angeles.json";
import austinBounds from "@/config/metro-bounds/austin.json";
import mexicoCityBounds from "@/config/metro-bounds/mexico-city.json";
import hongKongBounds from "@/config/metro-bounds/hong-kong.json";
import newOrleansBounds from "@/config/metro-bounds/new-orleans.json";
import nycBounds from "@/config/metro-bounds/nyc.json";
import philadelphiaBounds from "@/config/metro-bounds/philadelphia.json";
import buenosAiresBounds from "@/config/metro-bounds/buenos-aires.json";
import rioDeJaneiroBounds from "@/config/metro-bounds/rio-de-janeiro.json";
import sanJuanBounds from "@/config/metro-bounds/san-juan.json";
import mumbaiBounds from "@/config/metro-bounds/mumbai.json";
import delhiBounds from "@/config/metro-bounds/delhi.json";
import medellinBounds from "@/config/metro-bounds/medellin.json";
import type { Point } from "@/src/domain/listing";

type Ring = ReadonlyArray<readonly [number, number]>;
interface Bounds {
  boroughs: ReadonlyArray<{ name: string; polygons: ReadonlyArray<ReadonlyArray<Ring>> }>;
}

/** Each metro's outline, by slug. A metro missing here is its circle (`metro.radiusKm`). */
export const METRO_BOUNDS: Readonly<Record<string, Bounds>> = {
  nyc: nycBounds as unknown as Bounds,
  // Greater London: the 33 districts (32 boroughs and the City), ONS outlines with the Thames (D-200).
  london: londonBounds as unknown as Bounds,
  // The City of Philadelphia (= Philadelphia County, Census outline with its water to the state line) plus
  // the near suburbs (D-511): Delaware County and the Montgomery County townships/boroughs Lower Merion, Narberth,
  // Cheltenham, Abington, Jenkintown, Rockledge; Camden NJ is not inside.
  philadelphia: philadelphiaBounds as unknown as Bounds,
  // Orleans Parish (= the City of New Orleans; D-340) and Jefferson Parish (D-555): Census TIGER outlines with their water areas.
  "new-orleans": newOrleansBounds as unknown as Bounds,
  // Miami-Dade County: Census TIGER outline with its water areas, Biscayne Bay and the barrier islands (D-320).
  miami: miamiBounds as unknown as Bounds,
  // Wake County (Raleigh, Cary, Apex, Wake Forest) and Durham County (D-601): Census TIGER outlines with their water
  // areas (D-600).
  raleigh: raleighBounds as unknown as Bounds,
  // Los Angeles County: Census TIGER outline with its water areas and Santa Catalina Island (D-1160).
  "los-angeles": losAngelesBounds as unknown as Bounds,
  // The Lisbon Metropolitan Area (18 municipalities): DGT CAOP2025, CC BY 4.0, the river between Lisbon
  // and Almada inside (D-380).
  lisbon: lisbonBounds as unknown as Bounds,
  // The Barcelonès: ICGC municipal outlines of its five municipalities, land only (D-360).
  barcelona: barcelonaBounds as unknown as Bounds,
  // Ciudad Autónoma de Buenos Aires: the 48 official barrios with Puerto Madero's docks and a Río de la Plata strip (D-400).
  "buenos-aires": buenosAiresBounds as unknown as Bounds,
  // Ciudad de México: the 16 alcaldías outline (D-440).
  "mexico-city": mexicoCityBounds as unknown as Bounds,
  // Hong Kong SAR: the Home Affairs Department's 18 district outlines with their sea areas (data.gov.hk);
  // Shenzhen and Macau are outside (D-660).
  "hong-kong": hongKongBounds as unknown as Bounds,
  // The municipalities of Rio de Janeiro and Niterói: IBGE 2024 outlines plus 250 m of water, so piers,
  // marinas and Guanabara Bay's islands are inside; Sao Goncalo and Duque de Caxias are not (D-420).
  "rio-de-janeiro": rioDeJaneiroBounds as unknown as Bounds,
  // The five municipios of San Juan, Carolina, Guaynabo, Bayamón and Cataño (D-460).
  "san-juan": sanJuanBounds as unknown as Bounds,
  // Greater Mumbai (Mumbai City and Mumbai Suburban districts): Who's On First / Mesoshapes, widened ~300 m
  // seaward so the shore and piers are inside; Thane and Navi Mumbai are not (D-620).
  mumbai: mumbaiBounds as unknown as Bounds,
  // NCT Delhi, Gurugram district and Gautam Buddh Nagar (Noida): Who's On First (D-1140). Ghaziabad and Faridabad are not.
  delhi: delhiBounds as unknown as Bounds,
  // The 10 municipalities of the Área Metropolitana del Valle de Aburrá, DANE MGN 2025 (D-640).
  medellin: medellinBounds as unknown as Bounds,
  // Istanbul province, all 39 districts: Who's On First's region (Quattroshapes, CC BY) with the Adalar
  // district (Princes' Islands) added; the Bosphorus and the Golden Horn are inside (D-680).
  istanbul: istanbulBounds as unknown as Bounds,
  // The Emirate of Dubai with the Hatta exclave: Who's On First's region (CC BY); Palm Jumeirah, The World and
  // Bluewaters inside; Sharjah and Abu Dhabi outside (D-1060).
  dubai: dubaiBounds as unknown as Bounds,
  // Pune: the Pune Municipal Corporation with its two cantonments, Pimpri-Chinchwad and Hinjewadi, from Who's On
  // First's own locality outlines (CC BY), widened ~300 m (D-1120).
  pune: puneBounds as unknown as Bounds,
  tulum: tulumBounds as unknown as Bounds,
  berlin: berlinBounds as unknown as Bounds,
  // Beirut Governorate plus the coastal Metn and Baabda cadastres, a 600 m seaward strip inside (HDX COD-AB, CC BY-IGO; D-1000).
  beirut: beirutBounds as unknown as Bounds,
  // The Prefecture of Marrakech (HDX COD-AB Morocco admin2, CC BY-IGO; D-1100).
  marrakesh: marrakeshBounds as unknown as Bounds,
  paris: parisBounds as unknown as Bounds,
  // Davidson County, Tennessee (Metro Nashville): the Census TIGER county outline with its water (D-1200).
  nashville: nashvilleBounds as unknown as Bounds,
  // Mainland Tokyo Metropolis (23 wards + Tama), islands left out, a 600 m seaward strip (HDX COD-AB, CC BY-IGO; D-1221).
  tokyo: tokyoBounds as unknown as Bounds,
  // Travis County (Census TIGER, with its lakes) plus the City of Austin's Williamson and Hays County parts (D-1180).
  austin: austinBounds as unknown as Bounds,
};

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

/**
 * The part of the metro a point is in ("Brooklyn"), or null when it is outside every part.
 * Undefined for a metro with no outline: its circle decides.
 */
export function metroPartAt(slug: string, point: Point): string | null | undefined {
  const bounds = METRO_BOUNDS[slug];
  if (!bounds) return undefined;
  // NYC Planning's, the ONS and the Census outlines have no holes: each polygon is one outer ring.
  for (const borough of bounds.boroughs) {
    for (const [outer] of borough.polygons) {
      if (outer && inRing(point.lng, point.lat, outer)) return borough.name;
    }
  }
  return null;
}

/**
 * Whether a point is in the metro: inside its outline when it has one, else within its circle.
 * Every reader, discovery step and write path uses this, never a second copy (docs/WORKSTREAMS.md).
 */
export function insideMetro(
  metro: { slug: string; center: Point; radiusKm: number },
  point: Point,
): boolean {
  const part = metroPartAt(metro.slug, point);
  if (part !== undefined) return part !== null;
  return haversine(metro.center, point) <= metro.radiusKm;
}

function haversine(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
