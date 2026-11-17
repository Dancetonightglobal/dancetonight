import { describe, expect, it } from "vitest";
import { listCopyAndOwnPage } from "@/src/domain/list-and-page";
import type { DedupeSide } from "@/src/domain/dedupe";

// D-844: escualita.com's one read on 2026-11-10 gave the 11-15 night twice at Rouge Pigalle, both untimed:
// the home page's "Escualita la soireé transexuelle" and the event page's "ESCUALITA LA SOIRÉE TRANSEXUELLE
// DIMANCHE SOIR AU ROUGE PIGALLE, PARIS". The list copy's title heads the event page's word for word, but the
// event page adds non-generic words, so D-767 kept two cards (Paris daily 2026-11-10, section C).
const base: DedupeSide = {
  id: "x",
  startsAt: null,
  organizerId: null,
  organizerName: null,
  venueId: "v-c54f5b7d",
  venuePoint: { lat: 48.8816, lng: 2.3376 },
  venueName: "ROUGE PIGALLE",
  venueAddress: "77 rue Jean-Baptiste Pigalle 75009 Paris",
  ticketUrl: null,
  canonicalUrl: null,
  trust: "first_party",
  firstSeenAt: new Date("2026-11-08T05:43:00Z"),
  title: "",
  listingType: "club_night",
  cancelled: undefined,
  links: [],
};

const home: DedupeSide = {
  ...base,
  id: "68cca9f4",
  title: "Escualita la soireé transexuelle",
  canonicalUrl: "https://www.escualita.com/",
};
const page: DedupeSide = {
  ...base,
  id: "c0ed85a4",
  title: "ESCUALITA LA SOIRÉE TRANSEXUELLE DIMANCHE SOIR AU ROUGE PIGALLE, PARIS",
  canonicalUrl:
    "https://www.escualita.com/la-soiree/2026/11/15/escualita-la-soire-transexuelle-dimanche-soir-au-rouge-pigalle-paris",
};

describe("a list copy whose title heads its event page's (D-844)", () => {
  it("Escualita home-page copy and event page are one night", () => {
    expect(listCopyAndOwnPage(home, page)).toBe(true);
    expect(listCopyAndOwnPage(page, home)).toBe(true);
  });

  it("the 11-08 home-page title variant heads it too", () => {
    const other = { ...home, title: "Escualita - La Soirée Transexuelle Dimanche Soir" };
    expect(listCopyAndOwnPage(other, page)).toBe(true);
  });

  it("one telling word at the head is not enough", () => {
    const short = { ...home, title: "Escualita" };
    const long = { ...page, title: "Escualita Afterparty Special at Rouge Pigalle" };
    expect(listCopyAndOwnPage(short, long)).toBe(false);
  });

  it("generic words at the head are not enough", () => {
    const short = { ...home, title: "Salsa Night" };
    const long = { ...page, title: "Salsa Night with Orquesta Tumbao" };
    expect(listCopyAndOwnPage(short, long)).toBe(false);
  });

  it("a title that does not head the other still needs D-767's generic-only tail", () => {
    const short = { ...home, title: "La soirée transexuelle Escualita" };
    expect(listCopyAndOwnPage(short, page)).toBe(false);
  });

  it("still needs exactly one side with its own page", () => {
    const pageless = { ...page, canonicalUrl: "https://www.escualita.com/" };
    expect(listCopyAndOwnPage(home, pageless)).toBe(false);
  });

  it("still needs one start", () => {
    const timed = { ...page, startsAt: new Date("2026-11-15T22:00:00Z") };
    expect(listCopyAndOwnPage(home, timed)).toBe(false);
  });

  it("still needs one place", () => {
    const elsewhere = {
      ...page,
      venueId: "v-other",
      venueName: "Le Tango",
      venueAddress: "13 rue au Maire 75003 Paris",
      venuePoint: { lat: 48.8649, lng: 2.3561 },
    };
    expect(listCopyAndOwnPage(home, elsewhere)).toBe(false);
  });
});
