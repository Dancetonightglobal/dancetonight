// D-830: two clubs on one ticket site (mandalatickets.com: Rakata, Santito Tun-Tun) are not one organiser.
// The Tulum 11-10 read merged "SANTITO TUN - TUN" into "RAKATA" on four nights ("same organiser site").
import { describe, expect, it } from "vitest";
import { sharedTicketSites } from "@/src/domain/shared-ticket-sites";
import { organizerLink, type LinkSide } from "@/src/domain/dedupe";
import { TULUM_SOURCES } from "@/config/sources/tulum";

describe("sharedTicketSites", () => {
  it("names a site whose venue pages carry two labels", () => {
    const sites = sharedTicketSites([
      { url: "https://mandalatickets.com/en/playa/rakata", venuePage: true, label: "Rakata" },
      {
        url: "https://mandalatickets.com/en/playa/santito",
        venuePage: true,
        label: "Santito Tun-Tun",
      },
    ]);
    expect([...sites]).toEqual(["mandalatickets.com"]);
  });

  it("does not name one venue's own site, even with several pages", () => {
    const sites = sharedTicketSites([
      { url: "https://club.example/events", venuePage: true, label: "Club" },
      { url: "https://www.club.example/calendar", venuePage: true, label: "Club" },
    ]);
    expect(sites.size).toBe(0);
  });

  it("names a site whose venue pages give two addresses", () => {
    const sites = sharedTicketSites([
      { url: "https://t.example/a", venuePage: true, label: "A", venueAddress: "1 Calle 12" },
      { url: "https://t.example/b", venuePage: true, label: "B", venueAddress: "5 Avenida 10" },
    ]);
    expect([...sites]).toEqual(["t.example"]);
  });

  it("does not name one club's several nights at one address (Papa Dubai)", () => {
    const address = "Papa Dubai, V Hotel, Atrium Level 3, Al Habtoor City, Business Bay, Dubai";
    const sites = sharedTicketSites([
      {
        url: "https://papadubai.ae/papasito",
        venuePage: true,
        label: "Papasito",
        venueAddress: address,
      },
      {
        url: "https://papadubai.ae/french-kiss",
        venuePage: true,
        label: "French Kiss",
        venueAddress: address,
      },
    ]);
    expect(sites.size).toBe(0);
  });

  it("ignores pages that are not venue pages", () => {
    const sites = sharedTicketSites([
      { url: "https://org.example/a", label: "A" },
      { url: "https://org.example/b", label: "B" },
    ]);
    expect(sites.size).toBe(0);
  });

  it("names mandalatickets.com for Tulum's seeds", () => {
    expect(sharedTicketSites(TULUM_SOURCES).has("mandalatickets.com")).toBe(true);
  });
});

describe("organizerLink without the shared ticket site", () => {
  const side = (id: string, sourceId: string, sites: string[]): LinkSide => ({
    id,
    sourceId,
    trust: "first_party",
    titleNormalized: id,
    listingType: "club_night",
    sites,
    names: [],
    startsAt: new Date("2026-11-14T02:00:00Z"),
    fromRule: false,
    mergedSources: [],
  });

  it("links two first-party pages of one site (the old reading)", () => {
    expect(
      organizerLink(
        side("rakata", "s1", ["mandalatickets.com"]),
        side("santito", "s2", ["mandalatickets.com"]),
      ),
    ).toBe("same_site");
  });

  it("does not link them once the shared ticket site is left out of their sites", () => {
    const ticket = sharedTicketSites(TULUM_SOURCES);
    const keep = (sites: string[]) => sites.filter((s) => !ticket.has(s));
    expect(
      organizerLink(
        side("rakata", "s1", keep(["mandalatickets.com"])),
        side("santito", "s2", keep(["mandalatickets.com"])),
      ),
    ).toBeNull();
  });
});
