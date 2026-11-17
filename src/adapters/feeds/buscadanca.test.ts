import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MAX_LIST_PAGES,
  buscadancaAdapter,
  buscadancaCards,
  cleanBuscadancaAddress,
} from "@/src/adapters/feeds/buscadanca";
import { MAX_ITEM_PAGES } from "@/src/adapters/feeds/event-pages";
import type { Metro, RunCtx, Source } from "@/src/adapters/types";
import { createPoliteHttp, fixtureTransport, type Fixture } from "@/src/pipeline/http";

// buscadanca.com.br/cidade-evento/rio-de-janeiro/ (2026-10-31), read with the site's written permission (D-543).
// Each list page is cut to its listing cards (icons, images and layout attributes removed); page 3 holds other
// cities' cards and Rio cards already seen, so paging stops there. Each event page is cut to its title and JSON-LD.
const DIR = path.join(__dirname, "__fixtures__", "buscadanca");
const read = (name: string) => readFileSync(path.join(DIR, name), "utf8");

const LIST = "https://buscadanca.com.br/cidade-evento/rio-de-janeiro/";
const ITEM = (slug: string) => `https://buscadanca.com.br/eventos-de-danca/${slug}/`;

// The 16 weekly Rio cards on pages 1-2, in list order.
const WEEKLY = [
  "forro-no-encontro-street-food-park",
  "forro-no-madame-baderna-cultural",
  "maravilhas-de-baile",
  "movimento-cultural-de-xaxado-urbano",
  "forro-na-feira-de-sao-cristovao",
  "milonga-xango",
  "forro-no-hops-rio",
  "forro-da-gloria",
  "projeto-charme-de-rua",
  "forro-da-praca-rj",
  "forro-no-clube-democraticos",
  "dominguinhos-de-pife",
  "forro-de-pife-descalco",
  "zouk-lounge-rio",
  "forro-no-vuvu-rio",
  "baile-do-forro-de-pife",
];

const RIO: Metro = {
  id: "m",
  slug: "rio-de-janeiro",
  name: "Rio de Janeiro",
  countryCode: "BR",
  center: { lat: -22.9068, lng: -43.1729 },
  radiusKm: 40,
  tz: "America/Sao_Paulo",
  languages: ["pt"],
};

const source = (): Source => ({
  id: "s",
  url: LIST,
  kind: "jsonld",
  trustTier: "directory",
  platform: "buscadanca",
  feedUrl: null,
  metroId: "m",
  styles: ["forro"],
  etag: null,
  lastModified: null,
  contentHash: null,
});

const html = (url: string, body: string, status = 200): Fixture => ({
  request: { method: "GET", url },
  response: { url, status, headers: { "content-type": "text/html" }, body },
});

function standard(overrides: Record<string, Fixture> = {}): Fixture[] {
  const all: Record<string, Fixture> = {
    [LIST]: html(LIST, read("list-p1-2026-10-31.html")),
    [`${LIST}page/2/`]: html(`${LIST}page/2/`, read("list-p2-2026-10-31.html")),
    [`${LIST}page/3/`]: html(`${LIST}page/3/`, read("list-p3-2026-10-31.html")),
  };
  for (const slug of WEEKLY) all[ITEM(slug)] = html(ITEM(slug), read(`item-${slug}.html`));
  return Object.values({ ...all, ...overrides });
}

/** The URLs asked for, in order (the transport records "GET <url>"). */
const asked = (c: { requests: string[] }) => c.requests.map((r) => r.replace(/^GET /, ""));

function ctx(fixtures: Fixture[], now: Date): RunCtx & { requests: string[] } {
  const transport = fixtureTransport([
    {
      request: { method: "GET", url: "https://buscadanca.com.br/robots.txt" },
      response: {
        url: "https://buscadanca.com.br/robots.txt",
        status: 200,
        headers: { "content-type": "text/plain" },
        body: "User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n",
      },
    },
    ...fixtures,
  ]);
  let t = now.getTime();
  return {
    metro: RIO,
    now: () => new Date(t),
    http: createPoliteHttp({
      transport,
      userAgent: "t",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    }),
    env: {},
    log: () => {},
    requests: transport.requests,
  };
}

