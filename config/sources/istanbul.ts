// Istanbul's starting sources (D-680). Turkey is read under the US tier (owner, 2026-10-31: "treat all legally
// like the US"): official APIs, public pages and feeds, robots.txt honoured, no bot-wall workarounds; Facebook
// and Instagram never; Resident Advisor only through its GraphQL endpoint (D-505, area 73). Ticket sites wait
// for the owner's own terms reading (Biletix, Passo, Bubilet, Biletinial, Mobilet; Biletino answers 403
// to our bot). Bugece and Salsa Vida were approved by the owner on 2026-10-31. Salsa Vida is a directory (owner
// approved its terms, 2026-10-31); the daily run seeds venues and discovers their websites (D-120).
// Own sites added from the D-524 gap report (D-686): Babylon, Swing Planet, Tango Noa.

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
  mixedCalendar: true,
});

export const ISTANBUL_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Istanbul guide (owner read the terms and approved it, 2026-10-31). schema.org Events in its JSON-LD:
  // on 10/31 six nights over two weeks, Sun Boulevard 216 Terrace, Tue Jolly Joker Kanyon (Centro Latin Night),
  // Thu Hully's House (bachata). robots.txt allows it (User-agent: * / Disallow: empty, checked 2026-10-31).
  // Left out: its /lessons/ page, which on 10/31 listed only a five-day hotel bachata festival (not a night out).
  // Salsa Vida lists only dance nights: not a mixed calendar, so a night whose title names no dance ("Noche Habanera") stays (D-772).
  {
    ...directory("https://www.salsavida.com/guides/turkey/istanbul/", "Salsa Vida Istanbul", [
      "salsa",
      "bachata",
    ]),
    mixedCalendar: false,
  },
  // Babylon, Bomonti (Şişli): concerts and parties ("Parti" rows: Balkan Wedding Party, Radyo Eksen Partisi,
  // Flashback 90'lar), so screened as a mixed calendar. The home page lists dated rows (no times); each row links
  // its own page, whose schema.org MusicEvent JSON-LD gives the start (D-275). robots.txt allows all (2026-10-31).
  {
    url: "https://www.babylon.com.tr/",
    kind: "html",
    trustTier: "first_party",
    styles: ["dj_night"],
    label: "Babylon",
    venuePage: true,
    venueAddress: "Merkez Mah. Silahşör Cad. Birahane Sk. No:1, Bomonti, 34384 Şişli/İstanbul",
    onlyHere: true,
    mixedCalendar: true,
    eventPageTimes: true,
  },
  // Swing Planet (Lindy Hop school, studios in Bomonti and Kadıköy): its "Dersler ve Etkinlikler" page lists dated
  // parties under "Yaklaşan Etkinlikler" (Sat 11-07 Swing Jazz Night @Nevada Moda) and two free weekly practicas,
  // Wed 20:30-22:30 Bomonti and Fri 20:45-22:30 Kadıköy; its dated course starts are classes. Parties are at other
  // venues, so not a venue page. robots.txt (Wix) allows it (2026-10-31).
  // The practicas are fixed nights at the two studios (run 41238208680 left all 17 rows unplaced).
  {
    url: "https://www.swingplanet.com.tr/dersler-ve-etkinlikler",
    kind: "html",
    trustTier: "first_party",
    styles: ["lindy_hop"],
    label: "Swing Planet",
    mixedCalendar: true,
    // The page's "Haftalık Ders ve Pratik Programı" states the two free practicas, one per studio (2026-10-31).
    // The model gives them no venue and reads "haftanın hemen her günü" as a daily Solo Jazz class, so both are
    // config-stated nights placed at the studios (Known Venues), replacing the model's rows of those titles.
    fixedNights: [
      {
        title: "Swing Planet Lindy Hop Pratik (Bomonti)",
        line: "Şişli Bomonti stüdyomuzda her çarşamba 20.30-22.30 arasında ücretsiz pratik yapıyoruz",
        days: [3],
        start: "20:30",
        end: "22:30",
        danceCited: "own site, https://www.swingplanet.com.tr/dersler-ve-etkinlikler (2026-10-31)",
        replacesTitles: ["Ücretsiz Pratik", "Solo Jazz Dersleri"],
      },
      {
        title: "Swing Planet Lindy Hop Pratik (Kadıköy)",
        line: "Kadıköy stüdyomuzda her cuma 20.45-22.30 arasında ücretsiz pratik yapıyoruz",
        days: [5],
        start: "20:45",
        end: "22:30",
        danceCited: "own site, https://www.swingplanet.com.tr/dersler-ve-etkinlikler (2026-10-31)",
        replacesTitles: ["Ücretsiz Pratik", "Solo Jazz Dersleri"],
      },
    ],
    titleVenues: { Bomonti: "Swing Planet Bomonti", Kadıköy: "Swing Planet Kadıköy" },
  },
  // Tango Noa, Beyoğlu (tango school): its Etkinlikler page is a weekly grid under English weekday headings,
  // "Saturday: Milonga El Huracán" and "Monday: Practilonga", no dates or times (D-402, read as weekly nights,
  // untimed). robots.txt disallows only /wp-admin/ (2026-10-31).
  {
    url: "https://tangonoa.com/etkinlikler/",
    kind: "html",
    trustTier: "first_party",
    styles: ["tango", "milonga", "practica"],
    label: "Tango Noa",
    venuePage: true,
    venueAddress: "Serdar-ı Ekrem Cd. No:5, Şahkulu, 34421 Beyoğlu/İstanbul",
    onlyHere: true,
    weeklyGrid: true,
  },
  // TangoDANS (tango school) "İstanbul Milongaları": a weekly grid of nine milongas under Turkish weekday headings,
  // each with venue, area and hours (Mon Armada Otel; Wed 333, Tormenta Kadıköy; Thu Zeytuna, Tango Mia; Fri
  // Milongahane, Tangoist; Sat Tango Mia; Sun Tango Mia practica 17:00-21:00), no dates: read as weekly nights
  // (D-402). A directory, not the organisers' own word. robots.txt allows it and the site has no terms page
  // (checked 2026-10-31).
  {
    ...directory("https://tangodans.com/en/milongas", "TangoDANS milonga list", [
      "tango",
      "milonga",
    ]),
    weeklyGrid: true,
    // A milonga list: every row is a tango night, so not screened as a mixed calendar (cov-82, 2026-10-31).
    mixedCalendar: false,
    // The Monday row: the model titles it "Armada Otel Milonga", which the page does not write, so it is stated here.
    fixedNights: [
      {
        title: "TangoDANS Monday Milonga at Armada Otel",
        line: "Armada Otel / Sultanahmet / Ahırkapı Restaurant / İstanbul",
        days: [1],
        start: "21:00",
        end: "01:00",
        styles: ["tango", "milonga"],
        danceCited:
          "TangoDANS İstanbul Milongaları, https://tangodans.com/en/milongas, Pazartesi row (2026-10-31)",
        replacesTitles: ["Armada Otel Milonga"],
      },
    ],
    titleVenues: {
      "Tango Mia": "Tango Mia",
      "Milonga 333": "333 Milonga",
      Tormenta: "Milonga Tormenta",
      Zeytuna: "Zeytuna Cezayir'de",
      Milongahane: "Bora Erdem Dans Cafe",
      Tangoist: "Tangoist",
      Armada: "Armada Otel",
    },
  },
];

/** Starting addresses retired, each with the reason (D-047). */
export const ISTANBUL_RETIRED: readonly RetiredSource[] = [
  // Found by discovery (D-120), read from Istanbul's first daily runs.
  {
    url: "https://www.onnumaracafe.com/",
    reason:
      "its The Events Calendar address (wp-json/tribe/events/v1) answers 404 on 5 runs in a row from 2026-10-31 (last 41206926207), and the home page lists no events",
  },
];
