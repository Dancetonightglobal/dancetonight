// Held-out pages for the link matcher (D-073, B6): layouts its rules were NOT tuned on, written by
// hand after the rules were fixed, in the shapes the common site builders print (WordPress's
// The Events Calendar, Wix, Squarespace's events collection, an Eventbrite embed, a weekly
// schedule table, a directory of other people's nights), plus the traps a real page sets. Each is
// run through the real cleanPageText. `expect` is the listing's own link, or null where a careful
// reader would attach none. Zero wrong links is the bar; a miss is allowed and counted.
//
// The real pages in evals/links/pages that are not among the 14 tuned ones (nycwcs.com,
// kizombaembassy.com, nuevotangoarts.org) are held out too: every heading-like line on them is
// asked for as a title (`heldOutRealPages`), and none may be given a link that is not its own.

import type { DateOrder } from "@/src/domain/event-link-matcher";

export interface HeldOutCase {
  title: string;
  /** The listing's night, or null for a rule's listing. */
  date: string | null;
  expect: string | null;
}

export interface HeldOutPage {
  name: string;
  url: string;
  dateOrder: DateOrder | null;
  html: string;
  cases: HeldOutCase[];
}

const TRIBE = "https://salsaclub.example";

export const HELD_OUT: HeldOutPage[] = [
  {
    name: "WordPress The Events Calendar, list view, with a recurring series",
    url: `${TRIBE}/events/list/`,
    dateOrder: "mdy",
    html: `<main><h2>Upcoming Events</h2>
<article><h3><a href="${TRIBE}/event/friday-salsa-social/2026-10-02/">Friday Salsa Social</a></h3>
<div><time>October 2 @ 9:00 pm - 1:00 am</time> <span>Recurring</span></div>
<address><a href="${TRIBE}/venue/studio-54th/">Studio 54th</a> 250 W 54th St, New York</address>
<p>Beginner lesson at 9, then social dancing until late.</p>
<a href="${TRIBE}/event/friday-salsa-social/2026-10-02/">Find out more »</a></article>
<article><h3><a href="${TRIBE}/event/friday-salsa-social/2026-10-09/">Friday Salsa Social</a></h3>
<div><time>October 9 @ 9:00 pm - 1:00 am</time> <span>Recurring</span></div>
<address><a href="${TRIBE}/venue/studio-54th/">Studio 54th</a></address>
<a href="${TRIBE}/event/friday-salsa-social/2026-10-09/">Find out more »</a></article>
<article><h3><a href="${TRIBE}/event/on2-bootcamp/">On2 Bootcamp with Maria</a></h3>
<div><time>October 3 @ 1:00 pm - 5:00 pm</time></div>
<address><a href="${TRIBE}/venue/studio-54th/">Studio 54th</a></address>
<p>Organized by <a href="${TRIBE}/organizer/maria-t/">Maria T</a></p>
<a href="${TRIBE}/event/on2-bootcamp/">Find out more »</a></article>
<nav><a href="${TRIBE}/events/list/?tribe-bar-date=2026-10-10">Next Events »</a></nav></main>`,
    cases: [
      {
        title: "Friday Salsa Social",
        date: "2026-10-02",
        expect: `${TRIBE}/event/friday-salsa-social/2026-10-02/`,
      },
      {
        title: "Friday Salsa Social",
        date: "2026-10-09",
        expect: `${TRIBE}/event/friday-salsa-social/2026-10-09/`,
      },
      // A rule read from the same page: every link is one night's.
      { title: "Friday Salsa Social", date: null, expect: null },
      {
        title: "On2 Bootcamp with Maria",
        date: "2026-10-03",
        expect: `${TRIBE}/event/on2-bootcamp/`,
      },
    ],
  },
  {
    name: "A studio's page of Eventbrite embeds",
    url: "https://lindyloft.example/socials",
    dateOrder: "mdy",
    html: `<body><h1>Socials at the Loft</h1>
<div class="card"><h4>Loft Lindy Night</h4><p>Sat, Oct 3, 8:00 PM</p>
<a href="https://www.eventbrite.com/e/loft-lindy-night-tickets-889900112233?aff=ebdsoporgprofile">Get tickets</a></div>
<div class="card"><h4>Balboa Brunch Social</h4><p>Sun, Oct 4, 11:00 AM</p>
<a href="https://www.eventbrite.com/e/balboa-brunch-social-tickets-889900114455?aff=ebdsoporgprofile">Get tickets</a></div>
<div class="card"><h4>Blues Underground</h4><p>Thu, Oct 8, 9:00 PM</p><p>Tickets at the door.</p></div>
<p><a href="https://www.eventbrite.com/o/lindy-loft-44556677">See all our events on Eventbrite</a></p></body>`,
    cases: [
      {
        title: "Loft Lindy Night",
        date: "2026-10-03",
        expect:
          "https://www.eventbrite.com/e/loft-lindy-night-tickets-889900112233?aff=ebdsoporgprofile",
      },
      {
        title: "Balboa Brunch Social",
        date: "2026-10-04",
        expect:
          "https://www.eventbrite.com/e/balboa-brunch-social-tickets-889900114455?aff=ebdsoporgprofile",
      },
      { title: "Blues Underground", date: "2026-10-08", expect: null },
      // A rule's listing never gets one night's ticket page.
      { title: "Loft Lindy Night", date: null, expect: null },
    ],
  },
  {
    name: "Wix events list",
    url: "https://www.kizzclub.example/events",
    dateOrder: "mdy",
    html: `<main><ul>
<li><div><h2>Kizomba Fusion Night</h2><p>Oct 03, 2026, 8:00 PM – 11:30 PM</p><p>Dance Space NYC, 10 W 20th St</p>
<a href="https://www.kizzclub.example/event-details/kizomba-fusion-night-2026-10-03-20-00">RSVP</a>
<a href="https://www.kizzclub.example/event-details/kizomba-fusion-night-2026-10-03-20-00">Details</a></div></li>
<li><div><h2>Urban Kiz Workshop</h2><p>Oct 10, 2026, 2:00 PM – 5:00 PM</p><p>Dance Space NYC</p>
<a href="https://www.kizzclub.example/event-details/urban-kiz-workshop-2026-10-10-14-00">RSVP</a>
<a href="https://www.kizzclub.example/event-details/urban-kiz-workshop-2026-10-10-14-00">Details</a></div></li>
</ul></main>`,
    cases: [
      {
        title: "Kizomba Fusion Night",
        date: "2026-10-03",
        expect: "https://www.kizzclub.example/event-details/kizomba-fusion-night-2026-10-03-20-00",
      },
      {
        title: "Urban Kiz Workshop",
        date: "2026-10-10",
        expect: "https://www.kizzclub.example/event-details/urban-kiz-workshop-2026-10-10-14-00",
      },
      // The model dated the workshop a week early: its link carries Oct 10.
      { title: "Urban Kiz Workshop", date: "2026-10-03", expect: null },
    ],
  },
  {
    name: "Squarespace events collection, list view",
    url: "https://www.swingtime.example/events",
    dateOrder: "mdy",
    html: `<main><article class="eventlist-event">
<h1><a href="/events/harlem-hop-october">Harlem Hop</a></h1>
<ul><li><time>Friday, October 2, 2026</time> <time>8:00 PM</time> <time>11:00 PM</time></li>
<li>Minton's Playhouse <a href="http://maps.google.com?q=206%20W%20118th%20St">(map)</a></li>
<li><a href="https://www.google.com/calendar/event?action=TEMPLATE&amp;text=Harlem%20Hop">Google Calendar</a>
<a href="/events/harlem-hop-october?format=ical">ICS</a></li></ul>
<p>Live band, lesson at 8.</p><a href="/events/harlem-hop-october">View Event →</a></article>
<article class="eventlist-event">
<h1><a href="/events/shag-social">Collegiate Shag Social</a></h1>
<ul><li><time>Saturday, October 3, 2026</time> <time>7:00 PM</time> <time>10:00 PM</time></li></ul>
<a href="/events/shag-social">View Event →</a></article></main>`,
    cases: [
      {
        title: "Harlem Hop",
        date: "2026-10-02",
        expect: "https://www.swingtime.example/events/harlem-hop-october",
      },
      {
        title: "Collegiate Shag Social",
        date: "2026-10-03",
        expect: "https://www.swingtime.example/events/shag-social",
      },
    ],
  },
  {
    name: "A weekly schedule table",
    url: "https://www.latinstudio.example/schedule",
    dateOrder: "mdy",
    html: `<main><h2>Weekly Socials</h2><table>
<tr><th>Day</th><th>Event</th><th>Time</th></tr>
<tr><td>Monday</td><td><a href="/socials/salsa-mondays">Salsa Mondays</a></td><td>8pm - midnight</td></tr>
<tr><td>Wednesday</td><td><a href="/socials/bachata-wednesdays">Bachata Wednesdays</a></td><td>8pm - 11pm</td></tr>
<tr><td>Friday</td><td>Cuban Casino Night</td><td>9pm - 2am</td></tr>
</table>
<p>This week's flyer: <a href="/flyers/2026-10-05-salsa-mondays">Salsa Mondays, October 5</a></p></main>`,
    cases: [
      {
        title: "Salsa Mondays",
        date: null,
        expect: "https://www.latinstudio.example/socials/salsa-mondays",
      },
      {
        title: "Bachata Wednesdays",
        date: null,
        expect: "https://www.latinstudio.example/socials/bachata-wednesdays",
      },
      { title: "Cuban Casino Night", date: null, expect: null },
    ],
  },
  {
    name: "A directory of other people's nights",
    url: "https://dancelistings.example/this-week",
    dateOrder: "mdy",
    html: `<main><h2>Friday, October 2</h2>
<p><strong>Salsa at the Rooftop</strong> 9pm, $20. <a href="https://rooftopsalsa.example/events/friday-rooftop">rooftopsalsa.example</a></p>
<p><strong>Techno Tango</strong> 10pm <a href="https://dice.fm/event/xyz123-techno-tango-2nd-oct-nowhere-bar-tickets">Tickets</a></p>
<h2>Saturday, October 3</h2>
<p><strong>Swing Out Saturday</strong> 8pm <a href="https://www.meetup.com/nyc-swing-dancers/events/301234567/">RSVP</a></p>
<p><strong>Hustle Hour</strong> 7pm <a href="https://dancelistings.example/venue/the-hustle-room/">The Hustle Room</a></p></main>`,
    cases: [
      // Off-site and not a ticket seller: a stranger's page (B5).
      { title: "Salsa at the Rooftop", date: "2026-10-02", expect: null },
      {
        title: "Techno Tango",
        date: "2026-10-02",
        expect: "https://dice.fm/event/xyz123-techno-tango-2nd-oct-nowhere-bar-tickets",
      },
      {
        title: "Swing Out Saturday",
        date: "2026-10-03",
        expect: "https://www.meetup.com/nyc-swing-dancers/events/301234567/",
      },
      // A venue page is not the event's.
      { title: "Hustle Hour", date: "2026-10-03", expect: null },
    ],
  },
  {
    name: "One ticket link for the whole weekend",
    url: "https://westiefest.example/",
    dateOrder: "mdy",
    html: `<main><h2>Schedule</h2>
<h3>Friday Night Dance</h3><p>October 9, 8pm</p><p><a href="https://westiefest.example/passes">Buy tickets</a></p>
<h3>Saturday Night Dance</h3><p>October 10, 8pm</p><p><a href="https://westiefest.example/passes">Buy tickets</a></p>
<h3>Sunday Tea Dance</h3><p>October 11, 3pm</p><p><a href="https://westiefest.example/schedule#sunday">Details</a></p></main>`,
    cases: [
      { title: "Friday Night Dance", date: "2026-10-09", expect: null },
      { title: "Saturday Night Dance", date: "2026-10-10", expect: null },
      // A place on the schedule page, not a page of the event's own.
      { title: "Sunday Tea Dance", date: "2026-10-11", expect: null },
    ],
  },
  {
    name: "A block dated another night, and Ticketmaster's dated path",
    url: "https://clubnights.example/listings",
    dateOrder: "mdy",
    html: `<main>
<p><strong>Reggaeton Riot</strong> Sat, Oct 10 · 11pm <a href="https://clubnights.example/nights/reggaeton-riot">Details</a></p>
<p><strong>Afrobeats Brunch Party</strong> <a href="https://www.ticketmaster.com/afrobeats-brunch-party-brooklyn-new-york-10-10-2026/event/30006A1B2C3D">Tickets</a></p>
<p><strong>Disco Inferno</strong> Friday October 2, 10pm <a href="https://www.ticketmaster.com/disco-inferno-new-york-new-york-10-02-2026/event/30006A1B9999">Tickets</a></p>
</main>`,
    cases: [
      // The model put these on Oct 3; the page says Oct 10 (B1, B3).
      { title: "Reggaeton Riot", date: "2026-10-03", expect: null },
      { title: "Afrobeats Brunch Party", date: "2026-10-03", expect: null },
      {
        title: "Disco Inferno",
        date: "2026-10-02",
        expect:
          "https://www.ticketmaster.com/disco-inferno-new-york-new-york-10-02-2026/event/30006A1B9999",
      },
    ],
  },
  {
    name: "A London page: day first",
    url: "https://londonsalsa.example/whats-on",
    dateOrder: "dmy",
    html: `<main>
<h3>Salsa Sundays</h3><p>Every Sunday, 7pm</p><p><a href="https://londonsalsa.example/events/salsa-sundays">More info</a></p>
<h3>Bachata Masterclass</h3><p>Sat 3 October</p><p><a href="https://londonsalsa.example/events/bachata-masterclass-3-10-26">More info</a></p>
<h3>Zouk Social</h3><p><a href="https://londonsalsa.example/events/zouk-social-10-3-26">More info</a></p>
</main>`,
    cases: [
      {
        title: "Salsa Sundays",
        date: null,
        expect: "https://londonsalsa.example/events/salsa-sundays",
      },
      {
        title: "Bachata Masterclass",
        date: "2026-10-03",
        expect: "https://londonsalsa.example/events/bachata-masterclass-3-10-26",
      },
      // 10-3-26 is 10 March in London: not October 3.
      { title: "Zouk Social", date: "2026-10-03", expect: null },
    ],
  },
  {
    name: "Words in other scripts and other languages",
    url: "https://tango.example/milongas",
    dateOrder: "dmy",
    html: `<main>
<h3><a href="https://tango.example/milongas/milonga-zvezda">Милонга Звезда</a></h3><p>3 октября, 20:00</p>
<h3><a href="https://tango.example/milongas/noche-de-tango">Noche de Tango</a></h3><p>Sábado 3 de octubre</p>
<h3>Práctica del Barrio</h3><p>Domingo 4 de octubre</p><p><a href="https://tango.example/milongas/practica-del-barrio">Más información</a></p>
</main>`,
    cases: [
      // A title outside the Latin script: no link in v1 (B4).
      { title: "Милонга Звезда", date: "2026-10-03", expect: null },
      {
        title: "Noche de Tango",
        date: "2026-10-03",
        expect: "https://tango.example/milongas/noche-de-tango",
      },
      // "Más información" is not an English label: a miss, not a wrong link.
      { title: "Práctica del Barrio", date: "2026-10-04", expect: null },
    ],
  },
  {
    name: "A blog post that names events in its prose",
    url: "https://swingblog.example/2026/09/28/weekend-roundup/",
    dateOrder: "mdy",
    html: `<article><h1>Weekend roundup</h1>
<p>We had a great time at the Stomp Club Social last week, and the band at <a href="https://swingblog.example/2026/09/21/harlem-review/">Harlem Hop</a> was hot.</p>
<p>Coming up: Stomp Club Social returns on Friday October 2. Tickets are on <a href="https://swingblog.example/tag/stomp-club/">our Stomp Club page</a>.</p>
<p><a href="https://swingblog.example/category/news/">More news</a></p></article>`,
    cases: [
      { title: "Stomp Club Social", date: "2026-10-02", expect: null },
      { title: "Harlem Hop", date: "2026-10-02", expect: null },
    ],
  },
];

/** The held-out real pages in evals/links/pages, by file name. */
export const HELD_OUT_REAL_PAGES: Readonly<Record<string, string>> = {
  "nycwcs-com": "https://www.nycwcs.com/",
  "kizombaembassy-com": "https://kizombaembassy.com/",
  "nuevotangoarts-org": "https://nuevotangoarts.org/",
};
