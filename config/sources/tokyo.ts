// Tokyo's starting sources (D-1220, D-1221). Japan is read under the US tier (standing answer D-520): official
// APIs, public pages and feeds, robots.txt honoured, no bot-wall workarounds; Facebook and Instagram never;
// Resident Advisor only through its GraphQL endpoint (D-505, area 27). Peatix (captcha), iFLYER, Clubberia,
// ZAIKO, LivePocket and Time Out Tokyo (terms bar reuse) wait for the owner's permission emails (2026-11-07).
// First sources D-1228 (2026-11-07).
// Google Calendars through the Calendar API (D-130), not their robots-blocked ICS: D-1231 (2026-11-07).

import type { RetiredSource, SeedSource } from "@/config/sources/nyc";
import type { StyleKey } from "@/config/styles";

const ECL_CITED =
  "own Instagram @elcafelatinojapan, November calendar posted 2026-10-31: lessons Tue-Sat then 'SOCIAL TIME STARTS AFTER LESSON / レッスン後、ソーシャルタイムとなります'; bio 'Dance classes & social' (hand-checked in the owner's browser 2026-11-09, D-796)";

/** A directory page: pointers, never the organiser's own word (D-061, D-072). */
const directory = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "directory",
  styles,
  label,
});

/** A venue's or organiser's own page: its own word (D-061). */
const page = (url: string, label: string, styles: StyleKey[]): SeedSource => ({
  url,
  kind: "html",
  trustTier: "first_party",
  styles,
  label,
});

/** A Meetup group's own iCalendar feed (D-035 Q6: no Pro). robots.txt allows /events/ical/ (2026-11-07). */
const meetup = (group: string, label: string, styles: StyleKey[]): SeedSource => ({
  url: `https://www.meetup.com/${group}/events/`,
  kind: "feed_ics",
  feedUrl: `https://www.meetup.com/${group}/events/ical/`,
  trustTier: "first_party",
  styles,
  label,
  mixedCalendar: true,
});

