// Paris's starting sources (D-1040). France is in the EU: D-034's rules (official APIs, first-party public pages
// and feeds, robots.txt honoured, facts only, no unofficial endpoint without written consent); Facebook and
// Instagram never; Resident Advisor only through its GraphQL endpoint (D-505, area 44). HelloAsso, Billetweb and
// Weezevent wait for the owner's written permission asks (D-1040). The daily run seeds venues and discovers their
// websites (D-120). DICE's Paris browse pages are read (owner's yes, 2026-11-06).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";
import { DICE_GENRES, diceSources } from "@/config/sources/dice";

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
  mixedCalendar: true,
});

/** An Eventbrite organiser, read through the API by ID (D-131); every one screened as a mixed calendar. */
const eventbrite = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "ticketing_api",
  trustTier: "ticketing",
  platform: "eventbrite",
  styles,
  label,
  mixedCalendar: true,
});

/**
 * DICE's Paris browse page (D-139, D-197; FR added to the adapter's countries, owner 2026-11-06). robots.txt
 * allows every path to all agents ("Allow: /"), checked 2026-11-06.
 */
const DICE_BROWSE = "https://dice.fm/browse/paris-5b23e8a0e63cc224a4c36a2d/music";

/**
 * DICE genre pages that exist for Paris: checked 2026-11-06, these 32 answered 200; the other 13 answer a 307
 * redirect to the gig list and are retired below.
 */
const PARIS_DICE_GENRES = new Set([
  "dj/house",
  "dj/deephouse",
  "dj/tech-house",
  "dj/techno",
  "dj/hard_techno",
  "dj/disco",
  "dj/funk",
  "dj/latin",
  "dj/latin_tropical",
  "dj/reggaeton",
  "dj/afrobeats",
  "dj/afrohouse",
  "dj/amapiano",
  "dj/dancehall",
  "dj/hiphop",
  "dj/rnb",
  "dj/garage",
  "dj/ukg",
  "dj/trance",
  "dj/melodic_house",
  "dj/dance",
  "party/afrobeats",
  "party/amapiano",
  "party/baile_funk",
  "party/dancehall",
  "party/disco",
  "party/house",
  "party/hiphop",
  "party/pop",
  "party/lgbtq+",
  "party/dance",
  "party/reggaeton",
]);

