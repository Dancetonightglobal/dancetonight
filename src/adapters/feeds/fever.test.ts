import { describe, expect, it } from "vitest";
import {
  feverEventBlocks,
  feverPagePlace,
  feverPlace,
  isFeverHost,
} from "@/src/adapters/feeds/fever";
import { eventPagePlace, jsonLdToListings } from "@/src/adapters/feeds/jsonld";

const PAGE = `<html><head><title>Tickets for Unlocked Pres. Mvgri (Anl) at BASSHAUS, Barcelona | Fever</title></head>
<body><script id="serverApp-state" type="application/json">{"plan":{"places":[{"address":"Carrer del Plom, 1, Barcelona, 08038","faq":null,"hasPlacePage":false,"id":184669,"latitude":41.351696,"locale":"es","longitude":2.135543,"metroStations":[{"id":1,"name":"Not The Venue","images":["https:\\u002F\\u002Fx"]}],"name":"BASSHAUS","slug":null}],"defaultSession":{"endsAtIso":"2026-11-22T06:00:00+01:00","id":611427140,"startsAtIso":"2026-11-21T23:45:00+01:00"},"multipleSessions":false,"name":"Unlocked Pres. Mvgri (Anl)"},
"x":{"level":{"type":"session","items":[{"value":{"starts_at_iso":"2026-11-21T23:45:00+01:00","ends_at_iso":"2026-11-22T06:00:00+01:00"}},{"value":{"starts_at_iso":"2026-11-21T23:45:00+01:00","ends_at_iso":"2026-11-22T06:00:00+01:00"}}]}}}</script></body></html>`;
const URL_EN = "https://feverup.com/m/828687/en";

describe("fever.ts", () => {
  describe("isFeverHost", () => {
    it("returns true for feverup.com", () => {
      expect(isFeverHost("https://feverup.com/m/1")).toBe(true);
      expect(isFeverHost("https://www.feverup.com/m/1")).toBe(true);
    });
    it("returns false for non-Fever domains", () => {
      expect(isFeverHost("https://notfeverup.com/m/1")).toBe(false);
      expect(isFeverHost("not a url")).toBe(false);
    });
  });

  describe("feverEventBlocks", () => {
    it("returns exactly 1 event with deduped sessions", () => {
      const blocks = feverEventBlocks(PAGE, URL_EN);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toEqual({
        "@type": "Event",
        name: "Unlocked Pres. Mvgri (Anl)",
        startDate: "2026-11-21T23:45:00+01:00",
        endDate: "2026-11-22T06:00:00+01:00",
        url: URL_EN,
        location: {
          "@type": "Place",
          name: "BASSHAUS",
          address: "Carrer del Plom, 1, Barcelona, 08038",
          geo: {
            "@type": "GeoCoordinates",
            latitude: 41.351696,
            longitude: 2.135543,
          },
        },
      });
    });

    it("handles two different sessions", () => {
      // Create a page with two different session pairs
      const modifiedPage = PAGE.replace(
        '"items":[{"value":{"starts_at_iso":"2026-11-21T23:45:00+01:00","ends_at_iso":"2026-11-22T06:00:00+01:00"}},{"value":{"starts_at_iso":"2026-11-21T23:45:00+01:00","ends_at_iso":"2026-11-22T06:00:00+01:00"}}]',
        '"items":[{"value":{"starts_at_iso":"2026-11-21T23:45:00+01:00","ends_at_iso":"2026-11-22T06:00:00+01:00"}},{"value":{"starts_at_iso":"2026-11-28T23:00:00+01:00","ends_at_iso":"2026-11-29T05:00:00+01:00"}}]',
      );
      const blocks = feverEventBlocks(modifiedPage, URL_EN);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]!.startDate).toBe("2026-11-21T23:45:00+01:00");
      expect(blocks[1]!.startDate).toBe("2026-11-28T23:00:00+01:00");
    });

    it("falls back to defaultSession when no starts_at_iso", () => {
      const noXPage = `<html><body><script>{"plan":{"places":[{"address":"Carrer del Plom, 1","latitude":41.35,"longitude":2.13,"name":"BASSHAUS"}],"defaultSession":{"endsAtIso":"2026-11-22T06:00:00+01:00","startsAtIso":"2026-11-21T23:45:00+01:00"},"multipleSessions":false,"name":"Test"}}</script></body></html>`;
      const blocks = feverEventBlocks(noXPage, URL_EN);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.startDate).toBe("2026-11-21T23:45:00+01:00");
      expect(blocks[0]!.endDate).toBe("2026-11-22T06:00:00+01:00");
    });

    it("returns event without location when no places", () => {
      const noPlacesPage = `<html><body><script>{"plan":{"defaultSession":{"startsAtIso":"2026-11-21T23:45:00+01:00"},"multipleSessions":false,"name":"Test"}}</script></body></html>`;
      const blocks = feverEventBlocks(noPlacesPage, URL_EN);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.location).toBeUndefined();
      expect("location" in blocks[0]!).toBe(false);
    });

    it("returns [] for non-Fever URL", () => {
      const blocks = feverEventBlocks(PAGE, "https://example.com/m/828687");
      expect(blocks).toEqual([]);
    });

    it("returns [] when no name match", () => {
      const noNamePage = `<html><body><script>{"plan":{}}</script></body></html>`;
      const blocks = feverEventBlocks(noNamePage, URL_EN);
      expect(blocks).toEqual([]);
    });

    it("does not throw on a truncated places array; the event has no location", () => {
      const brokenPage = `<html><body><script>{"plan":{"defaultSession":{"startsAtIso":"2026-11-21T23:45:00+01:00"},"multipleSessions":false,"name":"Test","places":[{"address":"x"`;
      const blocks = feverEventBlocks(brokenPage, URL_EN);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]!.startDate).toBe("2026-11-21T23:45:00+01:00");
      expect("location" in blocks[0]!).toBe(false);
    });
  });

  describe("end-to-end through jsonLdToListings", () => {
    it("produces a HarvestedListing with correct venue point", () => {
      const blocks = feverEventBlocks(PAGE, URL_EN);
      const { listings } = jsonLdToListings(blocks, {
        pageUrl: URL_EN,
        fetchedAt: new Date("2026-11-01T12:00:00Z"),
        metroTz: "Europe/Madrid",
        countryCode: "ES",
        fromNight: "2026-11-01",
        days: 30,
      });
      expect(listings).toHaveLength(1);
      const listing = listings[0]!;
      expect(listing.listing.local_date).toBe("2026-11-21");
      expect(listing.venueLocation).toEqual({
        lat: 41.351696,
        lng: 2.135543,
      });
      // Check venue name via the listing's venue field (it's an object in RawListing)
      expect(listing.listing.venue).toEqual({
        name: "BASSHAUS",
        address: "Carrer del Plom, 1, Barcelona, 08038",
        url: null,
      });
    });
  });
});