export const TOKYO_SOURCES: readonly SeedSource[] = [
  // Salsa Vida's Tokyo guide (the owner approved Salsa Vida's terms, 2026-10-31; robots.txt allows all, checked
  // 2026-11-07; 24 schema.org Events in the ItemList on 11/07; lists only dance nights, D-321/D-772):
  {
    ...directory("https://www.salsavida.com/guides/japan/tokyo/", "Salsa Vida Tokyo", [
      "salsa",
      "bachata",
      "kizomba",
    ]),
    mixedCalendar: false,
  },
  // Studio Pepe, Roppongi (its event table, dated salsa and bachata nights through 12/13; robots.txt disallows
  // /wp/wp-admin/ only):
  {
    ...page("https://studio-pepe.com/event.html", "Studio Pepe", ["salsa", "bachata"]),
    venueAddress: "〒106-0032 東京都港区六本木7-17-12",
    venuePage: true,
    onlyHere: true,
  },
  // ZOUK TOKYO, Ginza (D-1238): its own home page carries schema.org MusicEvent JSON-LD for each dated club night
  // (Wed-Sat, doors 22:00; 18 events on 2026-11-10) and NightClub opening hours Wed/Thu 22:00-04:00, Fri/Sat
  // 22:00-04:30. Dated nights only, no house hours. robots.txt allows / (disallows /api/ only), 2026-11-10.
  {
    ...page("https://www.zoukgrouptky.com/", "ZOUK TOKYO", ["dj_night"]),
    venueAddress: "〒104-0061 東京都中央区銀座7-2-18 グランベルスクエア B2F/B3F",
    venuePage: true,
    onlyHere: true,
  },
  // AiSOTOPE LOUNGE, Shinjuku 2-chome (D-1238): a queer club whose home page carries schema.org Event JSON-LD for
  // each dated night (~43 on 2026-11-10). It also lists live shows, one-man concerts and karaoke/歌謡 bar nights,
  // so it is a mixed calendar (D-589). robots.txt disallows /wp-admin/ only, 2026-11-10.
  {
    ...page("https://aisotope-lounge.net/", "AiSOTOPE LOUNGE", ["queer_party", "dj_night"]),
    venueAddress: "〒160-0022 東京都新宿区新宿2-12-16 セントフォービル1F",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
  },
  // MAHARAJA Roppongi (D-1239): a disco whose own schedule page (WordPress calendar, plain HTML) lists a dated night
  // nearly every evening ("19:00 DISCO 80's", "MAHARAJA NIGHT"), with some afternoon events, 歌謡曲 and metal nights
  // and private hires. Its old domain maharaja-roppongi.com no longer resolves.
  // robots.txt disallows /wp/wp-admin/ only, 2026-11-10.
  // Not a mixed calendar (D-1243): as one, its own disco nights that name no dance ("BLACK HOLE", "SOUL STEP
  // NIGHT", "MAHARAJA 16th Anniversary DAY4", 19:00-23:30) were screened as concerts on read 43111991277
  // (2026-11-11), leaving nothing for a week. Every night on the floor is a DJ disco night; private hires (貸切)
  // are screened by title, and the metal night is listed below.
  {
    ...page("https://maharaja-r.jp/schedule2/", "MAHARAJA Roppongi", ["disco", "dj_night"]),
    venueAddress: "〒106-0032 東京都港区六本木6-1-3 六門ビル6F",
    venuePage: true,
    onlyHere: true,
    notDanceNights: ["HEAVY METAL NIGHT*"],
  },
  // KENTO'S Ginza (D-1239): an oldies live-band club, a house band every night. Its own schedule page names only
  // the band for each date, with no time, so the opening hours its own top page prints are listed as the night.
  // robots.txt disallows /wp-admin/ only, 2026-11-10.
  {
    ...page("https://ginza.kentos-group.co.jp/", "KENTO'S Ginza", ["rock_n_roll"]),
    venueAddress: "〒104-0061 東京都中央区銀座8-2-1 ニッタビル9F",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    bandsForDancers: true,
    fixedNights: [
      {
        title: "Oldies live bands at KENTO'S Ginza",
        line: "MONDAY-SATURDAY 18:00～late-night",
        days: [1, 2, 3, 4, 5, 6],
        start: "18:00",
        danceCited:
          "own site, https://ginza.kentos-group.co.jp/: 'グラスを傾けながら聞くも良し、踊るも良し。' (2026-11-10)",
      },
      {
        title: "Sunday oldies live bands at KENTO'S Ginza",
        line: "SUNDAY & HOLIDAY 18:00～23:30",
        days: [0],
        start: "18:00",
        end: "23:30",
        danceCited:
          "own site, https://ginza.kentos-group.co.jp/: 'グラスを傾けながら聞くも良し、踊るも良し。' (2026-11-10)",
      },
    ],
  },
  // Club Salud!, Nippori (weekly grid on its home page; rows marked 休講中 are paused; robots.txt 404):
  {
    ...page("https://www.club-salud.com/", "Club Salud", ["salsa", "bachata", "brazilian_zouk"]),
    venueAddress: "〒116-0014 東京都荒川区東日暮里6-60-9 日暮里駅前ビル3F",
    venuePage: true,
    onlyHere: true,
  },
  // Latin Club Leon, Shinjuku: its event page lists dated nights by month (11月2日（月）SALSA on 2, Mon kizomba,
  // Wed salsa & bachata, Fri Noche de Salsa, Sat zouk); Shift_JIS; http only (https fails); robots.txt 404
  // (checked 2026-11-07).
  {
    ...page("http://www.latinclub-leon.com/event.html", "Latin Club Leon", [
      "salsa",
      "bachata",
      "kizomba",
      "brazilian_zouk",
    ]),
    venueAddress: "〒160-0022 東京都新宿区新宿5-17-6 B1",
    venuePage: true,
    onlyHere: true,
  },
  // Las Risas's own Google Calendar (embed src latinbarlasrisas@gmail.com on its home page; its dated
  // lessons, parties and closures; robots.txt 404, checked 2026-11-07), read through the API (D-130):
  {
    ...page("https://www.lasrisas.com/", "Las Risas calendar", ["salsa", "bachata"]),
    kind: "feed_gcal",
    platform: "feed_gcal",
    venueAddress: "〒104-0061 東京都中央区銀座8-12-6 小野商ビルB1F",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // Checked on the calendar's descriptions (read 42420733466, D-1233): a Tuesday bachata and salsa lesson with
    // free dancing, and a Cuban salsa and rueda night.
    danceNights: ["お昼のレッスン＆フリータイム有", "GOZARISAS in Latin Bar Las Risas"],
  },
  // Studio JBA, Nihonbashi: its schedule page is only a Google Calendar embed (one calendar, ~25 recurring
  // salsa, bachata and kizomba series; robots.txt disallows /wp-admin/ only, checked 2026-11-07), read
  // through the API (D-130). Address from its own site (日本橋大伝馬町11-8 HATビル), postcode of the town:
  {
    ...page("https://studiojba.com/schedule/", "Studio JBA", ["salsa", "bachata", "kizomba"]),
    kind: "feed_gcal",
    platform: "feed_gcal",
    venueAddress: "〒103-0011 東京都中央区日本橋大伝馬町11-8 HATビルB1F",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // Its own nights whose titles name no dance in English, checked on the calendar's descriptions (read
    // 42420733466, D-1233; マンボ and キゾバチャ are style words since D-783); its "pv" rows are private lessons and
    // stay screened.
    danceNights: ["4ダンサーズナイト", "SMILESALSA", "アタルンバ", "朝活ON2！Byまっつん"],
    // Studio rental slots, not dance nights (new-sources check 2026-11-12, D-1244).
    notDanceNights: ["スタジオ貸し*"],
  },
  // Dance Hall Shinseiki, Uguisudani: a ballroom social-dance hall; its schedule page always shows the current
  // month, one row per day (bands, hours 12:00-20:00, entry price; 23 open days in 11/2026). Days marked 店休日
  // are closed to dancing and rented for concerts, hence mixedCalendar. Shift_JIS; robots.txt 404 (checked
  // 2026-11-07, D-1232):
  {
    ...page("http://bossiweb.com/shinseiki/schedule/schedule.php", "Dance Hall Shinseiki", [
      "ballroom",
    ]),
    venueAddress: "〒110-0003 東京都台東区根岸1-1-14",
    venuePage: true,
    onlyHere: true,
    mixedCalendar: true,
    // A ballroom hall whose bands play for dancers; its 店休日 concert rentals were not read as nights (D-1233).
    bandsForDancers: true,
  },
  // Hand-checked own-Instagram weekly nights (D-796/D-797): no request is made; each night lists for 35 days from
  // checkedOn, then drops with a "recheck" note. Read by hand in the owner's Chrome by the Chrome audit chat (wave 4-8).
  // Egoland Bar Akihabara: "El Jueves De Salsa", every Thursday, beginner salsa lesson 19:30 then party 20:30-23:30.
  // Its "Akihabara Salsa" every 2nd and 4th Wednesday (lesson 19:30, party 20:30-23:30) lists as a fixed monthly night
  // (weeksOfMonth, D-827; hand-checked 2026-11-10). Address: config/known-venues.ts (Egoland).
  {
    url: "https://www.instagram.com/egoland_latin/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa"],
    platform: "probed",
    label: "Egoland Bar Akihabara (Instagram)",
    venueAddress: "〒101-0025 東京都千代田区神田佐久間町4-7-3 2F",
    venuePage: true,
    onlyHere: true,
    handChecked: true,
    fixedNights: [
      {
        title: "El Jueves De Salsa at Egoland",
        line: "Every Thursday: Salsa On1 beginner lesson 19:30-20:20, party 20:30-23:30",
        days: [4],
        start: "19:30",
        end: "23:30",
        danceCited:
          "own Instagram @egoland_latin (Egoland Bar Akihabara's Latin account), post 2026-11-08: '木曜サルサ｜El Jueves De Salsa 毎週木曜日 開催 ... 19:30–20:20 Salsa on1 ビギナーレッスン ... 20:30–23:30 はパーティータイム' (hand-checked in the owner's browser 2026-11-09, D-796)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/Dfdejupi3Z1/",
      },
      {
        title: "Akihabara Salsa at Egoland",
        line: "Every 2nd and 4th Wednesday: beginner lesson 19:30-20:20, salsa/bachata/merengue party 20:30-23:30",
        days: [3],
        weeksOfMonth: [2, 4],
        start: "19:30",
        end: "23:30",
        danceCited:
          "own Instagram @egoland_latin (Egoland Bar Akihabara's Latin account), post 2026-11-05: '毎月第2、第4水曜日に秋葉原で、ラテンイベントを開催しています。 ... 選曲は、サルサ、バチャータ、メレンゲをバランスよくかけています' and 2026-10-22: 'Akihabara Salsa Party 20:30～23:30' (hand-checked in the owner's browser 2026-11-10, D-796, D-827)",
        checkedOn: "2026-11-10",
        evidenceUrl: "https://www.instagram.com/p/DfXYOPRJtU5/",
      },
    ],
  },
  // El Cafe Latino, Roppongi: a lesson each night Tue-Sat, then a social. Only nights whose lesson end is posted are
  // listed (Tue/Thu/Fri lessons 19:30-21:00, Sat 18:00-20:00); Monday "SOCIAL ONLY" and Wednesday carry no time.
  // Address: config/known-venues.ts (El Cafe Latino).
  {
    url: "https://www.instagram.com/elcafelatinojapan/",
    kind: "html",
    trustTier: "first_party",
    styles: ["salsa", "bachata"],
    platform: "probed",
    label: "El Cafe Latino (Instagram)",
    venueAddress: "〒106-0032 東京都港区六本木3-15-24 WIN六本木1F",
    venuePage: true,
    onlyHere: true,
    handChecked: true,
    fixedNights: [
      {
        title: "Latin Social at El Cafe Latino",
        line: "Tue/Thu/Fri: lesson 19:30-21:00, then social time",
        days: [2, 4, 5],
        start: "21:00",
        danceCited: ECL_CITED,
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfJUYj5TaeO/",
      },
      {
        title: "Saturday Latin Social at El Cafe Latino",
        line: "Saturday: lesson 18:00-20:00, then social time",
        days: [6],
        start: "20:00",
        danceCited: ECL_CITED,
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfJUYj5TaeO/",
      },
    ],
  },
  // Arty Farty, Shinjuku 2-chome (D-1239): a gay club and DJ bar. Its own site (artyfarty.jp) has no schedule; its
  // own Instagram bio gives "Fri Sat 20:00-5:00" and a post says resident DJs play every Friday and Saturday.
  // Closed Wednesday and Thursday; Sun-Tue bar nights are not listed. Hand-checked (D-796).
  {
    url: "https://www.instagram.com/artyfarty_tokyo/",
    kind: "html",
    trustTier: "first_party",
    styles: ["queer_party", "dj_night"],
    platform: "probed",
    label: "Arty Farty (Instagram)",
    venueAddress: "〒160-0022 東京都新宿区新宿2-11-7 2F",
    venuePage: true,
    onlyHere: true,
    handChecked: true,
    fixedNights: [
      {
        title: "Arty Farty Friday and Saturday DJs",
        line: "Fri & Sat: resident DJs, 20:00-05:00",
        days: [5, 6],
        start: "20:00",
        end: "05:00",
        danceCited:
          "own Instagram @artyfarty_tokyo: bio 'Fri Sat 20:00-5:00'; post 2026-10-29: 'Plus, our resident DJs every Fri & Sat! ... もちろん金土はレギュラーDJ陣がフロアを盛り上げます' (hand-checked in the owner's browser 2026-11-09, D-796)",
        checkedOn: "2026-11-09",
        evidenceUrl: "https://www.instagram.com/p/DfELfkByPQQ/",
      },
    ],
  },
  // Meetup groups (robots.txt does not disallow /events/ical/, checked 2026-11-07; feeds answered 200 with
  // VEVENTs; feeds carry no LOCATION):
  meetup("tokyo-bachata-dance", "Tokyo Bachata Dance (Meetup)", ["bachata"]),
  meetup("salsatokyo", "Salsa Tokyo (Meetup)", ["salsa", "bachata"]),
  meetup("bachatatokyo", "Bachata Tokyo (Meetup)", ["bachata"]),
  meetup("salsa-cuban-style-in-tokyo", "Salsa Cuban Style in Tokyo (Meetup)", ["salsa"]),
  meetup("tokyo-salsa-lessons", "Tokyo Salsa Lessons (Meetup)", ["salsa", "bachata"]),
  // Zouk and bachata lessons with DJ socials, Shibuya and Roppongi (2 VEVENTs on 2026-11-07, D-1232):
  meetup("tokyo-bachata-salsa-zouk-meetup-group", "Tokyo Bachata Salsa Zouk (Meetup)", [
    "brazilian_zouk",
    "bachata",
  ]),
];

export const TOKYO_RETIRED: readonly RetiredSource[] = [
  {
    url: "https://www.fiesta-latinspotbar.com/",
    reason:
      "Weekly text with no dated night (第1＆3水曜日), so nothing was written (read 42420733466, D-1233); Salsa Vida lists its Bachasalsa Night.",
  },
  {
    url: "https://www.lasrisas.com/lesson.html",
    reason:
      "A weekday grid with no dates wrote nothing (read 42420733466, D-1233); Las Risas's own Google Calendar gives the dated nights.",
  },
];
