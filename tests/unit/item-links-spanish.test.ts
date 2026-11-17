import { describe, expect, it } from "vitest";
import { itemListLinks } from "@/src/adapters/feeds/event-pages";

const PAGE = "https://www.ritmolibre.ar/agenda-baile/sociales/caba";
const list = (urls: string[]) => [
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement: urls.map((url, i) => ({ "@type": "ListItem", position: i + 1, url })),
  },
];

describe("itemListLinks for Spanish event paths", () => {
  it("keeps Ritmo Libre's /evento/ pages", () => {
    const urls = [
      "https://www.ritmolibre.ar/agenda-baile/evento/10052-bachata-viernes",
      "https://www.ritmolibre.ar/agenda-baile/evento/11086-bachata-en-pareja",
    ];
    expect(itemListLinks(list(urls), PAGE)).toEqual(urls);
  });

  it("still rejects other paths and other sites", () => {
    const urls = [
      "https://www.ritmolibre.ar/agenda-baile/caba",
      "https://www.ritmolibre.ar/eventosx",
      "https://example.com/evento/1-salsa",
    ];
    expect(itemListLinks(list(urls), PAGE)).toEqual([]);
  });
});
