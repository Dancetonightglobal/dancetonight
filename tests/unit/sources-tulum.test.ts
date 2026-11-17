import type { HarvestedListing } from "@/src/adapters/types";
import { withKnownVenue } from "@/src/pipeline/source-venue";
import { KNOWN_VENUES } from "@/config/known-venues";
// Tulum's source list keeps its promises (D-047, D-1080..D-1082): one row per address, real style keys, TicketFairy
// read as a mixed calendar, Grupo Mandala's clubs as weekly grids on their own pages, Bagatelle left out.
import { describe, expect, it } from "vitest";

import { eventbriteTarget } from "@/src/adapters/apis/eventbrite";
import { fixedNightListings, lineOnPage } from "@/src/domain/fixed-nights";
import { isNamedDanceNight } from "@/src/domain/listing-screen";
import { TULUM_RETIRED, TULUM_SOURCES } from "@/config/sources/tulum";
import { STYLES } from "@/config/styles";

const listed = TULUM_SOURCES.map((seed) => seed.url);

describe("Tulum's source list", () => {
  it("lists each address once, every url is http(s), none retired", () => {
    expect(new Set(listed).size).toBe(listed.length);
    for (const url of listed) expect(new URL(url).protocol).toMatch(/^https?:$/);
    const retired = TULUM_RETIRED.map((gone) => gone.url);
    expect(listed.filter((url) => retired.includes(url))).toEqual([]);
  });

  it("every style named by a source is a real style key", () => {
    const styleKeys = STYLES.map((s) => s.key);
    for (const seed of TULUM_SOURCES)
      for (const style of seed.styles) expect(styleKeys).toContain(style);
  });

  it("reads TicketFairy for Quintana Roo as a mixed calendar (D-1081)", () => {
    const tf = TULUM_SOURCES.filter((s) => s.platform === "ticketfairy");
    expect(tf).toHaveLength(1);
    const [row] = tf;
    expect(row?.kind).toBe("ticketing_api");
    expect(row?.trustTier).toBe("ticketing");
    expect(row?.mixedCalendar).toBe(true);
    const url = new URL(row?.url ?? "");
    expect(url.searchParams.get("country")).toBe("MX");
    expect(url.searchParams.get("state")).toBe("Quintana Roo");
    expect(row?.url).not.toContain(" ");
  });

  it("names TicketFairy's club nights as dance nights, not the Las Gitanas dinner", () => {
    const row = TULUM_SOURCES.find((s) => s.platform === "ticketfairy");
    for (const title of [
      "GYPSY DISCO",
      "GYPSY DISCO SPECIAL EDITION",
      "CEREMONIA GITANO BEACH",
      "LA NOCHE",
      "PAPAYA PLAYA PROJECT Presents • STARLIGHT",
      "MERA ROOM X GITANO BEACH",
    ]) {
      expect(isNamedDanceNight(title, row?.danceNights)).toBe(true);
    }
    expect(isNamedDanceNight("LAS GITANAS", row?.danceNights)).toBe(false);
  });

  it("lists Grupo Mandala's six nightclubs as weekly grids on their own pages, not Bagatelle (D-1082)", () => {
    const clubs = TULUM_SOURCES.filter((s) => s.url.startsWith("https://mandalatickets.com/en/"));
    expect(clubs.map((s) => s.label)).toEqual([
      "Rakata Playa del Carmen",
      "Mandala Playa del Carmen",
      "La Vaquita Playa del Carmen",
      "Santito Tun Tun",
      "Vagalume Tulum",
      "Bonbonniere Tulum",
    ]);
    for (const club of clubs) {
      expect(club.kind).toBe("html");
      expect(club.trustTier).toBe("first_party");
      expect(club.venuePage).toBe(true);
      expect(club.weeklyGrid).toBe(true);
      expect(club.venueAddress).toMatch(/Q\.R\.$/);
      expect(club.styles).toEqual(["dj_night"]);
      expect(club.url).not.toContain("?");
    }
    expect(listed.some((url) => /bagatelle/i.test(url))).toBe(false);
  });

  it("reads Casa Jaguar's and Tehmplo's own dated pages as venue pages", () => {
    for (const host of ["https://casajaguar.com.mx/", "https://www.tehmplo.com/"]) {
      const row = TULUM_SOURCES.find((s) => s.url === host);
      expect(row?.trustTier).toBe("first_party");
      expect(row?.venuePage).toBe(true);
      expect(row?.venueAddress).toMatch(/Tulum, Q\.R\.$/);
      expect(row?.weeklyGrid).toBeUndefined();
    }
  });

  it("reads Salsa Vida's guides as dance-only, not mixed calendars (D-321, D-772)", () => {
    const sv = TULUM_SOURCES.filter((s) => s.url.startsWith("https://www.salsavida.com/"));
    expect(sv).toHaveLength(4);
    for (const row of sv) expect(row.mixedCalendar).toBe(false);
    // Salsa Vida's clock is read as local time for every page (D-778), so no seed flag (D-1083).
    for (const row of sv) expect(row.wallClockTimes).toBeUndefined();
  });

  it("reads nine Eventbrite organisers by organiser id", () => {
    const eb = TULUM_SOURCES.filter((s) => s.platform === "eventbrite");
    expect(eb.map((s) => eventbriteTarget(s.url)?.id)).toEqual([
      "106302940951",
      "120706727578",
      "59233430753",
      "106082337461",
      "62134899853",
      "31642299401",
      "81469450903",
      "84172984083",
      "121951289955",
    ]);
    for (const row of eb) expect(row.mixedCalendar).toBe(true);
  });

  it("hand-checks Let's Dance Mexico's LUSH Fridays and Latin Sunset Sundays from its own Instagram (D-796, D-797, D-802)", () => {
    const ldm = TULUM_SOURCES.find((s) => s.url === "https://www.instagram.com/letsdancemex/");
    expect(ldm?.handChecked).toBe(true);
    // An organiser's account, not a venue's: no seed venue named after the label, and two venues so no seed address.
    expect(ldm?.venuePage).toBeUndefined();
    expect(ldm?.venueAddress).toBeUndefined();
    const nights = ldm?.fixedNights ?? [];
    expect(nights).toHaveLength(2);
    const cases = [
      {
        night: { days: [5], start: "21:00", end: "01:00", venue: "Aloft Playa del Carmen" },
        date: "2026-11-13",
        address: "Calle 34 Norte, Gonzalo Guerrero, 77720 Playa del Carmen, Q.R.",
        point: { lat: 20.6347832, lng: -87.0682782 },
        bare: "Aloft",
      },
      {
        night: { days: [0], start: "19:00", end: "23:00", venue: "Fiesta Inn Playa del Carmen" },
        date: "2026-11-15",
        address: "10 Avenida Norte, Gonzalo Guerrero, 77720 Playa del Carmen, Q.R.",
        point: { lat: 20.6330453, lng: -87.0693367 },
        bare: "Fiesta Inn",
      },
    ];
    for (const c of cases) {
      const night = nights.find((n) => n.venue === c.night.venue);
      expect(night).toMatchObject(c.night);
      expect(night?.evidenceUrl).toMatch(/^https:\/\/www\.instagram\.com\/letsdancemex\/p\//);
      const known = (KNOWN_VENUES.tulum ?? []).find((k) => k.names.includes(c.night.venue));
      expect(known?.address).toBe(c.address);
      expect(known?.point).toEqual(c.point);
      // A bare chain name would also match the chain's other hotels.
      expect(known?.names).not.toContain(c.bare);
      // A row at the night's venue with no address is placed at that venue's checked point.
      const row = {
        listing: {
          title: night?.title,
          listing_type: "social",
          styles: ["salsa"],
          local_date: c.date,
          venue: { name: c.night.venue, address: null, url: null },
          organizer: { name: null, url: null },
        },
        externalId: `test:${c.date}`,
        tz: "America/Cancun",
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: ldm?.url, fetchedAt: new Date(), method: "config" },
      } as unknown as HarvestedListing;
      const placed = withKnownVenue(row, KNOWN_VENUES.tulum, "MX");
      expect(placed.listing.venue.address).toBe(c.address);
      expect(placed.venueLocation).toEqual(c.point);
    }
  });

  it("hand-checks Tulum Salsa Academy's Wednesday El Barrio and Thursday The Space nights (D-796, D-797, D-802)", () => {
    const ig = TULUM_SOURCES.filter((s) => s.url.startsWith("https://www.instagram.com/"));
    expect(ig.map((s) => s.url).sort()).toEqual([
      "https://www.instagram.com/bodeguitadelmedio.pdc/",
      "https://www.instagram.com/letsdancemex/",
      "https://www.instagram.com/tulumsalsa.academy/",
    ]);
    const tsa = ig.find((s) => s.url === "https://www.instagram.com/tulumsalsa.academy/");
    expect(tsa?.handChecked).toBe(true);
    expect(tsa?.venuePage).toBeUndefined();
    expect(tsa?.venueAddress).toBeUndefined();
    const nights = tsa?.fixedNights ?? [];
    expect(nights).toHaveLength(2);
    const cases = [
      {
        night: { days: [3], start: "18:00", end: "01:00", venue: "El Barrio Tulum" },
        date: "2026-11-11",
        address: "Av. Tulum, Tulum Centro, Col. Huracanes, 77760 Tulum, Q.R.",
        point: { lat: 20.2131139, lng: -87.4560911 },
        bare: "El Barrio",
      },
      {
        night: { days: [4], start: "20:00", venue: "The Space Tulum" },
        date: "2026-11-12",
        address: "C. Tulum Manzana 33 Lote 002, La Veleta, 77760 Tulum, Q.R.",
        point: { lat: 20.2056019, lng: -87.4782665 },
        bare: "The Space",
      },
    ];
    expect(nights.find((n) => n.venue === "The Space Tulum")?.end).toBeUndefined();
    for (const c of cases) {
      const night = nights.find((n) => n.venue === c.night.venue);
      expect(night).toMatchObject(c.night);
      expect(night?.evidenceUrl).toMatch(
        /^https:\/\/www\.instagram\.com\/tulumsalsa\.academy\/p\//,
      );
      const known = (KNOWN_VENUES.tulum ?? []).find((k) => k.names.includes(c.night.venue));
      expect(known?.address).toBe(c.address);
      expect(known?.point).toEqual(c.point);
      expect(known?.names).not.toContain(c.bare);
      const row = {
        listing: {
          title: night?.title,
          listing_type: "social",
          styles: ["bachata"],
          local_date: c.date,
          venue: { name: c.night.venue, address: null, url: null },
          organizer: { name: null, url: null },
        },
        externalId: `test:${c.date}`,
        tz: "America/Cancun",
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: tsa?.url, fetchedAt: new Date(), method: "config" },
      } as unknown as HarvestedListing;
      const placed = withKnownVenue(row, KNOWN_VENUES.tulum, "MX");
      expect(placed.listing.venue.address).toBe(c.address);
      expect(placed.venueLocation).toEqual(c.point);
    }
  });

  it("hand-checks La Bodeguita del Medio Playa's nightly live salsa from its own Instagram, leaving Tuesday to Salsa Vida (D-796, D-797)", () => {
    const bodeguita = TULUM_SOURCES.find(
      (s) => s.url === "https://www.instagram.com/bodeguitadelmedio.pdc/",
    );
    expect(bodeguita).toBeDefined();
    expect(bodeguita?.handChecked).toBe(true);
    expect(bodeguita?.venueAddress).toContain("Calle 34");
    expect(bodeguita?.venueAddress).toContain("Playa del Carmen");
    const nights = bodeguita?.fixedNights ?? [];
    expect(nights).toHaveLength(1);
    const night = nights[0];
    expect(night?.days).toEqual([0, 1, 3, 4, 5, 6]);
    expect(night?.start).toBe("21:00");
    expect(night?.end).toBeUndefined();
    expect(night?.styles).toEqual(["salsa"]);
    expect(night?.venue).toBe("La Bodeguita del Medio");
    expect(night?.checkedOn).toBe("2026-11-10");
    expect(night?.evidenceUrl).toMatch(
      /^https:\/\/www\.instagram\.com\/bodeguitadelmedio\.pdc\/p\//,
    );
    expect(night?.danceCited).toContain("bailar");
  });

  it("lists Vagalume's Thursday-to-Sunday night club as a fixed night while its page writes the hours", () => {
    const vagalume = TULUM_SOURCES.find(
      (s) => s.url === "https://mandalatickets.com/en/tulum/disco/Vagalume",
    );
    const night = vagalume?.fixedNights?.[0];
    expect(vagalume?.fixedNights).toHaveLength(1);
    expect(night).toMatchObject({ days: [4, 5, 6, 0], start: "19:00", end: "01:00" });
    // The page's own markup (2026-11-09): the beach club's day hours are not the night.
    const page =
      "<b>Open:</b> from Thursday to Sunday <b>Beach club&nbsp;</b>11:00 am - 6:00 pm<b>&nbsp;| Night Club&nbsp;</b>7:00 pm - 1:00 am <b><br></b><b>Music:</b> Electronic";
    expect(lineOnPage(night?.line ?? "", page)).toBe(true);
    const options = {
      pageText: page,
      pageUrl: vagalume?.url ?? "",
      fetchedAt: new Date("2026-11-09T15:00:00Z"),
      fromNight: "2026-11-09",
      currency: "MXN",
      sourceStyles: vagalume?.styles ?? [],
      venueName: vagalume?.label ?? null,
      venueAddress: vagalume?.venueAddress ?? null,
      zone: "America/Cancun",
    };
    const fixed = fixedNightListings(vagalume?.fixedNights ?? [], options);
    expect(fixed.listings).toHaveLength(1);
    expect(fixed.listings[0]?.listing.title).toBe("Vagalume Night Club");
    expect(fixed.listings[0]?.listing.venue.name).toBe("Vagalume Tulum");
    // A page that stops writing the hours lists nothing.
    const gone = fixedNightListings(vagalume?.fixedNights ?? [], {
      ...options,
      pageText: "Open: from Thursday to Sunday",
    });
    expect(gone.listings).toHaveLength(0);
  });

  it("lists La Vaquita's Thursday-to-Sunday nights as a fixed night, replacing the model's dashed title", () => {
    const vaquita = TULUM_SOURCES.find(
      (s) => s.url === "https://mandalatickets.com/en/playa/disco/la-vaquita",
    );
    const night = vaquita?.fixedNights?.[0];
    expect(vaquita?.fixedNights).toHaveLength(1);
    expect(night).toMatchObject({ days: [4, 5, 6, 0], start: "20:30", end: "03:00" });
    expect(night?.replacesTitles).toContain("LA VAQUITA - PLAYA DEL CARMEN");
    // The page's own markup (2026-11-10).
    const page =
      "<b>Open: </b>From Thursday to Sunday starting at 8:30 PM to 3:00 AM<b></b><br><b>Music:&nbsp;</b>Reggaeton, hip hop and R&amp;B";
    expect(lineOnPage(night?.line ?? "", page)).toBe(true);
    const options = {
      pageText: page,
      pageUrl: vaquita?.url ?? "",
      fetchedAt: new Date("2026-11-10T15:00:00Z"),
      fromNight: "2026-11-10",
      currency: "MXN",
      sourceStyles: vaquita?.styles ?? [],
      venueName: vaquita?.label ?? null,
      venueAddress: vaquita?.venueAddress ?? null,
      zone: "America/Cancun",
    };
    const fixed = fixedNightListings(vaquita?.fixedNights ?? [], options);
    expect(fixed.listings).toHaveLength(1);
    expect(fixed.listings[0]?.listing.venue.name).toBe("La Vaquita Playa del Carmen");
    expect(fixed.listings[0]?.listing.venue.address).toBe(vaquita?.venueAddress);
    const gone = fixedNightListings(vaquita?.fixedNights ?? [], {
      ...options,
      pageText: "Open: From Thursday",
    });
    expect(gone.listings).toHaveLength(0);
  });

  it("reads Casa Jaguar's DJ lineups as dance nights, not band billings (D-341)", () => {
    const jaguar = TULUM_SOURCES.find((s) => s.url === "https://casajaguar.com.mx/");
    expect(jaguar?.bandsForDancers).toBe(true);
    expect(jaguar?.mixedCalendar).toBe(true);
  });

  it("places Casa Jaguar's nights at its checked point, since the geocoder refuses its km address", () => {
    const jaguar = TULUM_SOURCES.find((s) => s.url === "https://casajaguar.com.mx/");
    const known = (KNOWN_VENUES.tulum ?? []).find((k) => k.names.includes("Casa Jaguar"));
    expect(known?.address).toBe(jaguar?.venueAddress);
    expect(known?.point).toEqual({ lat: 20.1517219, lng: -87.4583791 });
    for (const address of [jaguar?.venueAddress ?? null, null]) {
      const row = {
        listing: {
          title: "Casa Jaguar Anniversary – MoM + Special Guest",
          listing_type: "club_night",
          styles: ["dj_night"],
          local_date: "2026-11-12",
          venue: { name: "Casa Jaguar", address, url: null },
          organizer: { name: null, url: null },
        },
        externalId: "test:jaguar",
        tz: "America/Cancun",
        venueLocation: null,
        recurrence: null,
        provenance: { sourceUrl: jaguar?.url, fetchedAt: new Date(), method: "llm" },
      } as unknown as HarvestedListing;
      const placed = withKnownVenue(row, KNOWN_VENUES.tulum, "MX");
      expect(placed.listing.venue.address).toBe(jaguar?.venueAddress);
      expect(placed.venueLocation).toEqual({ lat: 20.1517219, lng: -87.4583791 });
    }
  });
});
