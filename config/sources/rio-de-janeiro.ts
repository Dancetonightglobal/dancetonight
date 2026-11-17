// Rio de Janeiro's starting sources (D-420). Brazil is read like the UK (the owner, 2026-10-29, D-420): official APIs
// and public pages only, robots.txt honoured; unofficial endpoints off unless the operator agrees in writing;
// Resident Advisor, Facebook and Instagram never. Sympla's public pages are read for facts only (the owner, 2026-10-29,
// D-421); Shotgun stays off (it answers 429). Portuguese screen words ship before any venue page.

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
});

const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  ...page(url, label, styles),
  trustTier: "directory",
});

// Sympla rows checked as not dance nights (D-519 audit E1, coverage-77 2026-10-31): two monthly classes at
// Centro Coreográfico (a class is not a social night) and a seated concert at Arena Dicró (band gigs count only
// at dance-floor venues, D-520). Matched on the whole title.
const SYMPLA_NOT_DANCE_NIGHTS: readonly string[] = [
  "Balé sem Rótulos (Novembro)",
  "Oficina de Dança Afro (Novembro) – Escola Carioca de Danças Negras",
  "Orquestra popular Manoel Congo: Concerto de 10 Anos",
  // Read 2026-11-12: a rock tribute concert and a holiday course.
  "KRUGER - TRIBUTO *",
  "CURSO DS FÉRIAS *",
  "O neguinho da beija flor - Musical",
];

const symplaList = (url: string, label: string): SeedSource => ({
  ...directory(url, label, []),
  kind: "jsonld",
  platform: "sympla",
  mixedCalendar: true,
  trustTier: "ticketing",
  notDanceNights: SYMPLA_NOT_DANCE_NIGHTS,
});