// A made-up weekly Rio card and its own page, in the real markup, for the cap tests.
const card = (slug: string) =>
  `<div class="jet-listing-grid__item jet-listing-dynamic-post-1" data-post-id="1"><div class="jet-engine-listing-overlay-wrap" data-url="${ITEM(slug)}">` +
  `<p class="elementor-heading-title elementor-size-default"><a href="${ITEM(slug)}">Forró ${slug}</a></p>` +
  `<a href="https://buscadanca.com.br/estilo-evento/forro/" class="jet-listing-dynamic-terms__link">Forró</a>` +
  `<span class="elementor-icon-list-text">Evento semanal</span>` +
  `<a href="https://buscadanca.com.br/cidade-evento/rio-de-janeiro/" class="jet-listing-dynamic-terms__link">Rio de Janeiro</a>` +
  `<span class="jet-listing-dynamic-terms__link">Segunda-Feira</span>` +
  `<div class="jet-listing-dynamic-field__content" >20:00</div></div></div>`;
const listPage = (slugs: string[]) => `<html><body>${slugs.map(card).join("\n")}</body></html>`;
const itemPage = (slug: string) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "LocalBusiness",
        name: slug,
        url: ITEM(slug),
        address: {
          "@type": "PostalAddress",
          streetAddress: "Rua do Teste, 1, Centro, Rio de Janeiro, RJ",
        },
      },
    ],
  })}</script></head><body></body></html>`;
const pageUrl = (n: number) => (n === 1 ? LIST : `${LIST}page/${n}/`);

const NOW = new Date("2026-10-31T15:00:00Z"); // noon Saturday in Rio; tonight is 2026-10-31

describe("buscadancaCards", () => {
  it("reads every listing card on page 1 with its facts", () => {
    const cards = buscadancaCards(read("list-p1-2026-10-31.html"), LIST);
    const hops = cards.find((c) => c.url === ITEM("forro-no-hops-rio"))!;
    expect(hops).toEqual({
      url: ITEM("forro-no-hops-rio"),
      title: "Forró no Hops Rio",
      styleSlugs: ["forro"],
      citySlug: "rio-de-janeiro",
      frequency: "Evento semanal",
      days: ["MO"],
      start: "18:00",
      end: "00:00",
    });
    const feira = cards.find((c) => c.url === ITEM("forro-na-feira-de-sao-cristovao"))!;
    expect(feira.days).toEqual(["FR", "SA", "SU"]);
    expect(feira.start).toBeNull();
    expect(feira.end).toBeNull();
    const itza = cards.find((c) => c.url === ITEM("itza-bar-bistro-e-eventos"))!;
    expect(itza.frequency).toBe("Evento mensal");
    expect(itza.days).toEqual([]);
    // Cards from other cities on the same page are read too, with their own city.
    expect(cards.some((c) => c.citySlug !== "rio-de-janeiro")).toBe(true);
  });

  it("reads styles and two weekdays from page 2", () => {
    const cards = buscadancaCards(read("list-p2-2026-10-31.html"), `${LIST}page/2/`);
    const explosion = cards.find((c) => c.url === ITEM("zouk-explosion-rj"))!;
    expect(explosion.styleSlugs).toEqual(["bachata", "danca-de-salao", "salsa", "zouk"]);
    expect(explosion.frequency).toBe("Evento mensal");
    const lounge = cards.find((c) => c.url === ITEM("zouk-lounge-rio"))!;
    expect(lounge).toMatchObject({ days: ["WE"], start: "21:00", end: null });
  });

  it("finds no card on a page without listing cards", () => {
    expect(buscadancaCards("<html><body><p>nada</p></body></html>", LIST)).toEqual([]);
  });
});

describe("cleanBuscadancaAddress", () => {
  it("splits a venue name glued before the street, dropping the neighbourhood words", () => {
    expect(
      cleanBuscadancaAddress(
        "Clube dos Democráticos - Centro Rua do Riachuelo, 91, Lapa, Rio de Janeiro, RJ",
      ),
    ).toEqual({
      name: "Clube dos Democráticos",
      address: "Rua do Riachuelo, 91, Lapa, Rio de Janeiro, RJ",
    });
    expect(
      cleanBuscadancaAddress("Bar do Zé - Avenida Mem de Sá, 92, Lapa, Rio de Janeiro, RJ"),
    ).toEqual({ name: "Bar do Zé", address: "Avenida Mem de Sá, 92, Lapa, Rio de Janeiro, RJ" });
  });

  it("drops a square named between the number and the neighbourhood", () => {
    expect(
      cleanBuscadancaAddress("Travessa do Comércio, 20, Praça XV, Centro, Rio de Janeiro, RJ"),
    ).toEqual({ name: null, address: "Travessa do Comércio, 20, Centro, Rio de Janeiro, RJ" });
    expect(
      cleanBuscadancaAddress("Rua Alfa, s/n, Largo do Machado, Catete, Rio de Janeiro, RJ"),
    ).toEqual({ name: null, address: "Rua Alfa, s/n, Catete, Rio de Janeiro, RJ" });
  });

  it("applies both rules to one address", () => {
    expect(
      cleanBuscadancaAddress(
        "Bar Beta - Centro Travessa do Comércio, 20, Praça XV, Centro, Rio de Janeiro, RJ",
      ),
    ).toEqual({
      name: "Bar Beta",
      address: "Travessa do Comércio, 20, Centro, Rio de Janeiro, RJ",
    });
  });

  it("leaves every other address as written, with no name (never invents a venue)", () => {
    for (const street of [
      "Praça São Salvador - Laranjeiras, Rio de Janeiro, RJ",
      "Rua do Catete, 95 - Catete, Rio de Janeiro, RJ",
      "Bar X - Centro, Rio de Janeiro, RJ",
      "Praça XV, 20, Centro, Rio de Janeiro, RJ",
      "Rua A, 1, Praça B, Rio de Janeiro, RJ",
      "Campo de São Cristóvão, s/n, São Cristóvão, Rio de Janeiro, RJ",
      "Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ",
      "Rio de Janeiro, RJ",
    ]) {
      expect(cleanBuscadancaAddress(street)).toEqual({ name: null, address: street });
    }
    expect(cleanBuscadancaAddress("  Rua Ipiranga, 54, Rio de Janeiro, RJ  ")).toEqual({
      name: null,
      address: "Rua Ipiranga, 54, Rio de Janeiro, RJ",
    });
    expect(cleanBuscadancaAddress("")).toEqual({ name: null, address: "" });
  });
});

describe("buscadancaAdapter", () => {
  it("lists every weekly Rio night with its own page's address, once a day", async () => {
    const c = ctx(standard(), NOW);
    const result = await buscadancaAdapter.harvest!(source(), c);

    // Pages 1-3 read; page 3 adds no new card for Rio (only other cities' and seen ones), so page 4 is never asked for.
    expect(asked(c)).toContain(`${LIST}page/3/`);
    expect(asked(c)).not.toContain(`${LIST}page/4/`);
    // Only the weekly cards of this city are followed: no monthly card, no other city.
    const items = asked(c).filter((u) => u.includes("/eventos-de-danca/"));
    expect(new Set(items)).toEqual(new Set(WEEKLY.map(ITEM)));
    expect(items).not.toContain(ITEM("itza-bar-bistro-e-eventos"));
    expect(items).not.toContain(ITEM("zouk-tijuca"));

    // Charme de Rua's page gives no street ("Rio de Janeiro, RJ"): left out, the rest listed.
    expect(result.listings).toHaveLength(15);
    expect(result.listings.map((l) => l.eventUrl)).not.toContain(ITEM("projeto-charme-de-rua"));
    expect(result.whole).toBe(true);

    const hops = result.listings.find((l) => l.eventUrl === ITEM("forro-no-hops-rio"))!;
    expect(hops.externalId).toBe(`${ITEM("forro-no-hops-rio")}#weekly`);
    expect(hops.listing.title).toBe("Forró no Hops Rio");
    expect(hops.listing.listing_type).toBe("social");
    expect(hops.listing.styles).toEqual(["forro"]);
    expect(hops.listing.local_date).toBe("2026-11-02");
    expect(hops.listing.end_time).toBe("00:00");
    // The "Praça XV" landmark segment is dropped so the geocoder can place the door (run 41322915738).
    expect(hops.listing.venue?.address).toBe(
      "Travessa do Comércio, 20, Centro, Rio de Janeiro, RJ",
    );
    expect(hops.listing.venue?.name).toBeNull();

    // The venue name glued to the front of the address becomes the venue's name.
    const democraticos = result.listings.find(
      (l) => l.eventUrl === ITEM("forro-no-clube-democraticos"),
    )!;
    expect(democraticos.listing.venue?.name).toBe("Clube dos Democráticos");
    expect(democraticos.listing.venue?.address).toBe(
      "Rua do Riachuelo, 91, Lapa, Rio de Janeiro, RJ",
    );

    // Addresses no rule touches are kept as written, with no name.
    const xaxado = result.listings.find(
      (l) => l.eventUrl === ITEM("movimento-cultural-de-xaxado-urbano"),
    )!;
    expect(xaxado.listing.venue?.name).toBeNull();
    expect(xaxado.listing.venue?.address).toBe("Rua Ipiranga, 54, Laranjeiras, Rio de Janeiro, RJ");
    expect(hops.recurrence).toMatchObject({
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      dtstartLocal: "2026-11-02T18:00",
    });

    const feira = result.listings.find(
      (l) => l.eventUrl === ITEM("forro-na-feira-de-sao-cristovao"),
    )!;
    expect(feira.listing.local_date).toBe("2026-10-31");
    expect(feira.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=FR,SA,SU");
    expect(feira.recurrence?.timeListed).toBe(false);

    const xango = result.listings.find((l) => l.eventUrl === ITEM("milonga-xango"))!;
    expect(xango.listing.styles).toEqual(["milonga"]);
    expect(xango.listing.local_date).toBe("2026-11-06");
    expect(xango.recurrence?.dtstartLocal).toBe("2026-11-06T20:00");

    const lounge = result.listings.find((l) => l.eventUrl === ITEM("zouk-lounge-rio"))!;
    expect(lounge.listing.styles).toEqual(["brazilian_zouk"]);
    expect(lounge.recurrence?.rrule).toBe("FREQ=WEEKLY;BYDAY=WE");

    // Glória ends at 04:00, after midnight: still Friday's night.
    const gloria = result.listings.find((l) => l.eventUrl === ITEM("forro-da-gloria"))!;
    expect(gloria.listing.local_date).toBe("2026-11-06");
    expect(gloria.listing.end_time).toBe("04:00");
  });

  it("fails when page 1 cannot be read, so nothing is written or retired", async () => {
    const c = ctx(standard({ [LIST]: html(LIST, "error", 500) }), NOW);
    await expect(buscadancaAdapter.harvest!(source(), c)).rejects.toThrow();
  });

  it("fails when page 1 shows no weekly card for the city", async () => {
    const c = ctx(standard({ [LIST]: html(LIST, "<html><body></body></html>") }), NOW);
    await expect(buscadancaAdapter.harvest!(source(), c)).rejects.toThrow();
  });

  it("keeps page 1's nights but is not whole when page 2 fails", async () => {
    const p2 = `${LIST}page/2/`;
    const c = ctx(standard({ [p2]: html(p2, "error", 500) }), NOW);
    const result = await buscadancaAdapter.harvest!(source(), c);
    expect(result.listings).toHaveLength(10);
    expect(result.whole).toBeFalsy();
    expect(asked(c)).not.toContain(`${LIST}page/3/`);
  });

  it("skips a night whose own page fails, and is not whole", async () => {
    const url = ITEM("zouk-lounge-rio");
    const c = ctx(standard({ [url]: html(url, "error", 500) }), NOW);
    const result = await buscadancaAdapter.harvest!(source(), c);
    expect(result.listings).toHaveLength(14);
    expect(result.listings.map((l) => l.eventUrl)).not.toContain(url);
    expect(result.whole).toBeFalsy();
  });
  it("is not whole when page 5 still adds new cards, and never asks for page 6", async () => {
    const fixtures: Fixture[] = [];
    for (let n = 1; n <= MAX_LIST_PAGES + 1; n++) {
      fixtures.push(html(pageUrl(n), listPage([`p${n}`])));
      fixtures.push(html(ITEM(`p${n}`), itemPage(`p${n}`)));
    }
    const c = ctx(fixtures, NOW);
    const result = await buscadancaAdapter.harvest!(source(), c);
    expect(asked(c)).toContain(pageUrl(MAX_LIST_PAGES));
    expect(asked(c)).not.toContain(pageUrl(MAX_LIST_PAGES + 1));
    expect(result.listings).toHaveLength(MAX_LIST_PAGES);
    expect(result.notes).toContain(`stopped at page ${MAX_LIST_PAGES}`);
    expect(result.whole).toBeFalsy();
  });

  it("is not whole when more weekly cards are kept than item pages it may read", async () => {
    const slugs = Array.from({ length: MAX_ITEM_PAGES + 1 }, (_, i) => `n${i}`);
    const fixtures: Fixture[] = [
      html(LIST, listPage(slugs)),
      html(pageUrl(2), "<html><body></body></html>"),
      ...slugs.map((slug) => html(ITEM(slug), itemPage(slug))),
    ];
    const c = ctx(fixtures, NOW);
    const result = await buscadancaAdapter.harvest!(source(), c);
    expect(asked(c).filter((u) => u.includes("/eventos-de-danca/"))).toHaveLength(MAX_ITEM_PAGES);
    expect(result.listings).toHaveLength(MAX_ITEM_PAGES);
    expect(result.whole).toBeFalsy();
  });
});
