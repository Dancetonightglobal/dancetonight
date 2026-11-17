// Metros that seed a metro row and nothing else (D-200, D-300). A new metro adds one line here;
// run.ts needs no edit.

import type { NewMetro } from "@/src/db/schema/metros";
import { beirutMetroRow } from "@/src/db/seed/beirut";
import { marrakeshMetroRow } from "@/src/db/seed/marrakesh";
import { istanbulMetroRow } from "@/src/db/seed/istanbul";
import { berlinMetroRow } from "@/src/db/seed/berlin";
import { parisMetroRow } from "@/src/db/seed/paris";
import { tokyoMetroRow } from "@/src/db/seed/tokyo";
import { lisbonMetroRow } from "@/src/db/seed/lisbon";
import { barcelonaMetroRow } from "@/src/db/seed/barcelona";
import { londonMetroRow } from "@/src/db/seed/london";
import { miamiMetroRow } from "@/src/db/seed/miami";
import { mexicoCityMetroRow } from "@/src/db/seed/mexico-city";
import { philadelphiaMetroRow } from "@/src/db/seed/philadelphia";
import { newOrleansMetroRow } from "@/src/db/seed/new-orleans";
import { buenosAiresMetroRow } from "@/src/db/seed/buenos-aires";
import { rioDeJaneiroMetroRow } from "@/src/db/seed/rio-de-janeiro";
import { sanJuanMetroRow } from "@/src/db/seed/san-juan";
import { raleighMetroRow } from "@/src/db/seed/raleigh";
import { losAngelesMetroRow } from "@/src/db/seed/los-angeles";
import { austinMetroRow } from "@/src/db/seed/austin";
import { mumbaiMetroRow } from "@/src/db/seed/mumbai";
import { delhiMetroRow } from "@/src/db/seed/delhi";
import { hongKongMetroRow } from "@/src/db/seed/hong-kong";
import { medellinMetroRow } from "@/src/db/seed/medellin";
import { dubaiMetroRow } from "@/src/db/seed/dubai";
import { nashvilleMetroRow } from "@/src/db/seed/nashville";
import { puneMetroRow } from "@/src/db/seed/pune";
import { tulumMetroRow } from "@/src/db/seed/tulum";

export const ROW_ONLY_METROS: Readonly<Record<string, () => NewMetro & { id: string }>> = {
  london: londonMetroRow,
  philadelphia: philadelphiaMetroRow,
  miami: miamiMetroRow,
  "mexico-city": mexicoCityMetroRow,
  "new-orleans": newOrleansMetroRow,
  lisbon: lisbonMetroRow,
  barcelona: barcelonaMetroRow,
  "buenos-aires": buenosAiresMetroRow,
  "rio-de-janeiro": rioDeJaneiroMetroRow,
  "san-juan": sanJuanMetroRow,
  raleigh: raleighMetroRow,
  "los-angeles": losAngelesMetroRow,
  mumbai: mumbaiMetroRow,
  delhi: delhiMetroRow,
  "hong-kong": hongKongMetroRow,
  medellin: medellinMetroRow,
  istanbul: istanbulMetroRow,
  dubai: dubaiMetroRow,
  pune: puneMetroRow,
  tulum: tulumMetroRow,
  berlin: berlinMetroRow,
  beirut: beirutMetroRow,
  marrakesh: marrakeshMetroRow,
  paris: parisMetroRow,
  nashville: nashvilleMetroRow,
  tokyo: tokyoMetroRow,
  austin: austinMetroRow,
};