export const RIO_DE_JANEIRO_SOURCES: SeedSource[] = [
  // Salsa Vida's Rio de Janeiro guide: schema.org Events on the page (8 on 10/29, about ten days ahead: Club
  // Substation's Thursday, Saturday and Sunday socials in Copacabana, Boate Leviano's Friday Latin night in
  // Lapa; robots.txt allows it, checked 2026-10-29). Read as a directory (D-321).
  directory(
    "https://www.salsavida.com/guides/brazil/rio-de-janeiro/",
    "Salsa Vida Rio de Janeiro",
    ["salsa", "bachata"],
  ),
  // Forrozinho's Rio de Janeiro agenda (forrozinho.com.br, a community forró guide): schema.org Events on the list
  // page itself, each with its start, end and the place's street address (55 on 10/31 across 25 days, Rio, Niterói
  // and the Baixada; Monday to Thursday forró nights the other sources miss, D-524 gap report). Its terms of use
  // (/pt/termos-de-uso, March 2026) set no rule on automated reading or reuse of listings; they protect the site's
  // design, code and original content. robots.txt allows / for every user agent (only /admin, /api and account pages
  // are disallowed) and its header welcomes "AI assistants that cite sources"; checked 2026-10-31 by Rio - 10.
  // Read once a day from this one page by the JSON-LD reader, facts only, each row linking back (Brazil = US tier).
  {
    ...directory(
      "https://forrozinho.com.br/pt/brasil/rj/rio-de-janeiro/eventos",
      "Forrozinho Rio de Janeiro",
      ["forro"],
    ),
    kind: "jsonld",
    platform: "jsonld",
  },
  // Busca Dança's Rio list (buscadanca.com.br, a national dance guide): weekly dance nights with weekday and time
  // (20 Rio cards on 10/31 over two list pages, 16 weekly: forró, tango, zouk; Madame Baderna and Zouk Lounge Rio on
  // Wednesdays, Milonga Xangô on Fridays). Its terms forbid copying or scraping without authorization; the owner asked and
  // Busca Dança agreed in writing (D-543, 2026-10-31; D-536). robots.txt allows everything but /wp-admin/. Read once a
  // day by the buscadanca reader: the weekly cards for Rio, each card's own page for its street address; facts
  // only, each row links to the Busca Dança page. Monthly and undated cards are left out.
  {
    ...directory(
      "https://buscadanca.com.br/cidade-evento/rio-de-janeiro/",
      "Busca Dança Rio de Janeiro",
      ["forro"],
    ),
    kind: "jsonld",
    platform: "buscadanca",
  },
  // Carioca da Gema, Lapa: the bar's own Wix shows page (15 dated nights 10/29 to 11/20: samba, gafieira and
  // choro bands for dancing, every night but Monday; robots.txt allows it, checked 2026-10-29). Read without
  // a model by the Wix Events reader (#388: the page's warmup data carries each start). Address from the
  // bar's own site.
  {
    ...page("https://www.barcariocadagema.com.br/shows", "Carioca da Gema", [
      "samba",
      "samba_de_gafieira",
    ]),
    kind: "wix",
    platform: "wix_events",
    venueAddress: "Av. Mem de Sá, 79 - Centro, Rio de Janeiro - RJ, 20230-150",
    venuePage: true,
    onlyHere: true,
  },
  // Bar do Omar, Morro do Pinto (Santo Cristo): the bar's own one-page site lists a fixed weekly roda programme
  // under weekday headings with no dates (Quinta Misturadinho do Compasso 17h, Sexta Pagode do Vitu 17h, Sábado
  // Noca Neto 15h, Domingo "Dose dupla de Samba"; opening hours Thu-Fri 17-00, Sat 15-00, Sun 15-23). Read as
  // weekly nights (D-402; the owner 2026-10-30: a bar's own fixed weekly schedule counts). Found in GuiaMais 08/2025
  // ("Melhor Roda de Samba do Rio 2023"); robots.txt (WordPress.com) allows all, checked 2026-10-30.
  {
    ...page("https://bardoomar.com.br/", "Bar do Omar", ["samba_no_pe"]),
    venueAddress: "Rua Sara, 114 - Santo Cristo, Rio de Janeiro - RJ",
    weeklyGrid: true,
    venuePage: true,
    onlyHere: true,
  },
  // Beco do Rato, Lapa: samba every night. Mapa do Samba (mapadosamba.com.br/roda/beco-do-rato) lists it every day
  // from 19:00; the house's own home page (becodorato.com.br) agrees ("SAMBA TODOS OS DIAS" over its weekday hours) but
  // its hours were not read as nights (run 41159711022 wrote 0), so the Mapa page is read (D-513, JSON-LD reader).
  // Checked 2026-10-31 by Rio - 7.
  {
    ...directory("https://mapadosamba.com.br/roda/beco-do-rato", "Beco do Rato", ["samba_no_pe"]),
    kind: "jsonld",
    platform: "jsonld",
    venueAddress: "Rua Joaquim Silva, 11 - Lapa, Rio de Janeiro - RJ",
    onlyHere: true,
  },
  // Rodas with no site of their own, listed under D-510 (the owner 2026-10-31: a fixed weekly night two independent
  // guides agree on). Each is read from its Mapa do Samba page (schema.org Event with a weekly Schedule; robots.txt
  // allows all, checked 2026-10-30); the second guide is named on each entry. Re-check both guides at each full read
  // and retire an entry when either stops naming the night. Checked 2026-10-31 by Rio - 7.
  // Read by the JSON-LD reader (D-513): each page's Event has no date but a weekly eventSchedule (byDay), read as a
  // weekly rule without a model; its time is the description's own "a partir das 18:00", else untimed.
  // Samba do Trabalhador, Renascença Clube, Andaraí: every Monday from late afternoon. Second guides: Time Out Rio
  // (timeout.com/rio-de-janeiro/music/samba-do-trabalhador) and Catraca Livre ("Samba do Trabalhador faz roda toda
  // segunda-feira no Renascença").
  {
    ...directory("https://mapadosamba.com.br/roda/samba-do-trabalhador", "Samba do Trabalhador", [
      "samba_no_pe",
    ]),
    kind: "jsonld",
    platform: "jsonld",
    venueAddress: "Rua Barão de São Francisco, 54 - Andaraí, Rio de Janeiro - RJ",
    onlyHere: true,
    // The organiser's own Sympla page states its hours: "Estamos todas as segundas-feiras, às 16h30, no Renascença
    // Clube", 16:30 to 21:45 (sympla.com.br/evento/samba-do-trabalhador-17-de-agosto-no-clube-renascenca/3538554,
    // checked 2026-10-31; D-519 C5). Bip Bip gets none: its guides disagree (19:00, 20:00 or 21:00).
    houseHours: {
      start: "16:30",
      end: "21:45",
      days: [1],
      checked:
        "Sympla event page by the organiser: 'todas as segundas-feiras, às 16h30', 16:30-21:45 (2026-10-31)",
    },
  },
  // Pagode da Garagem, Praça Tiradentes (Nova Gafieira, ex-Estudantina), Centro: every Tuesday from 18:00. Second
  // guide: Time Out Rio (timeout.com/rio-de-janeiro/music/pagode-da-garagem, Tuesdays from 19:00).
  {
    ...directory("https://mapadosamba.com.br/roda/pagode-da-garagem", "Pagode da Garagem", [
      "samba_no_pe",
    ]),
    kind: "jsonld",
    platform: "jsonld",
    venueAddress: "Praça Tiradentes, 81 - Centro, Rio de Janeiro - RJ",
    onlyHere: true,
  },
  // Roda do Bip, Bip Bip, Copacabana: every Thursday and Sunday at night. Second guide: Catraca Livre
  // (catracalivre.com.br/agenda/bar-bip-bip-rio/, Thursdays and Sundays).
  {
    ...directory("https://mapadosamba.com.br/roda/bip-bip", "Bip Bip", ["samba_no_pe"]),
    kind: "jsonld",
    platform: "jsonld",
    venueAddress: "Rua Almirante Gonçalves, 50 - Copacabana, Rio de Janeiro - RJ",
    onlyHere: true,
  },
  // Roda de Samba da Pedra do Sal, Largo João da Baiana, Saúde: a free street roda every Monday from 19:00. No site of
  // its own and no Mapa do Samba page, so it is listed under D-529 (the owner 2026-10-31: a weekly night with no page counts
  // when 2+ independent recent guides agree on the night and time; recheck monthly). Read page: Viaje na Viagem (updated
  // 2025-04: "Toda 2a. feira a partir das 19h"); second guide: Rio Times (riotimesonline.com, 09/2026: 19:00 to midnight
  // every Monday, citing Riotur). O Globo via Tribuna do Sertão (06/2026) also names Monday. The page also describes
  // Samba do Trabalhador, which is read from its own Mapa page; not onlyHere, so its row keeps its own venue.
  // Viaje na Viagem: robots.txt allows all; its terms (/termos-de-uso/) reserve copyright on texts and photos and set
  // no rule on reading; facts only. Checked 2026-10-31 by Rio - 10. RECHECK MONTHLY (next 2026-12-01): retire the entry
  // when either guide stops naming the Monday roda.
  {
    ...directory(
      "https://www.viajenaviagem.com/rio-na-pedra-do-sal-e-no-andarai-2a-e-dia-util-pra-cair-no-samba",
      "Roda de Samba da Pedra do Sal",
      ["samba_no_pe"],
    ),
    platform: "probed",
    weeklyGrid: true,
    houseHours: {
      start: "19:00",
      end: "00:00",
      days: [1],
      checked:
        "Viaje na Viagem 'Toda 2a. feira a partir das 19h' (2025-04) and Rio Times 19:00-midnight every Monday (09/2026), D-529 (2026-10-31)",
    },
  },
  // 5Rhythms classes by Rosa Valgode, read with 5Rhythms' written permission (D-523). Ondas dos 5Ritmos: Saturdays
  // 10:30-12:30 and 14:30-17:30 at Rua das Palmeiras 96, Botafogo; Saturdays 10:30-12:30 at Casa Tao, Centro.
  page(
    "https://www.5rhythms.com/classes/OndasdosRitmosBotafogo-298696",
    "Ondas dos 5Ritmos Botafogo 5Rhythms",
    ["five_rhythms"],
  ),
  page(
    "https://www.5rhythms.com/classes/OndasdosRitmosBotafogo-298008",
    "Ondas dos 5Ritmos Botafogo afternoon 5Rhythms",
    ["five_rhythms"],
  ),
  page(
    "https://www.5rhythms.com/classes/OndasdosRitmosCentro-298010",
    "Ondas dos 5Ritmos Centro 5Rhythms",
    ["five_rhythms"],
  ),

  // Sympla's Rio de Janeiro city list: 12 /evento/<slug>/<id> links in the page's HTML on 10/29 (forró, samba,
  // Latin nights beside karaoke, boat parties, dinners and laje tours, so a mixed calendar); robots.txt allows
  // all, checked 2026-10-29. Read without a model by the Sympla reader (#412): each event page's own data gives
  // the start and end with offset, the address with CEP and the host. Organiser pages redirect to bileto (403)
  // and category pages carry no links (D-421).
  // kind "jsonld", not the helper's "html": an html page is probed first and loses its platform (run 40925122121).
  // Two Sympla lists (Rio - 4, 2026-10-29): the reader follows ?page=N itself, up to 5 pages from the source's own
  // page (D-259, #486). /hoje pages 1-4 held all 45 of today's Rio events on 10/29; the city list's pages 1-3 are
  // those same events, so the upcoming list starts at ?page=4 (pages 4-8, about 24 links a page, in no date order).
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje",
    "Sympla Rio de Janeiro (today)",
  ),
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=4",
    "Sympla Rio de Janeiro (upcoming)",
  ),
  // Pages 9-13 of the same list (Rio - 4, 10-29): run 40949108741 left the nights after tonight at 1-8 rows each.
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=9",
    "Sympla Rio de Janeiro (upcoming, from page 9)",
  ),
  // Pages 14-23 of the same list (Rio - 4, 10-30): run 40956204356 still left Mon-Wed at 1-3 rows; the list runs past
  // page 30 with about 24 new links a page.
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=14",
    "Sympla Rio de Janeiro (upcoming, from page 14)",
  ),
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=19",
    "Sympla Rio de Janeiro (upcoming, from page 19)",
  ),
  // Sympla's this-week and next-week lists (Rio - 7, 10-31, D-496): the city list is sorted by relevance, so Mon-Thu
  // stayed at 2-4 rows; these date lists hold about 5 Mon-Thu events in every 16 (319 and 429 events on 10-31).
  // This week's list covers the nights left in a weekday read; next week's covers Mon-Thu in a weekend read.
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/esta-semana",
    "Sympla Rio de Janeiro (this week)",
  ),
  symplaList(
    "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/proxima-semana",
    "Sympla Rio de Janeiro (next week)",
  ),
];

