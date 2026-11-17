// The London starting list keeps its own promises (D-047, D-110): one row per address, only
// http(s), no Squarespace ?format= view, and no Resident Advisor pages (D-034).
import { describe, expect, it } from "vitest";

import { LONDON_RETIRED, LONDON_SOURCES } from "@/config/sources/london";
import { titleNamesOutsideTown } from "@/config/metro-regions";
import { STYLES } from "@/config/styles";

const listed = LONDON_SOURCES.map((seed) => seed.url);
const retired = LONDON_RETIRED.map((gone) => gone.url);

describe("London's starting list", () => {
  it("lists each address once, retired addresses are unique, and every url and feedUrl is http(s)", () => {
    expect(new Set(listed).size).toBe(listed.length);
    expect(new Set(retired).size).toBe(retired.length);
    for (const url of [...listed, ...retired]) {
      expect(new URL(url).protocol).toMatch(/^https?:$/);
    }
    for (const seed of LONDON_SOURCES) {
      if (seed.feedUrl) {
        expect(new URL(seed.feedUrl).protocol).toMatch(/^https?:$/);
      }
    }
  });

  it("never lists an address it has retired", () => {
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("asks for no ?format= view, which Squarespace's robots.txt disallows", () => {
    for (const seed of LONDON_SOURCES) {
      expect(seed.url).not.toMatch(/[?&]format=/);
      expect(seed.feedUrl ?? "").not.toMatch(/[?&]format=/);
    }
  });

  it("keeps Resident Advisor out of its own file: RA comes only from config/sources/ra.ts (D-505)", () => {
    for (const seed of LONDON_SOURCES) {
      expect(seed.url).not.toMatch(/ra\.co|residentadvisor\.net/);
      expect(seed.feedUrl ?? "").not.toMatch(/ra\.co|residentadvisor\.net/);
    }
  });

  it("reads the six Swing Patrol class pages with the swingpatrol reader, not the model (D-524)", () => {
    const branches = ["angel", "bermondsey", "euston", "harringay", "vauxhall", "waterloo"];
    for (const branch of branches) {
      const seed = LONDON_SOURCES.find(
        (s) => s.url === `https://www.swingpatrol.co.uk/classes/${branch}/`,
      );
      expect(seed?.platform).toBe("swingpatrol");
      // An "html" row with a platform is probed again and read by the model.
      expect(seed?.kind).toBe("jsonld");
    }
  });

  it("retires House of Poitier, an adult club discovery found (2026-11-01)", () => {
    expect(retired).toContain("https://houseofpoitier.com/");
    expect(listed.some((url) => url.includes("houseofpoitier.com"))).toBe(false);
  });

  it("every feed_ics source has a feedUrl, and every squarespace source has platform: 'squarespace'", () => {
    for (const seed of LONDON_SOURCES) {
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
    for (const seed of LONDON_SOURCES) {
      for (const style of seed.styles) {
        expect(styleKeys).toContain(style);
      }
    }
  });

  it("has the nine sources with correct kinds and labels", () => {
    const byUrl = new Map(LONDON_SOURCES.map((s) => [s.url, s]));
    // 1. Salsa Vida London
    const salsaVida = byUrl.get(
      "https://www.salsavida.com/guides/united-kingdom/england/greater-london/",
    );
    expect(salsaVida).toBeDefined();
    expect(salsaVida?.kind).toBe("html");
    expect(salsaVida?.label).toBe("Salsa Vida London");
    // 2. Dalston Superstore
    const dalston = byUrl.get("https://dalstonsuperstore.com/events/");
    expect(dalston).toBeDefined();
    expect(dalston?.kind).toBe("feed_ics");
    expect(dalston?.label).toBe("Dalston Superstore");
    // 3. Ecstatic Dance London
    const ecstatic = byUrl.get("https://ecstaticdancelondon.com/events/");
    expect(ecstatic).toBeDefined();
    expect(ecstatic?.kind).toBe("feed_ics");
    expect(ecstatic?.label).toBe("Ecstatic Dance London");
    // 4. Skating Haven
    const skating = byUrl.get("https://skatinghaven.com/");
    expect(skating).toBeDefined();
    expect(skating?.kind).toBe("feed_ics");
    expect(skating?.label).toBe("Skating Haven");
    // 5. Colour Factory
    const colour = byUrl.get("https://www.colourfactory.com/whatson");
    expect(colour).toBeDefined();
    expect(colour?.kind).toBe("squarespace");
    expect(colour?.label).toBe("Colour Factory");
    // 6. FOLD
    const fold = byUrl.get("https://www.fold.london/tickets");
    expect(fold).toBeDefined();
    expect(fold?.kind).toBe("html");
    expect(fold?.label).toBe("FOLD");
    // 7. Brixton Jamm
    const brixton = byUrl.get("https://www.brixtonjamm.org/allevents");
    expect(brixton).toBeDefined();
    expect(brixton?.kind).toBe("html");
    expect(brixton?.label).toBe("Brixton Jamm");
    // 8. Electrowerkz
    const electrowerkz = byUrl.get("https://www.electrowerkz.co.uk/whatson");
    expect(electrowerkz).toBeDefined();
    expect(electrowerkz?.kind).toBe("html");
    expect(electrowerkz?.label).toBe("Electrowerkz");
    // 9. Night Tales
    const nightTales = byUrl.get("https://www.nighttales.co.uk/whats-on");
    expect(nightTales).toBeDefined();
    expect(nightTales?.kind).toBe("html");
    expect(nightTales?.label).toBe("Night Tales");
  });

  it("Salsa Vida London is 'directory', Eventbrite organisers and DICE pages are 'ticketing', every other source is 'first_party'", () => {
    const salsaVida = LONDON_SOURCES.find(
      (s) => s.url === "https://www.salsavida.com/guides/united-kingdom/england/greater-london/",
    );
    expect(salsaVida?.trustTier).toBe("directory");
    const eventbriteSources = LONDON_SOURCES.filter(
      (s) => s.platform === "eventbrite" || s.platform === "dice",
    );
    for (const source of eventbriteSources) {
      expect(source.trustTier).toBe("ticketing");
    }
    // London-wide calendars (D-211) are directories too.
    const directories = new Set([
      "https://www.salsavida.com/guides/united-kingdom/england/greater-london/",
      "https://londonsalsaevents.uk/events/",
      "https://londonmilongas.co.uk/this-week/",
      "https://londonmilongas.co.uk/events/",
      "https://www.designmynight.com/london/whats-on/classes/bailando-thursdays-bar-salsa-soho",
      // London's swing socials list (D-213).
      "https://www.swingoutlondon.co.uk/",
      // London-wide listings from the Serper gap list (D-215).
      "https://folkdance.page/?country=UK&city=London",
      "https://social-dance.today/London?l=en",
      // London's forró nights by weekday (D-524 gap analysis, 2026-11-01).
      "https://forro.london/where-to-dance",
      // A UK-wide WCS calendar (D-293).
      "https://www.eastonswing.com/",
      // Luminous conscious dance (D-573).
      "https://dandelion.events/o/luminous/events",
    ]);
    for (const source of LONDON_SOURCES.filter((s) => directories.has(s.url))) {
      expect(source.trustTier).toBe("directory");
    }
    const others = LONDON_SOURCES.filter(
      (s) => !directories.has(s.url) && s.platform !== "eventbrite" && s.platform !== "dice",
    );
    for (const source of others) {
      expect(source.trustTier).toBe("first_party");
    }
  });

  it("includes ten bars with DJ nights and dancing (owner's ask, 2026-10-27)", () => {
    const urls = [
      "https://www.ridleyroadmarketbar.com/whats-on",
      "https://www.homedeptford.com/events",
      "https://www.growhackney.co.uk/events-calendar",
      "https://freedombarsoho.com/whats-on/",
      "https://www.thegreyhound.uk/whats-on",
      "https://princeofpeckham.co.uk/whats-on/",
      "https://www.kavelondon.com/whats-on",
      "https://queenofhoxton.com/whats-on/",
      "https://theoldqueenshead.com/whats-on/",
    ];
    const byUrl = new Map(LONDON_SOURCES.map((s) => [s.url, s]));
    for (const url of urls) {
      const source = byUrl.get(url);
      expect(source, `Missing source for ${url}`).toBeDefined();
      expect(source?.venuePage).toBe(true);
    }
    // Check specific properties for each source
    const ridley = byUrl.get("https://www.ridleyroadmarketbar.com/whats-on");
    expect(ridley?.label).toBe("Ridley Road Market Bar");
    expect(ridley?.kind).toBe("jsonld");
    expect(ridley?.platform).toBe("jsonld_items");

    const home = byUrl.get("https://www.homedeptford.com/events");
    expect(home?.label).toBe("Home Deptford");
    expect(home?.kind).toBe("jsonld");
    expect(home?.platform).toBe("jsonld_items");

    const grow = byUrl.get("https://www.growhackney.co.uk/events-calendar");
    expect(grow?.label).toBe("Grow Hackney");
    expect(grow?.kind).toBe("squarespace");

    const freedom = byUrl.get("https://freedombarsoho.com/whats-on/");
    expect(freedom?.label).toBe("Freedom Bar");
    expect(freedom?.kind).toBe("jsonld");

    const greyhound = byUrl.get("https://www.thegreyhound.uk/whats-on");
    expect(greyhound?.label).toBe("The Greyhound (Peckham)");
    expect(greyhound?.kind).toBe("html");

    const prince = byUrl.get("https://princeofpeckham.co.uk/whats-on/");
    expect(prince?.label).toBe("Prince of Peckham");
    expect(prince?.kind).toBe("html");

    const kave = byUrl.get("https://www.kavelondon.com/whats-on");
    expect(kave?.label).toBe("Kave");
    expect(kave?.kind).toBe("html");

    const queen = byUrl.get("https://queenofhoxton.com/whats-on/");
    expect(queen?.label).toBe("Queen of Hoxton");
    expect(queen?.kind).toBe("html");

    const old = byUrl.get("https://theoldqueenshead.com/whats-on/");
    expect(old?.label).toBe("The Old Queen's Head");
    expect(old?.kind).toBe("html");
  });

  it("reads forty-four social-dance organisers through Eventbrite's API (D-205, D-207, D-208, D-214, D-573)", () => {
    const eventbriteSources = LONDON_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(eventbriteSources).toHaveLength(44);

    const organiserIds = new Set<string>();
    for (const source of eventbriteSources) {
      expect(source.kind).toBe("ticketing_api");
      expect(source.mixedCalendar).toBe(true);
      expect(source.styles.length).toBeGreaterThan(0);
      expect(source.label).toMatch(/\(Eventbrite\)$/);
      expect(source.url).toMatch(/^https:\/\/www\.eventbrite\.co\.uk\/o\/[a-z0-9-]+-\d{6,}$/);
      organiserIds.add(source.url.replace(/^.*-/, ""));
    }
    expect(organiserIds.size).toBe(44);

    const urls = eventbriteSources.map((s) => s.url);
    expect(urls).toContain("https://www.eventbrite.co.uk/o/mambocity-3023432912");
    expect(urls).toContain("https://www.eventbrite.co.uk/o/tea-time-dance-121234842686");
  });

  it("places five single-venue sources and eight new venue pages at their own address (D-206)", () => {
    const addressPattern = /, London [A-Z]{1,2}\d[A-Z\d]? \d[A-Z]{2}$/;

    const fiveExisting = [
      {
        url: "https://dalstonsuperstore.com/events/",
        address: "117 Kingsland High St, London E8 2PB",
      },
      {
        url: "https://www.electrowerkz.co.uk/whatson",
        address: "7 Torrens Street, London EC1V 1NQ",
      },
      {
        url: "https://www.thegreyhound.uk/whats-on",
        address: "109 Peckham High Street, London SE15 5SE",
      },
      {
        url: "https://princeofpeckham.co.uk/whats-on/",
        address: "1 Clayton Road, London SE15 5JA",
      },
      { url: "https://queenofhoxton.com/whats-on/", address: "1 Curtain Road, London EC2A 3JX" },
    ];

    const eightNew = [
      { url: "https://phonox.co.uk/whats-on", address: "418 Brixton Road, London SW9 7AY" },
      { url: "https://palais.co.uk/", address: "1A Rye Lane, London SE15 5EW" },
      {
        url: "https://earthackney.co.uk/events/",
        address: "11-17 Stoke Newington Road, London N16 8BH",
      },
      { url: "https://www.93feeteast.co.uk/", address: "150 Brick Lane, London E1 6QL" },
      {
        url: "https://number90bar.co.uk/events-east-london/",
        address: "90 Wallis Road, London E9 5LN",
      },
      {
        url: "https://www.madeinbrasil.co.uk/eventsandoffers",
        address: "12 Inverness Street, London NW1 7HJ",
      },
      { url: "https://palomachelsea.com/", address: "92b Old Brompton Road, London SW7 3LQ" },
    ];

    for (const { url, address } of [...fiveExisting, ...eightNew]) {
      const source = LONDON_SOURCES.find((s) => s.url === url);
      expect(source, `Missing source for ${url}`).toBeDefined();
      expect(source?.venueAddress).toBe(address);
      expect(address).toMatch(addressPattern);
    }

    for (const { url } of eightNew) {
      const source = LONDON_SOURCES.find((s) => s.url === url);
      expect(source?.venuePage).toBe(true);
      expect(source?.mixedCalendar).toBe(true);
    }
  });

  it("reads Swingland's Google Calendar (D-206)", () => {
    const source = LONDON_SOURCES.find((s) => s.url === "https://www.swingland.com/events/");
    expect(source).toBeDefined();
    expect(source?.kind).toBe("feed_gcal");
    expect(source?.platform).toBe("feed_gcal");
    expect(source?.trustTier).toBe("first_party");
    expect(source?.styles).toEqual(["lindy_hop"]);
    expect(source?.venueAddress).toBeUndefined();
  });

  it("names the non-dance rows of The Bedford, Chats Palace, Jamboree and Colindale (D-519 E1)", () => {
    const seed = (url: string) => LONDON_SOURCES.find((s) => s.url === url);
    expect(seed("https://thebedford.com/events/")?.notDanceNights).toContain("Zumba");
    expect(seed("https://chatspalace.com/")?.notDanceNights).toContain(
      "Queer Recipes Archive (Community Workshop)",
    );
    const jamboree = seed("https://www.jamboreevenue.co.uk/events/");
    expect(jamboree?.notDanceNights).toContain("Word Space");
    expect(jamboree?.notDanceNights).not.toContain(
      "A Lunch Gig With Ewan Bleach & The Fleeting Paradise Orchestra",
    );
    expect(
      seed("https://www.eventbrite.co.uk/o/colindale-salsa-bachata-fitness-nw-london-108669592351")
        ?.notDanceNights,
    ).toEqual(["Dance Fitness Party Tuesdays in Colindale, NW London / Barnet"]);
  });

  it("reads seven DJ dance bars and retires two runner-blocked pages (D-291)", () => {
    const byUrl = new Map(LONDON_SOURCES.map((s) => [s.url, s]));
    const bars = [
      "https://bambi-bar.com/events/",
      "https://www.vennstreetrecords.com/whats-on/",
      "https://www.oldstreetrecords.com/whats-on/",
      "https://www.northcoterecords.com/whats-on/",
      "https://paperdressvintage.co.uk/by-night",
      "https://effrasocial.co.uk/whats-on/",
      "https://www.rubysdalston.com/whats-on/",
    ];
    for (const url of bars) {
      const source = byUrl.get(url);
      expect(source, `Missing source for ${url}`).toBeDefined();
      expect(source?.trustTier).toBe("first_party");
      expect(source?.venuePage).toBe(true);
      expect(source?.mixedCalendar).toBe(true);
      expect(source?.venueAddress).toMatch(/London [A-Z]{1,2}\d/);
    }
    expect(byUrl.get("https://effrasocial.co.uk/whats-on/")?.danceNights).toEqual([
      "Effra House Party",
      "Saturday Spins",
    ]);
    for (const gone of [
      "https://www.slimjimsliquorstore.com/events-rock-music-live-music-club-djs/",
      "https://villageunderground.co.uk/events/",
    ]) {
      expect(byUrl.has(gone)).toBe(false);
      expect(retired).toContain(gone);
    }
  });

  it("reads Social Dance Today's shifted feed times as not listed and retires kclsu (2026-11-01)", () => {
    const sdt = LONDON_SOURCES.find(
      (seed) => seed.url === "https://social-dance.today/London?l=en",
    );
    expect(sdt?.placeholderTimes).toEqual(["07:00", "13:00", "13:30", "14:00"]);
    expect(listed).not.toContain("https://www.kclsu.org/events/");
    expect(retired).toContain("https://www.kclsu.org/events/");
  });

  it("reads RVT What's On and 100 Club Northern Soul from the cache again after their fresh read (D-480)", () => {
    for (const seed of LONDON_SOURCES) {
      expect(seed.extractUncached, seed.url).toBeUndefined();
    }
  });

  it("reads Luminous's Dandelion feed and Ecstatic Dance Culture's Eventbrite organiser (D-573)", () => {
    const byUrl = new Map(LONDON_SOURCES.map((seed) => [seed.url, seed]));
    const luminous = byUrl.get("https://dandelion.events/o/luminous/events");
    expect(luminous?.kind).toBe("feed_ics");
    expect(luminous?.feedUrl).toBe("https://dandelion.events/o/luminous/events.ics?slug=luminous");
    expect(luminous?.styles).toEqual(["ecstatic_dance"]);
    const edc = byUrl.get("https://www.eventbrite.co.uk/o/ecstatic-dance-culture-96657538473");
    expect(edc?.platform).toBe("eventbrite");
    expect(edc?.styles).toEqual(["ecstatic_dance"]);
  });

  it("reads Pleasure Medicine's OutSavvy page at Waking Dreams (D-573)", () => {
    const pm = LONDON_SOURCES.find(
      (seed) => seed.url === "https://www.outsavvy.com/event/32514/pleasure-medicine-2026",
    );
    expect(pm?.venueAddress).toBe("Waking Dreams, 6b Ada Street, London E8 4QU");
    expect(pm?.onlyHere).toBe(true);
    expect(pm?.styles).toEqual(["queer_party", "ecstatic_dance"]);
  });
});

describe("London's outside towns", () => {
  it("reads a title naming a town outside Greater London as not London's night", () => {
    expect(titleNamesOutsideTown("london", "Big Swindon Bash @ The Deanery")).toBe("Swindon");
    expect(titleNamesOutsideTown("london", "Ceroc Tadcaster Halloween Freestyle")).toBe(
      "Tadcaster",
    );
  });

  it("keeps London places that share a name with a town elsewhere", () => {
    expect(titleNamesOutsideTown("london", "Salsa at Oxford Street")).toBeNull();
    expect(titleNamesOutsideTown("london", "Cambridge Heath Disco")).toBeNull();
    expect(titleNamesOutsideTown("london", "Leicester Square Social")).toBeNull();
  });
});