export const PARIS_SOURCES: readonly SeedSource[] = [
  ...diceSources(
    DICE_BROWSE,
    "Paris",
    DICE_GENRES.filter(([path]) => PARIS_DICE_GENRES.has(path)),
  ),
  // Salsa Vida's Paris guide (owner approved Salsa Vida's terms, 2026-10-31). schema.org Events in the page's ItemList
  // (24 on 11/06: weekly socials every night, e.g. Tue Balajo, Le Comptoir Général and Moulin de la Galette; Sun
  // Rosa Bonheur à l'Ouest and Café Oz Grands Boulevards). robots.txt allows it (checked 2026-11-06).
  // Read as Nashville's and Raleigh's are (D-321): Salsa Vida lists only dance socials, so not a mixed calendar
  // (as one, its "Noche Habanera" at JO&JOE Gentilly and "Paris Latino" at Café Oz Châtelet were dropped, 11-07).
  {
    url: "https://www.salsavida.com/guides/france/paris/",
    kind: "html",
    trustTier: "directory",
    styles: ["salsa", "bachata", "kizomba"],
    label: "Salsa Vida Paris",
  },
  // tango-argentin.fr's Ile-de-France agenda (D-1044): every bal and pratique in the
  // region about 8 weeks ahead (2-6 every weeknight in November 2026), so future nights show tango, not only today.
  // robots.txt allows / (checked 2026-11-07). kind "jsonld" so the platform's reader runs: as "html" it was probed
  // and read by the model (run 42450876185, 2026-11-08).
  {
    url: "https://tango-argentin.fr/ile-de-france",
    kind: "jsonld",
    platform: "tango_argentin",
    trustTier: "directory",
    styles: ["tango"],
    label: "tango-argentin.fr",
  },
  // AgendaTrad's Ile-de-France calendar (D-831): every public bal folk, bal trad and fest-noz in the region,
  // read by the agendatrad reader (event pages for addresses). robots.txt disallows all robots; the organisers gave
  // written permission (AgendaTrad via the owner, 2026-11-10), so the robots check alone is waived for this host.
  // kind "jsonld" so the platform's reader runs (as "html" a page is probed and model-read, run 42450876185).
  {
    url: "https://agendatrad.org/calendar/France/Ile-de-France",
    kind: "jsonld",
    platform: "agendatrad",
    trustTier: "directory",
    styles: ["folk"],
    label: "AgendaTrad",
    robotsWaiver: { grantedBy: "AgendaTrad via the owner", on: "2026-11-10", decision: "D-831" },
  },
  // Salsa Paris Night: an organiser's dated agenda of salsa, bachata and kizomba nights (Lunes Timba, K&S Experience SBK). robots.txt allows it (checked 2026-11-06).
  {
    url: "https://salsaparisnight.com/agenda-evenements",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "kizomba"],
    label: "Salsa Paris Night",
    mixedCalendar: true,
    fixedNights: [
      {
        title: "K&S Experience SBK",
        line: "Tous les samedis au 3 rue Gaston Monmousseau, 94200 Ivry-sur-Seine",
        days: [6],
        start: null,
        styles: ["salsa", "bachata", "kizomba"],
        danceCited:
          "own site, https://salsaparisnight.com/agenda-evenements: 'Chaque samedi : K&S Experience SBK, salsa bachata kizomba ... Tous les samedis au 3 rue Gaston Monmousseau, 94200 Ivry-sur-Seine' (checked 2026-11-07)",
        replacesTitles: ["K&S Experience SBK"],
        venue: "GIET Studio",
      },
    ],
  },
  // Central Chapelle: a club and concert venue's dated agenda. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://centralchapelle.com/agenda/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Central Chapelle",
    onlyHere: true,
    venuePage: true,
    mixedCalendar: true,
  },
  // La Dame de Canton, a boat club at 5 Port de la Gare: dated event list. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.damedecanton.com/event-list",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "La Dame de Canton",
    onlyHere: true,
    venuePage: true,
    venueAddress: "La Dame de Canton, 5 Port de la Gare, 75013 Paris",
    mixedCalendar: true,
  },
  // Zouzou Pigalle, 12 rue Frochot: dated themed club nights. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://zouzoupigalle.com/programmation.html",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Zouzou Pigalle",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Zouzou Pigalle, 12 rue Frochot, 75009 Paris",
    mixedCalendar: true,
  },
  // Péniche Marcounet: a boat venue's event calendar (concerts and DJ sets). robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.peniche-marcounet.fr/agenda/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Péniche Marcounet",
    onlyHere: true,
    venuePage: true,
    mixedCalendar: true,
  },
  // Le Bateau Phare, 3 Port de la Gare: dated programme with genres and times. robots.txt allows it for all agents (checked 2026-11-06).
  {
    url: "https://lebateauphare.paris/programmation/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Le Bateau Phare",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Le Bateau Phare, 3 Port de la Gare, 75013 Paris",
    mixedCalendar: true,
  },
  // Cubana Café, 47 rue Vavin: Latin nights (Friday DJ, Tuesday salsa); its monthly programme posts list the nights. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.cubanacafe.com/soirees-latines-a-paris/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Cubana Café",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Cubana Café, 47 rue Vavin, 75006 Paris",
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Dansez comme à Cuba",
        line: "LES MARDIS & JEUDIS",
        days: [2, 4],
        start: null,
        end: "04:00",
        styles: ["salsa"],
        danceCited:
          "own site, https://www.cubanacafe.com/soirees-latines-a-paris/: 'LES MARDIS & JEUDIS | Dansez comme à Cuba jusqu'à 4h du mat'' (checked 2026-11-07)",
        replacesTitles: ["Dansez comme à Cuba"],
      },
    ],
  },
  // La Felicità at Station F: a food court whose programme lists dated DJ-set nights. robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.lafelicita.fr/programmation",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "La Felicità",
    onlyHere: true,
    venuePage: true,
    venueAddress: "La Felicità, 5 parvis Alan Turing, 75013 Paris",
    mixedCalendar: true,
  },
  // Caveau de la Huchette: the Latin Quarter swing cellar, a jazz band for dancing every night since 1946 (home page).
  // Its site's HTTPS certificate chain is incomplete (curl: unable to get local issuer certificate), so plain HTTP.
  // robots.txt names only Googlebot and RSS paths (checked 2026-11-07).
  {
    url: "http://www.caveaudelahuchette.fr/",
    kind: "html",
    trustTier: "first_party",
    styles: ["swing"],
    label: "Caveau de la Huchette",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Caveau de la Huchette, 5 rue de la Huchette, 75005 Paris",
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Swing au Caveau de la Huchette",
        line: "Chaque soir depuis 1946 un orchestre de jazz",
        days: [0, 1, 2, 3, 4],
        start: "21:30",
        end: "01:30",
        danceCited:
          "own site, http://www.caveaudelahuchette.fr/: 'Chaque soir depuis 1946 un orchestre de jazz pour le plaisir d’écouter ou de danser'; concerts page: 'Semaine : 1er set : 21h30 ... 3ème set : 00h30 - 01h30 / Week-end : ... 00h45 - 01h45' (checked 2026-11-07)",
        replacesTitles: ["Caveau de la Huchette"],
        closed: [
          {
            from: "2026-11-30",
            to: "2026-12-14",
            cited:
              "own site, http://www.caveaudelahuchette.fr/: 'Fermeture exceptionnelle pour travaux du lundi 30 novembre au lundi 14 décembre inclus' (checked 2026-11-07)",
          },
        ],
      },
      {
        title: "Swing au Caveau de la Huchette (week-end)",
        line: "Chaque soir depuis 1946 un orchestre de jazz",
        days: [5, 6],
        start: "21:30",
        end: "01:45",
        danceCited:
          "own site, http://www.caveaudelahuchette.fr/: 'Chaque soir depuis 1946 un orchestre de jazz pour le plaisir d’écouter ou de danser'; concerts page: 'Semaine : 1er set : 21h30 ... 3ème set : 00h30 - 01h30 / Week-end : ... 00h45 - 01h45' (checked 2026-11-07)",
        replacesTitles: ["Caveau de la Huchette"],
        closed: [
          {
            from: "2026-11-30",
            to: "2026-12-14",
            cited:
              "own site, http://www.caveaudelahuchette.fr/: 'Fermeture exceptionnelle pour travaux du lundi 30 novembre au lundi 14 décembre inclus' (checked 2026-11-07)",
          },
        ],
      },
    ],
  },
  // Le Duplex's thé dansant (Après-midi Dansants du Duplex), 2 bis avenue Foch: its agenda page writes "TOUS LES
  // DIMANCHES ET LUNDIS DE 14h30 À 21h30" and dates its themed Mondays (read by the model). Sundays are the fixed
  // night; a fixed Monday would double the dated theme rows. robots.txt disallows only /in/, /new/, /musique/, /videos/
  // (checked 2026-11-08).
  {
    url: "https://www.clubetoile.fr/agenda/",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "social_ballroom"],
    label: "Le Duplex",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Le Duplex, 2 bis avenue Foch, 75116 Paris",
    fixedNights: [
      {
        title: "Après-midi dansant du Duplex (dimanche)",
        line: "TOUS LES DIMANCHES ET LUNDIS",
        days: [0],
        start: "14:30",
        end: "21:30",
        danceCited:
          "own site, https://www.clubetoile.fr/agenda/: 'NOTRE AGENDA TOUS LES DIMANCHES ET LUNDIS DE 14h30 À 21h30 Animation DJ(s) : 2 Salles / 2 Ambiances'; 'venez faire vibrer les pistes de danse' (checked 2026-11-08)",
      },
    ],
  },
  // Le Balajo, 9 rue de Lappe (since 1936): its own site has one page per weekly night. robots.txt: "Allow: /"
  // (checked 2026-11-07). Tuesday salsa comes through Salsa Vida; Fridays and Saturdays are club nights.
  {
    url: "https://www.balajo.fr/lundis",
    kind: "html",
    trustTier: "first_party",
    styles: ["retro", "social_ballroom"],
    label: "Le Balajo",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Le Balajo, 9 rue de Lappe, 75011 Paris",
    fixedNights: [
      {
        title: "Thé dansant au Balajo",
        line: "tous les lundis de 14h",
        days: [1],
        start: "14:00",
        end: "19:00",
        danceCited:
          "own site, https://www.balajo.fr/lundis: 'nos thés dansants qui se déroulent tous les lundis de 14h à 19h depuis 1936' (checked 2026-11-07)",
      },
    ],
  },
  {
    url: "https://www.balajo.fr/jeudis",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata", "kizomba", "dj_night"],
    label: "Le Balajo",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Le Balajo, 9 rue de Lappe, 75011 Paris",
    fixedNights: [
      {
        title: "Mixte Salsa Clubbing au Balajo",
        line: "qui ont lieu tous les jeudis de 19h30",
        days: [4],
        start: "19:30",
        danceCited:
          "own site, https://www.balajo.fr/jeudis: 'soirées Mixte Salsa Clubbing au Balajo, qui ont lieu tous les jeudis de 19h30 à l'aube ... cours de salsa cubaine ... soirée SBK de 21h30 à 00h30, suivie d'une ambiance Urban Clubbing' (checked 2026-11-07)",
      },
    ],
  },
  // Le Balajo's monthly rock night: the page prints its dates ("Un mercredi par mois de 20h à 01h. Prochaines date:
  // ... Mercredi 11 novembre Mercredi 9 décembre"), read as a dated page.
  {
    url: "https://www.balajo.fr/mercredis",
    kind: "html",
    trustTier: "first_party",
    styles: ["rock_n_roll"],
    label: "Le Balajo",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Le Balajo, 9 rue de Lappe, 75011 Paris",
  },
  // Madame Arthur: a cabaret that turns into a club Thursday to Saturday (home page). robots.txt allows it (checked 2026-11-06).
  {
    url: "https://madamearthur.fr/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Madame Arthur",
    onlyHere: true,
    venuePage: true,
    mixedCalendar: true,
    fixedNights: [
      {
        title: "Club Madame Arthur (jeudi)",
        line: "Du jeudi au samedi, le cabaret Madame Arthur se transforme en club",
        days: [4],
        start: "23:00",
        end: "06:00",
        danceCited:
          "own site, https://madamearthur.fr/: 'Du jeudi au samedi, le cabaret Madame Arthur se transforme en club ... DJ résidents'; Jeudi '23H/06H Soirée club' (checked 2026-11-07)",
        replacesTitles: ["Club Madame Arthur"],
      },
      {
        title: "Club Madame Arthur (vendredi et samedi)",
        line: "Du jeudi au samedi, le cabaret Madame Arthur se transforme en club",
        days: [5, 6],
        start: "23:30",
        end: "06:00",
        danceCited:
          "own site, https://madamearthur.fr/: 'Du jeudi au samedi, le cabaret Madame Arthur se transforme en club ... DJ résidents'; Vendredi and Samedi '23H30/06H Soirée club' (checked 2026-11-07)",
        replacesTitles: ["Club Madame Arthur"],
      },
    ],
  },
  // Temple du Swing, 32 boulevard de Vaugirard (15e): a swing and West Coast Swing school. Its soirées pages print
  // the weekly nights only on poster images (alt text, 2026-11-08), so the fixed-night line is the page's section
  // heading. robots.txt disallows only /wp-admin/ (checked 2026-11-08). Season runs September to June: recheck in June.
  {
    url: "https://templeduswing.com/soirees-wcs/",
    kind: "html",
    trustTier: "first_party",
    styles: ["west_coast_swing"],
    label: "Temple du Swing",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Temple du Swing, 32 boulevard de Vaugirard, 75015 Paris",
    fixedNights: [
      {
        title: "After WCS du mardi au Temple du Swing",
        line: "Les hebdomadaires",
        days: [2],
        start: "21:00",
        end: "00:15",
        danceCited:
          "own site, https://templeduswing.com/soirees-wcs/: 'Les hebdomadaires'; poster 'After WCS du mardi, saison 2026-2027, DJ set de 21h00 a 00h15 au Temple du Swing' (checked 2026-11-08)",
      },
      {
        title: "After WCS du jeudi au Temple du Swing",
        line: "Les hebdomadaires",
        days: [4],
        start: "21:00",
        end: "00:15",
        danceCited:
          "own site, https://templeduswing.com/soirees-wcs/: 'Les hebdomadaires'; poster 'After WCS du jeudi special petits niveaux, saison 2026-2027, DJ set de 21h00 a 00h15 au Temple du Swing' (checked 2026-11-08)",
      },
    ],
  },
  {
    url: "https://templeduswing.com/soirees-bals-swing/",
    kind: "html",
    trustTier: "first_party",
    styles: ["swing", "lindy_hop"],
    label: "Temple du Swing",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Temple du Swing, 32 boulevard de Vaugirard, 75015 Paris",
    fixedNights: [
      {
        title: "Pratique Swing au Temple du Swing (mercredi)",
        line: "Les régulières",
        days: [3],
        start: "21:00",
        end: "23:00",
        danceCited:
          "own site, https://templeduswing.com/soirees-bals-swing/: 'Les régulières'; poster 'Pratique SWING au Temple du Swing : tous les mercredis, DJ set de 21h a 23h, 32 boulevard de Vaugirard' (checked 2026-11-08)",
      },
    ],
  },
  // AGUA Party Paris (aguapartyparis.fr): salsa and bachata lessons 19h-21h, then the dance party. Tuesdays at
  // Péniche Concorde Atlantique, Sundays (new from 2026-11-08) at Quai de la Photo; each page states its night.
  // Its home page lists dated soirées and marked "ANNULEE – Mardi 10 Novembre". robots.txt disallows only WooCommerce
  // paths (checked 2026-11-09). Its Instagram (@aguapartyparis) says the same; the own site is the source.
  {
    url: "https://aguapartyparis.fr/la-soiree/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Péniche Concorde Atlantique",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Péniche Concorde Atlantique, 23 quai Anatole France, 75007 Paris",
    fixedNights: [
      {
        title: "AGUA - soirée salsa bachata du mardi",
        line: "Tous les mardis sur la Seine",
        days: [2],
        start: "19:00",
        end: "01:00",
        replacesTitles: ["La soirée du mardi", "La soirée"],
        danceCited:
          "own site, https://aguapartyparis.fr/la-soiree/: 'LA SOIRÉE DU MARDI Danse, rencontre, fiesta. Tous les mardis sur la Seine. Trois salles, trois ambiances : Salsa, Bachata et L'Atelier'; '21h – 1h · La soirée' (checked 2026-11-09)",
        closed: [
          {
            from: "2026-11-10",
            to: "2026-11-10",
            cited:
              "own site, https://aguapartyparis.fr/: 'ANNULEE – Mardi 10 Novembre' (checked 2026-11-09)",
          },
        ],
      },
    ],
  },
  {
    url: "https://aguapartyparis.fr/la-soiree-dimanche/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    label: "Quai de la Photo",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Quai de la Photo, 9 quai de la Gare, 75013 Paris",
    fixedNights: [
      {
        title: "AGUA - soirée salsa bachata du dimanche",
        line: "Tous les dimanches au Quai de la Photo",
        days: [0],
        start: "19:00",
        end: "00:00",
        replacesTitles: ["LA SOIRÉE DU DIMANCHE", "La soiree dimanche"],
        danceCited:
          "own site, https://aguapartyparis.fr/la-soiree-dimanche/: 'LA SOIRÉE DU DIMANCHE Danse, rencontre, fiesta. Tous les dimanches au Quai de la Photo. Deux salles, deux danses : Bachata et Salsa On1'; '21h – 00h · La soirée' (checked 2026-11-09)",
      },
    ],
  },
  // Banana Café, 13 rue de la Ferronnerie (Les Halles): its home page calls it "un bar dansant et club house music",
  // open every night 17h-8h with resident DJs "pour vous faire danser". robots.txt "Allow: /" (checked 2026-11-09).
  {
    url: "https://banana-cafe-paris.com/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night", "house"],
    label: "Banana Café",
    onlyHere: true,
    venuePage: true,
    venueAddress: "Banana Café, 13 rue de la Ferronnerie, 75001 Paris",
    fixedNights: [
      {
        title: "Banana Café, bar dansant (tous les soirs)",
        line: "Tous les soirs jusqu'à 8h du matin",
        days: [0, 1, 2, 3, 4, 5, 6],
        start: "17:00",
        end: "08:00",
        danceCited:
          "own site, https://banana-cafe-paris.com/: 'Le Banana Café est un bar dansant et club house music au cœur de Les Halles'; 'Tous les soirs jusqu'à 8h du matin. L'ouverture se fait en début de soirée (17h)'; 'nos DJs résidents, collectifs et artistes invités, pour vous faire danser jusqu'au petit matin' (checked 2026-11-09)",
      },
    ],
  },
  // La CASA, 15 rue Daval (Bastille): a "Dance & Night Club" (its Instagram category) whose Saturday night La Frénésie
  // is posted "Every Saturday". Own Instagram only, read by hand in the owner's Chrome (D-796, D-797): recheck monthly.
  {
    url: "https://www.instagram.com/la.casa.paris/",
    kind: "html",
    handChecked: true,
    trustTier: "first_party",
    styles: ["hip_hop_club", "afrobeats_club", "dancehall"],
    label: "La CASA",
    onlyHere: true,
    venuePage: true,
    venueAddress: "La CASA, 15 rue Daval, 75011 Paris",
    fixedNights: [
      {
        title: "La Frénésie at La CASA (samedi)",
        line: "LA FRÉNÉSIE. Every Saturday at La CASA",
        days: [6],
        start: "23:55",
        end: "06:00",
        danceCited:
          "instagram.com/la.casa.paris post 2026-11-01: 'LA FRÉNÉSIE. Every Saturday at La CASA. Saturday, November 07, 23:55 - 06:00' #HipHop #Rnb #Afrobeats #Shatta #Dancehall; account category 'Dance & Night Club' (read 2026-11-09)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfNmN6kqPRr/",
      },
    ],
  },
  // L'Alimentation Générale, 64 rue Jean-Pierre Timbaud: bar-club whose home page lists dated nights as text (Tropiteca, Latin and disco club nights, concerts). robots.txt allows it (checked 2026-11-06).
  {
    url: "https://www.alimentation-generale.net/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "dj_night"],
    label: "L'Alimentation Générale",
    onlyHere: true,
    venuePage: true,
    venueAddress: "L'Alimentation Générale, 64 rue Jean-Pierre Timbaud, 75011 Paris",
    mixedCalendar: true,
  },
  // Rock 4 You: the city's biggest rock 4 temps school; its agenda page lists dated nights as text (Rock That Boat every Monday at Péniche Concorde Atlantique, Rock That Loft, Rock That STAPS). robots.txt allows it (checked 2026-11-06).
  // Every night it lists is a dance night, so it is not a mixed calendar (2026-11-07).
  {
    url: "https://www.rock4you.dance/soirees-rock-paris",
    kind: "html",
    trustTier: "first_party",
    styles: ["rock_n_roll"],
    label: "Rock 4 You",
    onlyHere: true,
  },
  // Eventbrite organisers found by the blocked-platform sweep (D-131, D-758), each with recurring Paris nights.
  eventbrite("https://www.eventbrite.com/o/11869620777", "VIDEO PARIS KIZOMBA (Eventbrite)", [
    "kizomba",
    "kompa",
  ]),
  eventbrite("https://www.eventbrite.fr/o/113172966841", "LovEcstatic Dance Paris (Eventbrite)", [
    "ecstatic_dance",
  ]),
  // Eventbrite sweep 2026-11-07 (12 style searches on eventbrite.fr/d/france--paris, 88 organisers, mostly not dance):
  // LA SUNDAY, the Maya Club's weekly Sunday club night (hip-hop, afro, caribbean; Champigny-sur-Marne), and AFRO
  // SUNSET ("on danse, on chante"), Friday afro nights in the 18th.
  // Not a mixed calendar: its own weekly club night; screened as one, run 42450876185 dropped both LA SUNDAY rows.
  {
    url: "https://www.eventbrite.fr/o/47098959913",
    kind: "ticketing_api",
    trustTier: "ticketing",
    platform: "eventbrite",
    styles: ["hip_hop_club", "afrobeats_club", "dancehall"],
    label: "LA SUNDAY at Maya Club (Eventbrite)",
  },
  eventbrite("https://www.eventbrite.com/o/121838998378", "AFRO SUNSET (Eventbrite)", [
    "afrobeats_club",
  ]),
];