export const RIO_DE_JANEIRO_RETIRED: RetiredSource[] = [
  {
    url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj",
    reason: "Folded into the today list: its pages 1-3 are today's events (D-259 follows pages).",
  },
  {
    url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=2",
    reason: "Folded into the today list from page 1 (D-259 follows pages).",
  },
  {
    url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=3",
    reason: "Folded into the today list from page 1 (D-259 follows pages).",
  },
  {
    url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj/hoje?page=4",
    reason: "Folded into the today list from page 1 (D-259 follows pages).",
  },
  {
    url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=5",
    reason: "Folded into the upcoming list from page 4 (D-259 follows pages).",
  },
  {
    url: "https://www.sympla.com.br/eventos/rio-de-janeiro-rj?page=6",
    reason: "Folded into the upcoming list from page 4 (D-259 follows pages).",
  },
  // Found by discovery (Rio daily read 41063406759, 2026-10-30).
  {
    url: "https://www.acasocultural.com/agenda",
    reason:
      'a seated concert and talk house (MPB shows, book talks): about 2 danced nights in 19 listings; its "Rock, samba e MPB" show passed the screen (2026-10-30)',
  },
  {
    url: "https://becodorato.com.br/",
    reason:
      "Its home page gives weekday hours, not nights: run 41159711022 wrote 0. Read from its Mapa do Samba page instead (D-510).",
  },
];
