// Which venue websites are worth probing (D-040 step 3, D-120). Pure.
//
// The Overture seed stores whatever website a place lists, and for a share of places that is not
// the venue's own site: a link-in-bio page, a directory, a ticketing platform, an encyclopaedia
// entry for a club that closed in 2001. Those are named and skipped here, never fetched.
//
// Hosts are compared, never URLs (docs/WORKSTREAMS.md section 3): `upsertSource` keys on the exact
// URL string, so "https://www.club.com/" and "http://club.com/events" would otherwise be two
// sources of one venue.

import { registrableDomain } from "@/src/pipeline/blocklist";

/** The host a source or a candidate is compared by: lowercased, without `www.`. Null when not http(s). */
export function siteHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** Why a host is not probed as a venue's own site; null when it may be. */
export type HostSkip =
  | { kind: "tier_d"; reason: string }
  | { kind: "platform"; reason: string }
  | { kind: "not_a_venue_site"; reason: string };

// Tier D and every unofficial endpoint stay off (SPEC section 4, docs/WORKSTREAMS.md 2.5).
const TIER_D = new Map<string, string>([
  ["ra.co", "Resident Advisor"],
  ["residentadvisor.net", "Resident Advisor"],
  ["dice.fm", "DICE"],
  ["shotgun.live", "Shotgun"],
  ["facebook.com", "Facebook"],
  ["instagram.com", "Instagram"],
]);

// Platforms another lane reads (docs/WORKSTREAMS.md section 3): recorded as candidates only.
const PLATFORMS = new Map<string, string>([
  ["eventbrite.com", "Eventbrite: lane 5's organizer reader"],
  ["meetup.com", "Meetup: read through a group's own feed"],
  ["tickettailor.com", "Ticket Tailor: a ticketing page, not a venue site"],
  ["ticketmaster.com", "Ticketmaster: read through its API"],
  ["seetickets.us", "See Tickets: a ticketing page, not a venue site"],
  ["axs.com", "AXS: a ticketing page, not a venue site"],
  ["etix.com", "Etix: a ticketing page, not a venue site"],
  ["tixr.com", "Tixr: a ticketing page, not a venue site"],
  ["posh.vip", "Posh: a ticketing page, not a venue site"],
  ["partiful.com", "Partiful: invitations, not a venue site"],
  ["boletosexpress.com", "Boletos Express: a ticketing page, not a venue site"],
  ["taogroup.com", "TAO Group: a hospitality group's ticketing, not one venue's site"],
]);

// Measured in the 2026-09-23.0 seed for New York (D-120): the hosts shared by places that are not
// the place's own site, and the directory kinds the coverage sweep found behind 35 of the 224
// dance_club websites. A registrable domain here covers its subdomains.
const NOT_A_VENUE_SITE = new Map<string, string>([
  ["linktr.ee", "a link-in-bio page"],
  ["linkin.bio", "a link-in-bio page"],
  ["beacons.ai", "a link-in-bio page"],
  ["bio.link", "a link-in-bio page"],
  ["campsite.bio", "a link-in-bio page"],
  ["wikipedia.org", "an encyclopaedia entry"],
  ["myspace.com", "a MySpace page"],
  ["yelp.com", "a directory"],
  ["tripadvisor.com", "a directory"],
  ["foursquare.com", "a directory"],
  ["eventseeker.com", "a directory"],
  ["clubplanet.com", "a directory"],
  ["chamberofcommerce.com", "a directory"],
  ["momentfeed.com", "a store-locator service"],
  ["yellowpages.com", "a directory"],
  ["mapquest.com", "a directory"],
  ["nightflow.com", "a directory"],
  ["nycgo.com", "a directory"],
  ["timeout.com", "a magazine"],
  ["google.com", "a Google page"],
  ["goo.gl", "a short link"],
  ["bit.ly", "a short link"],
  ["paypal.com", "a payment page"],
  ["venmo.com", "a payment page"],
  ["square.site", "a shop page"],
  ["toasttab.com", "a restaurant ordering page"],
  ["opentable.com", "a reservations page"],
  ["resy.com", "a reservations page"],
  ["sevenrooms.com", "a reservations page"],
  ["tiktok.com", "a social profile"],
  ["youtube.com", "a social profile"],
  ["twitter.com", "a social profile"],
  ["x.com", "a social profile"],
  ["soundcloud.com", "a social profile"],
  ["mindbodyonline.com", "a booking platform"],
  ["mindbody.io", "a booking platform"],
  ["vagaro.com", "a booking platform"],
  ["peerspace.com", "a room-rental listing"],
  ["giggster.com", "a room-rental listing"],
  ["tagvenue.com", "a room-rental listing"],
  ["davincimeetingrooms.com", "a room-rental listing"],
  ["universalhallrental.com", "a room-rental listing"],
  ["trulia.com", "a real-estate listing"],
  ["zillow.com", "a real-estate listing"],
  ["streeteasy.com", "a real-estate listing"],
  ["realtor.com", "a real-estate listing"],
  ["apartments.com", "a real-estate listing"],
  ["marriott.com", "a hotel chain's page"],
  ["hilton.com", "a hotel chain's page"],
  ["hyatt.com", "a hotel chain's page"],
  ["ihg.com", "a hotel chain's page"],
  // Measured on 2026-10-04 (D-120): a club place's website was the Ancient Order of Hibernians'
  // national site, whose empty calendar is Division 19's meetings, not a dance venue's nights.
  ["aoh.com", "a fraternal order's site, not a dance venue's"],
  // Measured on 2026-10-05 (D-124): club places whose website is a TV channel's schedule and a
  // national dance service organisation's member calendar.
  ["history.com", "a TV channel's site"],
  ["danceusa.org", "a national service organisation's site, not a venue's"],
  // Measured on 2026-11-01 (London read 41284856117): an adult club found from a place's website.
  ["houseofpoitier.com", "a swingers' club, not a dance venue"],
  // Measured on 2026-11-07 (Los Angeles read 42396437290, D-781): Overture places whose website is
  // the Internet Archive (its blog's events page was probed for Mid City Yacht Club) and
  // business-directory and deals pages shared by places with different names.
  ["archive.org", "the Internet Archive"],
  ["bizapedia.com", "a directory"],
  ["cityseekr.com", "a directory"],
  ["yahoo.com", "a directory"],
  ["groupon.com", "a deals page"],
]);

