import { describe, expect, it } from "vitest";
import { findEventLinks } from "@/src/domain/event-link-matcher";

// D-376: a card whose date line links the card's own page ("2 noviembre [its page]") is dated by
// that line; it is the card's date, not the next day's heading (Marula Café, run 41118702532: every
// title the agenda lists on two nights got no link, so 13 rows stayed untimed).
describe("a date line linked to the card's own page dates the card (D-376)", () => {
  const card = (title: string, date: string, url: string, ticket: string) => `MARULA CLUB

${title}

${date}

MARULA CLUB [${url}]

${title} [${url}]

${date} [${url}]

[${url}]

ENTRADAS [${ticket}]`;

  const pageText = [
    card(
      "Dj Kusuri",
      "2 noviembre",
      "https://marulacafe.com/evento/dj-kusuri-2/",
      "https://link.dice.fm/a1",
    ),
    card(
      "J Glytta",
      "3 noviembre",
      "https://marulacafe.com/evento/j-glytta-3/",
      "https://link.dice.fm/a2",
    ),
    card(
      "Dj Kusuri",
      "9 noviembre",
      "https://marulacafe.com/evento/dj-kusuri-3/",
      "https://link.dice.fm/a3",
    ),
    card(
      "J Glytta",
      "10 noviembre",
      "https://marulacafe.com/evento/j-glytta-4/",
      "https://link.dice.fm/a4",
    ),
  ].join("\n\n");

  const pageUrl = "https://marulacafe.com/agenda/";
  const options = { lang: "es", dateOrder: "dmy" as const };

  it("gives each night of a repeated title its own page", () => {
    const result = findEventLinks(
      pageText,
      pageUrl,
      [
        { title: "Dj Kusuri", date: "2026-11-02" },
        { title: "Dj Kusuri", date: "2026-11-09" },
        { title: "J Glytta", date: "2026-11-03" },
        { title: "J Glytta", date: "2026-11-10" },
      ],
      options,
    );
    expect(result.map((r) => r.url)).toEqual([
      "https://marulacafe.com/evento/dj-kusuri-2/",
      "https://marulacafe.com/evento/dj-kusuri-3/",
      "https://marulacafe.com/evento/j-glytta-3/",
      "https://marulacafe.com/evento/j-glytta-4/",
    ]);
  });

  it("gives a night the page does not list no link", () => {
    const [r] = findEventLinks(
      pageText,
      pageUrl,
      [{ title: "Dj Kusuri", date: "2026-11-16" }],
      options,
    );
    expect(r!.url).toBeNull();
  });

  it("gives a rule's listing none of the one-night pages", () => {
    const [r] = findEventLinks(pageText, pageUrl, [{ title: "Dj Kusuri", date: null }], options);
    expect(r!.url).toBeNull();
  });

  it("still stops at a date line that links another page", () => {
    // The date line under the title links a different page: it is another item's heading, so it
    // does not date this card, and the two nights' links cannot be told apart.
    const text = `Salsa Night [https://example.com/e/salsa-1/]

5 noviembre [https://example.com/e/other/]

Salsa Night [https://example.com/e/salsa-2/]

12 noviembre [https://example.com/e/other-2/]`;
    const [r] = findEventLinks(
      text,
      "https://example.com/agenda/",
      [{ title: "Salsa Night", date: "2026-11-05" }],
      options,
    );
    expect(r!.url).toBeNull();
  });
});