/** Starting addresses retired, each with the reason (D-047). */
export const PARIS_RETIRED: readonly RetiredSource[] = [
  ...DICE_GENRES.filter(([path]) => !PARIS_DICE_GENRES.has(path)).map(([path]) => ({
    url: `${DICE_BROWSE}/${path}`,
    reason:
      "DICE has no Paris page for this genre: it answers a 307 redirect to the gig list (checked 2026-11-06)",
  })),
  // Found by discovery on the first Paris run (run 42168574904, 2026-11-06); checked by hand the same day.
  {
    url: "https://lanuit.club/",
    reason:
      "a nightclub whose events iCalendar feed (/events/?ical=1) answers an empty page; its agenda is sold on Shotgun (checked 2026-11-06)",
  },
  {
    url: "https://levelparis.fr/",
    reason:
      "a hip-hop and afro nightclub whose events iCalendar feed (/event/?ical=1) answers an empty page (checked 2026-11-06)",
  },
  {
    url: "https://ohhappyparis.com/contact/#formulaire",
    reason:
      "a cabaret restaurant's contact page, not a dance listing; its iCalendar feed answers an empty page (checked 2026-11-06)",
  },
  {
    url: "https://lillysclub.com/",
    reason: "its Squarespace events page answers 404 (checked 2026-11-06)",
  },
  {
    url: "https://salsacaraibes.fr/",
    reason:
      "the site (moved from salsacaraibes.free.fr) answers 404 to the reader and 403 to a plain request (checked 2026-11-06)",
  },
  // Retired after the first full read (run 42342837658, 2026-11-07); checked by hand the same day.
  {
    url: "https://www.titipalacio.com/",
    reason:
      "the home page no longer lists its nights ('2 fois par mois', details on Instagram only) and its JSON-LD is a Restaurant (checked 2026-11-07)",
  },
  {
    url: "https://aufutetamesure.fr/",
    reason: "the events page answers 404 to the reader (checked 2026-11-07)",
  },
  {
    url: "https://www.cesanneesla.com/",
    reason: "the feed it named is not an iCalendar file (checked 2026-11-07)",
  },
  {
    url: "https://www.alfortville.fr/logement-social",
    reason: "a town hall's social-housing page, not a dance listing (checked 2026-11-07)",
  },
  {
    url: "https://www.privateaser.com/reservation-bar/top-beer-pong-bars-paris",
    reason: "a booking site's beer-pong bar list, not a dance listing (checked 2026-11-07)",
  },
  {
    url: "https://tango-argentin.fr/daymilongas",
    reason:
      "replaced by the Ile-de-France agenda (D-1044, #1248), which lists tonight and about 8 weeks ahead (checked 2026-11-08)",
  },
  {
    url: "https://redzone-bar.com/agenda/",
    reason:
      "found by discovery; a fetish bar's agenda ('FETISH', 'XXL LOVERS' parties), no dance night (cities-11 new-sources check, diag 43071486024, 2026-11-12)",
  },
  {
    url: "https://raiddbar.com/en/index.html",
    reason:
      "found by discovery; a bar whose rows are live shows ('Live Show Malyia', 'Live Show Monteiro'), no style, no weekly DJ or dance night (checked 2026-11-07; diag 43071486024, 2026-11-12)",
  },
  {
    url: "https://www.sortiracourbevoie.fr/voir/tous",
    reason:
      "found by discovery; a town's general outings listing (its one row 'Sonny Gullage' is a concert), not a dance listing (diag 43071486024, 2026-11-12)",
  },
  // Found by discovery (2026-11-12): concert venues, a show and a children's class (cities sweep 2026-11-13).
  {
    url: "https://www.newmorning.com/",
    reason:
      'New Morning: a jazz and soul concert club ("Leee John of Imagination", "Nubiyan Twist"), not dance nights (cities sweep 2026-11-13)',
  },
  {
    url: "https://studiolaccordparfait.com/",
    reason:
      'Studio L\'Accord Parfait: concerts ("LE RYTHME DE LA VILLE", "TERRE DE MUSIQUES OP.1"), not dance nights (cities sweep 2026-11-13)',
  },
  {
    url: "https://www.tresmixity.com/",
    reason:
      'Très Mixity: a stage show ("Mixity: Fait son Show !"), not a dance night (cities sweep 2026-11-13)',
  },
  {
    url: "http://www.leregarducygne.com",
    reason:
      'Le Regard du Cygne: a weekly class for children aged 3 to 5 ("Cours Hebdo - Éveil danse 3/5 ans"), not a dance night (cities sweep 2026-11-13)',
  },
  {
    url: "http://www.sunset-sunside.com/",
    reason:
      'Sunset-Sunside: a jazz club ("Jazz & Goûter fête la musique brésilienne"), not dance nights (cities sweep 2026-11-13)',
  },
  // Found by discovery: a children's activity centre, a poetry agenda and a sustainability centre, not dance nights (cities sweep 2026-11-14).
  {
    url: "https://apprends-et-reve.fr/",
    reason:
      'Apprends et Rêve: children\'s and teens\' after-school activities ("5-7 ans: Mercredi multi activités", "Danse Street Jazz ADOS"), not dance nights (cities sweep 2026-11-14)',
  },
  {
    url: "https://www.agora.paris/lagendadelagora.html",
    reason:
      "L'Agora's agenda: talks and spoken word (\"L'autolouange, une parole pour traverser\"), not dance nights (cities sweep 2026-11-14)",
  },
  {
    url: "https://www.maison-developpement-durable.org/",
    reason:
      "Maison du développement durable: a sustainability centre; failed every read and holds no listings (cities sweep 2026-11-14)",
  },
];