// The venues another lane reads (docs/WORKSTREAMS.md section 3, "seams settled in advance"):
// the sweep's measured venues are lane 3's starting sources, and Elsewhere is lane 5's through its
// Eventbrite organizer. Discovery never probes them, so a later starting address for one of them
// never meets a switched-off row of ours.
const OTHER_LANES = new Map<string, string>([
  ["lebainnewyork.com", "Le Bain: lane 3's starting source"],
  ["3dollarbillbk.com", "3 Dollar Bill: lane 3's starting source"],
  ["starrbar.com", "Starr Bar: lane 3's starting source"],
  ["signalnyc.club", "Signal: lane 3's starting source"],
  ["houseofyes.org", "House of Yes: lane 3's starting source"],
  ["h0l0.nyc", "H0L0: lane 3's starting source"],
  ["lpr.com", "LPR: lane 3's starting source"],
  ["daybreaker.com", "Daybreaker: lane 3's starting source"],
  ["elsewhere.club", "Elsewhere: lane 5's, through its Eventbrite organizer"],
]);

/** The lane that reads a host, when it is not lane 4's to probe. */
export function otherLane(host: string): string | null {
  return OTHER_LANES.get(registrableDomain(host)) ?? null;
}

/** Whether a host is skipped, and why. A host not named here is probed. */
export function hostSkip(host: string): HostSkip | null {
  const domain = registrableDomain(host);
  const tierD = TIER_D.get(domain);
  if (tierD) return { kind: "tier_d", reason: `${tierD} (Tier D, off)` };
  // Eventbrite runs a domain per country (eventbrite.co.uk); the name is what matters.
  if (/^eventbrite\./.test(domain))
    return { kind: "platform", reason: PLATFORMS.get("eventbrite.com")! };
  const platform = PLATFORMS.get(domain);
  if (platform) return { kind: "platform", reason: platform };
  const other = NOT_A_VENUE_SITE.get(domain);
  if (other) return { kind: "not_a_venue_site", reason: other };
  // Government portals list a building's page among thousands, never its nights.
  if (/\.gov$/.test(domain)) return { kind: "not_a_venue_site", reason: "a government portal" };
  // A university's campus-wide calendar (calendar.usc.edu, trojanevents.usc.edu) lists talks, panels and
  // games by the hundred, never a venue's nights (D-846, LA 2026-11-10). A department's own site is probed.
  const sub = host.toLowerCase().slice(0, -(domain.length + 1));
  // D-886 (Raleigh 2026-11-16): the arts office, box office and film program list plays, concerts and screenings too.
  if (
    /\.(?:edu|edu\.[a-z]{2}|ac\.[a-z]{2})$/.test(domain) &&
    (/calendar|events?/.test(sub) ||
      /(?:^|[.-])(?:arts|tickets?|box-?office|cinematicarts|cinema|film)(?:$|[.-])/.test(sub))
  )
    return { kind: "not_a_venue_site", reason: "a university's campus-wide calendar" };
  return null;
}