// feverup.com/m/601741 (2026-10-30, trimmed): the Event JSON-LD names only the town; the plan data has the street.
const SAUVAGE = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"Event",
"name":"Tay Oskee en Club Sauvage, Barcelona 2026","startDate":"2026-11-06T21:00:00+01:00",
"location":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"Barcelona"},
"geo":{"@type":"GeoCoordinates","latitude":41.380513,"longitude":2.175273},"name":"Club Sauvage (antigua sala Sidecar)"}}</script></head>
<body><script id="serverApp-state" type="application/json">{"plan":{"places":[{"address":"Plaza Real, 7, 08002","faq":null,"hasPlacePage":true,"id":12039,"latitude":41.380513,"longitude":2.175273,"metroStations":[{"id":1853,"name":"Liceu"}],"name":"Club Sauvage (antigua sala Sidecar)"}],"multipleSessions":false,"name":"Tay Oskee en Club Sauvage, Barcelona 2026"}}</script></body></html>`;
const SAUVAGE_URL = "https://feverup.com/m/601741";

describe("feverPlace and feverPagePlace", () => {
  it("reads the first place of a Fever page's plan data", () => {
    expect(feverPlace(SAUVAGE)).toEqual({
      name: "Club Sauvage (antigua sala Sidecar)",
      address: "Plaza Real, 7, 08002",
      location: { lat: 41.380513, lng: 2.175273 },
    });
    expect(feverPlace("<html><body>no plan</body></html>")).toBeNull();
    expect(feverPlace('{"places":[{"name":"X","address":"  "}]}')).toBeNull();
    expect(feverPlace('{"places":[{"name":"X","address":"Carrer Gran, 3"}]}')).toEqual({
      name: "X",
      address: "Carrer Gran, 3",
      location: null,
    });
  });

  it("takes Fever's street address over JSON-LD that names only the town", () => {
    const fromJsonLd = eventPagePlace(SAUVAGE);
    expect(fromJsonLd?.address).not.toMatch(/\d/);
    expect(feverPagePlace(SAUVAGE, SAUVAGE_URL, fromJsonLd)).toEqual({
      name: "Club Sauvage (antigua sala Sidecar)",
      address: "Plaza Real, 7, 08002",
      location: { lat: 41.380513, lng: 2.175273 },
      evidence: "location Club Sauvage (antigua sala Sidecar), Plaza Real, 7, 08002",
    });
    // No JSON-LD place at all: Fever's plan data alone.
    expect(feverPagePlace(SAUVAGE, SAUVAGE_URL, null)?.address).toBe("Plaza Real, 7, 08002");
  });

  it("keeps the JSON-LD place when it has a street, the page is not Fever's, or Fever has no place", () => {
    const street = {
      name: "Sala",
      address: "Carrer Nou, 12, 08001 Barcelona",
      location: null,
      evidence: "location Sala, Carrer Nou, 12, 08001 Barcelona",
    };
    expect(feverPagePlace(SAUVAGE, SAUVAGE_URL, street)).toBe(street);
    const town = {
      name: "Sala",
      address: "Barcelona",
      location: null,
      evidence: "location Sala, Barcelona",
    };
    expect(feverPagePlace(SAUVAGE, "https://xceed.me/es/barcelona/event/1", town)).toBe(town);
    expect(feverPagePlace("<html></html>", SAUVAGE_URL, town)).toBe(town);
    expect(feverPagePlace("<html></html>", SAUVAGE_URL, null)).toBeNull();
  });
});
