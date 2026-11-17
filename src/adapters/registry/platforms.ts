// Lane 5's adapters: platforms (ticketing and calendar APIs) (docs/WORKSTREAMS.md). Each lane keeps its adapter ids, their
// default flags and the adapters themselves in its own file, so parallel branches never edit the
// same lines. `AdapterId` (src/adapters/types.ts), `ADAPTER_DEFAULTS` (config/flags.ts) and
// `REGISTRY` (src/pipeline/ingest.ts) take them from here.
import { bamilongaAdapter } from "@/src/adapters/apis/bamilonga";
import { bcnAgendaAdapter } from "@/src/adapters/apis/bcn-agenda";
import { googleCalendarAdapter } from "@/src/adapters/apis/google-calendar";
import { newYorkTangoAdapter } from "@/src/adapters/apis/newyorktango";
import { poshAdapter } from "@/src/adapters/apis/posh";
import { sabakiAdapter } from "@/src/adapters/apis/sabaki";
import { skiddleAdapter } from "@/src/adapters/apis/skiddle";
import { agendaDelTangoAdapter } from "@/src/adapters/apis/agendadeltango";
import { ventiAdapter } from "@/src/adapters/apis/venti";
import { tangoMangoAdapter } from "@/src/adapters/apis/tangomango";
import { bugeceAdapter } from "@/src/adapters/apis/bugece";
import { skillboxAdapter } from "@/src/adapters/apis/skillbox";
import { circuitoPeneroAdapter } from "@/src/adapters/apis/circuitopenero";
import { lcsdAdapter } from "@/src/adapters/apis/lcsd";
import { qfapAdapter } from "@/src/adapters/apis/qfap";
import { plateaAdapter } from "@/src/adapters/apis/platea";
import { ticketfairyAdapter } from "@/src/adapters/apis/ticketfairy";
import { nineteenHzAdapter } from "@/src/adapters/apis/nineteenhz";
import { tokyoTangoAdapter } from "@/src/adapters/apis/tokyotango";
import { tidarAdapter } from "@/src/adapters/apis/tidar";
import type { SourceAdapter } from "@/src/adapters/types";

/** This lane's adapter ids, for example `| "gcal_api"`. Add a new id here, not in types.ts. */
export type PlatformAdapterId =
  | "bcn_agenda"
  | "newyorktango"
  | "posh"
  | "sabaki"
  | "skiddle"
  | "venti"
  | "bamilonga"
  | "agendadeltango"
  | "tangomango"
  | "bugece"
  | "skillbox"
  | "circuitopenero"
  | "lcsd"
  | "qfap"
  | "platea"
  | "ticketfairy"
  | "nineteenhz"
  | "tokyotango"
  | "tidar";

/** Each id's default flag, by the rules at the top of config/flags.ts. */
export const PLATFORM_DEFAULTS: Readonly<Record<PlatformAdapterId, boolean>> = {
  // The Ajuntament de Barcelona's open-data cultural agenda, CC BY 4.0; Barcelona only (D-360).
  bcn_agenda: true,
  // New York Tango's data files: read with their permission (D-084 question 1, D-133).
  newyorktango: true,
  // Posh's public event pages, read from its sitemap as a search index reads them, under its
  // robots.txt (/api/ never touched); the owner's decision of 2026-10-17 (D-152).
  posh: true,
  // Sabaki's Partner API, free key approved by hand; every listing links to its unchanged Sabaki
  // eventUrl (the API's one condition). Miami and Barcelona only (D-324).
  sabaki: true,
  // Skiddle's official events API, free key; its listings link to their Skiddle pages (D-204).
  // UK metros only (countries GB).
  skiddle: true,
  // Venti's public event pages, read from its sitemap as a search index reads them, under its
  // robots.txt (/api never touched); Argentina only; the owner's decision of 2026-10-29.
  venti: true,
  // The City of Buenos Aires' BAMilonga register of milongas, from its Mapa Milonguero 2026 PDF;
  // weekly nights (D-402, D-403); Argentina only; the owner's decision of 2026-10-29.
  bamilonga: true,
  // Agenda del Tango's own list-page data file (robots.txt allows /; checked 2026-10-29). Barcelona only.
  // Off since 2026-11-13 (D-882): 403 on every read since 11-06, eight failing runs (D-047 retire).
  agendadeltango: false,
  // TangoMango (BAATA)'s free US community tango calendar: robots.txt allows it, Crawl-delay 10,
  // no terms page, checked 2026-10-30; one grid page plus one event page per event a day.
  tangomango: true,
  // Bugece's public list API (robots.txt allows /api/list); Turkey only; the owner read its terms (D-685).
  bugece: true,
  // SkillBox's public event API (the site's own JSON, robots.txt allows /servers/; checked 2026-10-31); owner's yes to its terms (D-621). India only.
  skillbox: true,
  // Circuito Peñero's public events page (the Next.js page data; robots.txt allows /eventos, no terms page, checked 2026-11-01); Argentina only (D-551).
  circuitopenero: true,
  // LCSD's open-data programme feed (Hong Kong); written permission from LCSD (2026-11-03, D-583).
  lcsd: true,
  // The City of Paris's "Que faire a Paris" open-data agenda, ODbL, credit the City of Paris; Paris only (owner 2026-11-06).
  qfap: true,
  // Platea PR's public events page (Next.js page data); written permission (the owner, 2026-10-30), robots.txt allows /eventos; Puerto Rico only.
  platea: true,
  // TicketFairy's public events API (robots.txt allows /api/v1/events/listing, checked 2026-11-07); the owner approved its use (D-1081).
  ticketfairy: true,
  // 19hz.info region page: no terms page, robots.txt 404, owner said read it daily (D-526, D-1161).
  nineteenhz: true,
  // TokyoTango.jp's milonga sheet (Google Sheets CSV), robots.txt allows /spreadsheet (Crawl-delay 1, checked 2026-11-07); Tokyo only.
  tokyotango: true,
  // Tidar's public city page (Next.js page data); robots.txt none, terms of sale say nothing about automated reading; Morocco only (Marrakech).
  tidar: true,
};

export const PLATFORM_ADAPTERS: readonly SourceAdapter[] = [
  // Its id, `feed_gcal`, predates the lanes and stays in types.ts and config/flags.ts, because
  // stored rows carry it as their platform (docs/WORKSTREAMS.md, section 3).
  googleCalendarAdapter,
  bcnAgendaAdapter,
  agendaDelTangoAdapter,
  newYorkTangoAdapter,
  poshAdapter,
  sabakiAdapter,
  skiddleAdapter,
  ventiAdapter,
  bamilongaAdapter,
  tangoMangoAdapter,
  bugeceAdapter,
  skillboxAdapter,
  circuitoPeneroAdapter,
  lcsdAdapter,
  qfapAdapter,
  plateaAdapter,
  ticketfairyAdapter,
  nineteenHzAdapter,
  tokyoTangoAdapter,
  tidarAdapter,
];
