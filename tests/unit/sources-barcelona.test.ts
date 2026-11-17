// The Barcelona starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { DICE_GENRES } from "@/config/sources/dice";
import { BARCELONA_RETIRED, BARCELONA_SOURCES, DICE_BROWSE } from "@/config/sources/barcelona";
import { KNOWN_VENUES } from "@/config/known-venues";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import { rawListingSchema } from "@/src/domain/listing";
import type { HarvestedListing } from "@/src/adapters/types";
import { STYLES } from "@/config/styles";

const listed = BARCELONA_SOURCES.map((seed) => seed.url);
const retired = BARCELONA_RETIRED.map((gone) => gone.url);

describe("Barcelona's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of BARCELONA_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of BARCELONA_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of BARCELONA_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of BARCELONA_SOURCES) {
      if (seed.kind === "feed_ics") {
        expect(seed.feedUrl).toBeDefined();
      }
      if (seed.kind === "squarespace") {
        expect(seed.platform).toBe("squarespace");
      }
    }
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of BARCELONA_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("reads DICE's Barcelona browse pages (D-197, D-360)", () => {
    const dice = BARCELONA_SOURCES.filter((s) => s.platform === "dice");
    expect(dice.length).toBeGreaterThan(2);
    for (const seed of dice) {
      expect(seed.url).toMatch(
        /^https:\/\/dice\.fm\/browse\/barcelona-5d8cefe1e3e6e374e99e8cbe\/music\//,
      );
    }
  });

  it("reads only the six DICE genre pages that list Barcelona nights", () => {
    const dice = BARCELONA_SOURCES.filter((s) => s.platform === "dice");
    // dj, party, and 6 genre pages = 8 total
    expect(dice.length).toBe(8);
    const urls = dice.map((s) => s.url);
    expect(urls).toContain(`${DICE_BROWSE}/dj`);
    expect(urls).toContain(`${DICE_BROWSE}/party`);
    expect(urls).toContain(`${DICE_BROWSE}/dj/house`);
    expect(urls).toContain(`${DICE_BROWSE}/dj/deephouse`);
    expect(urls).toContain(`${DICE_BROWSE}/dj/techno`);
    expect(urls).toContain(`${DICE_BROWSE}/party/house`);
    expect(urls).toContain(`${DICE_BROWSE}/party/pop`);
    expect(urls).toContain(`${DICE_BROWSE}/party/reggaeton`);

    // All other DICE genre pages are retired
    const retiredUrls = new Set(BARCELONA_RETIRED.map((r) => r.url));
    for (const [path] of DICE_GENRES) {
      if (
        ![
          "dj/house",
          "dj/deephouse",
          "dj/techno",
          "party/house",
          "party/pop",
          "party/reggaeton",
        ].includes(path)
      ) {
        expect(retiredUrls.has(`${DICE_BROWSE}/${path}`)).toBe(true);
      }
    }
  });

  it("reads Salsa Vida's Barcelona guide as a directory, never as the organiser (D-321)", () => {
    const guide = BARCELONA_SOURCES.find((s) => s.label === "Salsa Vida Barcelona");
    expect(guide?.url).toBe(
      "https://www.salsavida.com/guides/spain/catalunya/barcelona/barcelona-city/",
    );
    expect(guide?.trustTier).toBe("directory");
  });

  it("reads the Free Salsa & Bachata Masterclass Meetup feed", () => {
    const feed = BARCELONA_SOURCES.find(
      (s) => s.label === "Free Salsa & Bachata Masterclass (Meetup)",
    );
    expect(feed?.kind).toBe("feed_ics");
    expect(feed?.feedUrl).toBe(
      "https://www.meetup.com/free-salsa-bachata-masterclass/events/ical/",
    );
    expect(feed?.mixedCalendar).toBe(true);
  });

  it("reads five Meetup groups' iCalendar feeds", () => {
    const meetups = BARCELONA_SOURCES.filter(
      (s) => s.kind === "feed_ics" && s.url.startsWith("https://www.meetup.com/"),
    );
    expect(meetups.length).toBe(5);
    const slugs = new Set<string>();
    for (const feed of meetups) {
      expect(feed.feedUrl).toBe(feed.url + "ical/");
      expect(feed.mixedCalendar).toBe(true);
      const slug = new URL(feed.url).pathname.split("/")[1] ?? "";
      slugs.add(slug);
    }
    expect(slugs.size).toBe(5);
    expect(slugs.has("FunSalsaBachataBarcelona")).toBe(true);
    expect(slugs.has("bcnbachata")).toBe(false);
  });

  it("reads BCNswing's iCalendar export once, as a mixed calendar", () => {
    const feed = BARCELONA_SOURCES.find((s) => s.label === "BCNswing");
    expect(feed?.kind).toBe("feed_ics");
    expect(feed?.feedUrl).toBe("https://www.bcnswing.org/mogudes/?ical=1");
    expect(feed?.mixedCalendar).toBe(true);
    expect(feed?.styles).toContain("lindy_hop");
  });

  it("reads Moog's iCalendar export with venuePage and venueAddress", () => {
    const feed = BARCELONA_SOURCES.find((s) => s.label === "Moog Barcelona");
    expect(feed?.kind).toBe("feed_ics");
    expect(feed?.feedUrl).toBe("https://moogbarcelona.com/esdeveniments/?ical=1");
    expect(feed?.venuePage).toBe(true);
    expect(feed?.venueAddress).toBe("Carrer de l'Arc del Teatre 3, 08002 Barcelona");
    expect(feed?.mixedCalendar).toBeFalsy();
  });

  it("reads Jamboree's iCalendar export as a mixed calendar", () => {
    const feed = BARCELONA_SOURCES.find((s) => s.label === "Jamboree Barcelona");
    expect(feed?.kind).toBe("feed_ics");
    expect(feed?.feedUrl).toBe("https://jamboreejazz.com/events/?ical=1");
    expect(feed?.trustTier).toBe("first_party");
    expect(feed?.mixedCalendar).toBe(true);
    expect(feed?.styles).toContain("club");
  });

  it("reads Xceed's and Fever's Barcelona pages as screened directories (D-361)", () => {
    const xceed = BARCELONA_SOURCES.find((s) => s.label === "Xceed Barcelona");
    expect(xceed?.url).toBe("https://xceed.me/en/barcelona/events");
    // Its event pages are followed (jsonld_items, 2026-10-30).
    expect(xceed?.kind).toBe("jsonld");
    expect(xceed?.platform).toBe("jsonld_items");
    expect(xceed?.trustTier).toBe("directory");
    expect(xceed?.mixedCalendar).toBe(true);
    expect(xceed?.styles).toContain("club");

    const fever = BARCELONA_SOURCES.find((s) => s.label === "Fever Barcelona nightlife");
    expect(fever?.url).toBe("https://feverup.com/en/barcelona/nightlife-clubs");
    // Its event pages are followed (jsonld_items, 2026-10-30).
    expect(fever?.kind).toBe("jsonld");
    expect(fever?.platform).toBe("jsonld_items");
    expect(fever?.trustTier).toBe("directory");
    expect(fever?.mixedCalendar).toBe(true);
    expect(fever?.styles).toContain("club");
  });

  it("retires exactly the first full run's four URLs, the empty bcnbachata feed, two empty discovered sources, four dead (404) discoveries, one non-dance discovery and one Berlin site, each with a reason", () => {
    const urls = BARCELONA_RETIRED.map((r) => r.url).filter(
      (u) => !u.startsWith("https://dice.fm/"),
    );
    expect(new Set(urls).size).toBe(13);
    expect(urls).toContain("https://ien.es/");
    expect(urls).toContain("https://espailinia.cat/");
    expect(urls).toContain("https://www.bibliomusicineteca.com/");
    expect(urls).toContain("https://www.toniguida.org/");
    expect(urls).toContain("https://grupalmodobar.com/");
    expect(urls).toContain("https://automatamusic.com/drum-and-bass-parties-in-barcelona/");
    expect(urls).toContain("https://www.meetup.com/bcnbachata/events/");
    expect(urls).toContain("https://matineegroup.com/");
    expect(urls).toContain("https://www.aymisalsa.com/");
    expect(urls).toContain("https://www.openbarcelona.com/");
    expect(urls).toContain("https://cancarol.cat/");
    expect(urls).toContain("https://tangoenbarcelona.es/agenda/");
    expect(urls).toContain("https://berlindark.com/");
    for (const entry of BARCELONA_RETIRED) {
      expect(entry.reason?.trim().length).toBeGreaterThan(0);
    }
  });

  it("places the three single-room Meetup groups at their rooms", () => {
    const address = (slug: string) =>
      BARCELONA_SOURCES.find((s) => s.url === `https://www.meetup.com/${slug}/events/`)
        ?.venueAddress;
    expect(address("FunSalsaBachataBarcelona")).toBe("Carrer de Topazi 24, 08012 Barcelona");
    expect(address("gracia-latina-barcelona-salsa-dance-group")).toBe(
      "Carrer de l'Or 19, 08012 Barcelona",
    );
    expect(address("grupo-de-meetup-en-barcelona-de-baile-social")).toBe(
      "Carrer de Francisco Giner 32, 08012 Barcelona",
    );
    expect(address("free-salsa-bachata-masterclass")).toBeUndefined();
  });

  it("never lists a retired URL", () => {
    const retiredUrls = new Set(BARCELONA_RETIRED.map((r) => r.url));
    for (const seed of BARCELONA_SOURCES) {
      expect(retiredUrls.has(seed.url)).toBe(false);
    }
  });

  it("seeds Antilla Salsa Barcelona as a jsonld first-party venue page", () => {
    const antilla = BARCELONA_SOURCES.find((s) => s.label === "Antilla Salsa Barcelona");
    expect(antilla?.url).toBe("https://antillasalsa.com/");
    expect(antilla?.kind).toBe("jsonld");
    expect(antilla?.mixedCalendar).toBeFalsy();
    expect(antilla?.venuePage).toBe(true);
    expect(antilla?.styles).toContain("salsa");
  });

  it("has twenty-five known venues, each with a Barcelonès postcode", () => {
    const venues = KNOWN_VENUES.barcelona ?? [];
    expect(venues.length).toBe(25);
    for (const venue of venues) {
      // Barcelona 080xx; L'Hospitalet, Badalona, Santa Coloma and Sant Adrià 0890x-08930.
      expect(venue.address).toMatch(/\b08(0\d{2}|9[0-2]\d|930)\b/);
    }
  });

  it("hides Mojito Club as a closed known venue (D-362)", () => {
    const mojito = KNOWN_VENUES.barcelona?.find((v) => v.names.includes("Mojito Club"));
    expect(mojito?.address).toBe("Carrer del Rosselló 217, 08008 Barcelona");
    expect(mojito?.closed?.trim().length).toBeGreaterThan(0);
  });

  it("gives hand-checked points to venues the geocoder refused", () => {
    const pointOf = (name: string) =>
      KNOWN_VENUES.barcelona?.find((v) => v.names.includes(name))?.point;
    for (const name of [
      "Antilla",
      "Sala Upload",
      "Gaby's Club",
      "W Hotel",
      "26th floor W Barcelona",
      "El Galpón",
      "La Tanguería",
      "Pérgola de la Transsexual Sonia",
      "Parque de la Ciutadella (Barcelona)",
    ]) {
      const point = pointOf(name);
      expect(point?.lat).toBeGreaterThan(41.3);
      expect(point?.lat).toBeLessThan(41.5);
      expect(point?.lng).toBeGreaterThan(2.0);
      expect(point?.lng).toBeLessThan(2.3);
    }
  });

  it("lists Sala Vivaldi with Llança street phrases", () => {
    const vivaldi = KNOWN_VENUES.barcelona?.find((v) => v.names.includes("Sala Vivaldi"));
    expect(vivaldi?.streets).toContain("Llança, 5");
  });

  it("reads Eventbrite organisers through the API only, as mixed calendars (D-131, D-249)", () => {
    const organisers = BARCELONA_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(organisers.length).toBe(7);
    const urls = organisers.map((s) => s.url);
    expect(new Set(urls).size).toBe(7);
    for (const seed of organisers) {
      expect(seed.url).toMatch(/^https:\/\/www\.eventbrite\.es\/o\/\d+$/);
      expect(seed.kind).toBe("ticketing_api");
      expect(seed.mixedCalendar).toBe(true);
    }
  });

  it("reads SomSardana's Barcelona agenda as a screened directory with folk style", () => {
    const seed = BARCELONA_SOURCES.find(
      (s) => s.url === "https://somsardana.cat/sardanisme/agenda?location=poblacio-5",
    );
    expect(seed).toBeDefined();
    expect(seed?.kind).toBe("html");
    expect(seed?.trustTier).toBe("directory");
    expect(seed?.styles).toEqual(["folk"]);
    expect(seed?.mixedCalendar).toBe(true);
    expect(seed?.danceNights).toContain("Ballada de sardanes");
    // Pinned to plain HTML: a probe once took a cobla's calendar from the page's script data.
    expect(seed?.platform).toBe("probed");
  });

  it("reads SomSardana's Badalona agenda the same way as Barcelona's", () => {
    const bcn = BARCELONA_SOURCES.find(
      (s) => s.url === "https://somsardana.cat/sardanisme/agenda?location=poblacio-5",
    );
    const badalona = BARCELONA_SOURCES.find(
      (s) => s.url === "https://somsardana.cat/sardanisme/agenda?location=poblacio-3",
    );
    expect(badalona?.label).toBe("SomSardana Badalona");
    expect(badalona?.platform).toBe("probed");
    expect(badalona?.trustTier).toBe("directory");
    expect(badalona?.mixedCalendar).toBe(true);
    expect(badalona?.styles).toEqual(["folk"]);
    expect(badalona?.danceNights).toEqual(bcn?.danceNights);
  });

  it("reads DanceUS's Barcelona salsa calendar as a screened directory (D-364)", () => {
    const seed = BARCELONA_SOURCES.find(
      (s) => s.url === "https://www.danceus.org/events/salsa/barcelona-spain-salsa-calendar/",
    );
    expect(seed).toBeDefined();
    expect(seed?.kind).toBe("html");
    expect(seed?.trustTier).toBe("directory");
    expect(seed?.styles).toEqual(["salsa", "bachata"]);
    expect(seed?.mixedCalendar).toBe(true);
  });

  it("reads La Deskomunal from its Modern Events Calendar feed, which has start times", () => {
    const seed = BARCELONA_SOURCES.find((s) => s.url === "https://ladeskomunal.coop/");
    expect(seed?.kind).toBe("jsonld");
    expect(seed?.platform).toBe("mec_rss");
    expect(seed?.feedUrl).toBe("https://ladeskomunal.coop/agenda/feed/");
    expect(seed?.mixedCalendar).toBe(true);
    expect(seed?.venueAddress).toMatch(/08028 Barcelona$/);
  });

  it("reads DJ dance bars' own pages: Marula Café's dated agenda and Ocaña's weekly grid", () => {
    const marula = BARCELONA_SOURCES.find((s) => s.url === "https://marulacafe.com/agenda/");
    expect(marula?.kind).toBe("html");
    expect(marula?.trustTier).toBe("first_party");
    expect(marula?.eventPageTimes).toBe(true);
    expect(marula?.eventPageTimesLimit).toBe(24);
    expect(marula?.mixedCalendar).toBe(true);
    const ocana = BARCELONA_SOURCES.find((s) => s.url === "https://www.ocana.cat/live-music/");
    expect(ocana?.weeklyGrid).toBe(true);
    expect(ocana?.mixedCalendar).toBe(true);
    expect(ocana?.danceNights).toEqual(["La Clave", "Noches de Soul & Funk"]);
  });

  it("reads Swing Maniacs' jams (screened) and Dio Club's nights from their own pages", () => {
    const jams = BARCELONA_SOURCES.find((s) => s.url === "https://jams.swingmaniacs.com/");
    expect(jams?.kind).toBe("html");
    expect(jams?.mixedCalendar).toBe(true);
    expect(jams?.venueAddress).toMatch(/Roger de Flor 291, 08025/);
    const dio = BARCELONA_SOURCES.find((s) => s.url === "https://www.sevendance.com/es/dio-club");
    expect(dio?.styles).toEqual(["salsa", "bachata"]);
    expect(dio?.venueAddress).toMatch(/Perill 10, 08012/);
  });

  it("places the DJ bars' and Dio Club's rows at their own venue, whatever room they name (D-373)", () => {
    for (const url of [
      "https://marulacafe.com/agenda/",
      "https://www.ocana.cat/live-music/",
      "https://www.sevendance.com/es/dio-club",
    ]) {
      const seed = BARCELONA_SOURCES.find((s) => s.url === url);
      expect(seed?.onlyHere, url).toBe(true);
      expect(seed?.venuePage, url).toBe(true);
      expect(seed?.venueAddress, url).toMatch(/08\d{3} Barcelona$/);
    }
  });

  it("places listings at known Barcelona venues by street or name", () => {
    function makeListing(venue: {
      name?: string | null;
      address?: string | null;
    }): HarvestedListing {
      const raw = rawListingSchema.parse({
        title: "Test Event",
        listing_type: "social",
        styles: ["salsa"],
        local_date: "2026-10-11",
        doors_time: "20:00",
        venue: {
          name: venue.name ?? null,
          address: venue.address ?? null,
          url: null,
        },
        organizer: { name: null, url: null },
      });
      return {
        listing: raw,
        externalId: "test:1",
        tz: "Europe/Madrid",
        venueLocation: null,
        recurrence: null,
        provenance: {
          sourceUrl: "https://example.com",
          fetchedAt: new Date(),
          method: "feed",
        },
      };
    }

    const known = KNOWN_VENUES.barcelona ?? [];

    // Street match: C/ de Llança, 5, Barcelona -> Sala Vivaldi
    const llança = makeListing({ name: null, address: "C/ de Llança, 5, Barcelona" });
    const placedLlança = withKnownVenue(llança, known, "ES");
    expect(placedLlança.listing.venue.address).toBe("Carrer de Llança 5, 08015 Barcelona");

    // Name match: Antilla Salsa Barcelona -> Antilla
    const antilla = makeListing({ name: "Antilla Salsa Barcelona", address: null });
    const placedAntilla = withKnownVenue(antilla, known, "ES");
    expect(placedAntilla.listing.venue.address).toBe("Carrer d'Alcolea 100, 08014 Barcelona");

    // Name match: Sabor Cubano -> El Sabor Cubano
    const sabor = makeListing({ name: "Sabor Cubano", address: null });
    const placedSabor = withKnownVenue(sabor, known, "ES");
    expect(placedSabor.listing.venue.address).toBe("Carrer de Francisco Giner 32, 08012 Barcelona");
  });
});
