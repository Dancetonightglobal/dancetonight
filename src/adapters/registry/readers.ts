// Lane 3's adapters: readers for pages (feeds, sitemaps, JSON-LD, CSV) (docs/WORKSTREAMS.md). Each lane keeps its adapter ids, their
// default flags and the adapters themselves in its own file, so parallel branches never edit the
// same lines. `AdapterId` (src/adapters/types.ts), `ADAPTER_DEFAULTS` (config/flags.ts) and
// `REGISTRY` (src/pipeline/ingest.ts) take them from here.
import { daybreakerAdapter } from "@/src/adapters/feeds/daybreaker";
import { jsonLdItemsAdapter } from "@/src/adapters/feeds/jsonld-items";
import { tickeriAdapter } from "@/src/adapters/feeds/tickeri";
import { mennaAdapter } from "@/src/adapters/feeds/menna";
import { viewcyAdapter } from "@/src/adapters/feeds/viewcy";
import { wixEventsAdapter } from "@/src/adapters/feeds/wix-events";
import { wwozAdapter } from "@/src/adapters/feeds/wwoz";
import { symplaAdapter } from "@/src/adapters/feeds/sympla";
import { mecRssAdapter } from "@/src/adapters/feeds/mec-rss";
import { enmipatioAdapter } from "@/src/adapters/feeds/enmipatio";
import { bailonguAdapter } from "@/src/adapters/feeds/bailongu";
import { buscadancaAdapter } from "@/src/adapters/feeds/buscadanca";
import { wwozStreetsAdapter } from "@/src/adapters/feeds/wwoz-streets";
import { swingPatrolAdapter } from "@/src/adapters/feeds/swingpatrol";
import { metroMadinaAdapter } from "@/src/adapters/feeds/metro-madina";
import { tangoArgentinAdapter } from "@/src/adapters/feeds/tango-argentin";
import { agendatradAdapter } from "@/src/adapters/feeds/agendatrad";
import { swingOutLondonAdapter } from "@/src/adapters/feeds/swingoutlondon";
import { icsLinksAdapter } from "@/src/adapters/feeds/ics-links";
import type { SourceAdapter } from "@/src/adapters/types";

/** This lane's adapter ids, for example `| "sitemap_jsonld"`. Add a new id here, not in types.ts. */
export type ReaderAdapterId =
  /** A list page's event pages, each read for its schema.org Event (D-111). */
  | "jsonld_items"
  /** Daybreaker's list of every city's nights: this metro's cards, each event page read for its place. */
  | "daybreaker"
  /** Tickeri's list pages: every event in the window from the page's own data. */
  | "tickeri"
  /** menna's SWANA calendar: the window's Party and Dance cards, each event page read. */
  | "menna"
  /** Viewcy's search and profile pages: every event in the window from the page's own data. */
  | "viewcy"
  /** Wix Events widget pages: every event in the window from the page's warmup data. */
  | "wix_events"
  /** WWOZ Livewire music calendar: one HTML page per night, each gig becomes a listing. */
  | "wwoz"
  /** WWOZ's "Takin' It to the Streets" page: each linked second-line parade page, placed at the route's start (D-556). */
  | "wwoz_streets"
  /** Sympla city list page and each event page's embedded Next.js data (D-421). */
  | "sympla"
  /** WordPress Modern Events Calendar category RSS feed: each item's mec: date, hours and location. */
  | "mec_rss"
  /** En Mi Patio PR's culture calendar: Laravel/Inertia pages with JSON in <script data-page="app">. */
  | "enmipatio"
  /** Bailongu's monthly agenda pages: Sunday socials at Passatge d'Utset 11-13, Barcelona. */
  | "bailongu"
  /** Busca Dança's city list: each weekly card, its own page read for the address (D-543). */
  | "buscadanca"
  /** Swing Patrol's class pages: each level's dated table and time, no model (D-524). */
  | "swingpatrol"
  /** Metro al Madina's events page: Midnight Metro party nights in Beirut (D-1003). */
  | "metro_madina"
  /** tango-argentin.fr's daily RSS of French tango bals: Ile-de-France items only. */
  | "tango_argentin"
  /** AgendaTrad's regional calendar: bals folk and fest-noz, each event page for its address. */
  | "agendatrad"
  /** Swing Out London's dated socials list: each night at its venue and postcode, no model (D-870). */
  | "swingoutlondon"
  /** A page linking one .ics file per event, each fetched and read as a calendar, no model (D-873). */
  | "ics_links";

/** Each id's default flag, by the rules at the top of config/flags.ts. */
export const READER_DEFAULTS: Readonly<Record<ReaderAdapterId, boolean>> = {
  // Tier A: the organiser's own pages, read as published, under robots.txt.
  jsonld_items: true,
  daybreaker: true,
  tickeri: true,
  menna: true,
  viewcy: true,
  wix_events: true,
  wwoz: true,
  wwoz_streets: true,
  sympla: true,
  mec_rss: true,
  enmipatio: true,
  bailongu: true,
  buscadanca: true,
  swingpatrol: true,
  metro_madina: true,
  tango_argentin: true,
  agendatrad: true,
  swingoutlondon: true,
  ics_links: true,
};

export const READER_ADAPTERS: readonly SourceAdapter[] = [
  jsonLdItemsAdapter,
  daybreakerAdapter,
  tickeriAdapter,
  mennaAdapter,
  viewcyAdapter,
  wixEventsAdapter,
  wwozAdapter,
  wwozStreetsAdapter,
  symplaAdapter,
  mecRssAdapter,
  enmipatioAdapter,
  bailonguAdapter,
  buscadancaAdapter,
  swingPatrolAdapter,
  metroMadinaAdapter,
  tangoArgentinAdapter,
  agendatradAdapter,
  swingOutLondonAdapter,
  icsLinksAdapter,
];
