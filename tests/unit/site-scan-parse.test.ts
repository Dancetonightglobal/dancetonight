import { describe, expect, test } from "vitest";
import { parseDayPage, pairHints, normalizeTitle } from "@/src/jobs/site-scan-parse";

describe("site-scan-parse", () => {
  const fixtureHtml = `
<main id="bill">
<li><h2 class="grid-cols-rail grid items-center gap-3 px-4 pt-1.5 pb-1"><span class="type-marker text-toner">6pm</span><span aria-hidden="true" class="bg-halftone h-px"></span></h2></li><li><div class="relative"><ol role="list" class="list-none"><li><div data-card-id="947c600a-9542-5ddb-a92f-11e386e7c9c7"><a href="/e/weekend-in-house-pool-party-belly-dance-dj-2026-11-08-947c60" aria-label="6:30, Weekend In House Pool Party, Belly Dance, DJ, Ramp Show, Games, Buffet Dinner &amp; Drinks @ Mumbai, Starts at 6:30pm, until 11:45pm" class="grid min-h-22"><div class="min-[20rem]:text-right"><span class=""><span class="min-[20rem]:text-transparent"><span class="type-stamp">6:30</span></span></span></div><div class="border-s-3 ps-3 border-stock-other"><p class="type-label"><span class="type-label inline-flex items-center gap-1.5  text-stock-other">Other social dancing</span><span><span aria-hidden="true" class="text-toner"> · </span><span class="text-toner">Social</span></span></p><span class="type-card-name text-ink block break-words mt-0.5">Weekend In House Pool Party, Belly Dance, DJ, Ramp Show, Games, Buffet Dinner &amp; Drinks @ Mumbai</span><div class="mt-1"><p class="type-status text-ink ">Starts at 6:30pm, until 11:45pm</p></div><p class="type-secondary text-toner mt-0.5"><span>AB Nair Road, Juhu</span><span><span aria-hidden="true" class="text-toner"> · </span>12 mi</span><span><span aria-hidden="true" class="text-toner"> · </span>Free</span></p></div></a><div class="grid gap-x-3 px-4 pb-2"><a class="type-secondary text-toner underline" href="https://allevents.in/mumbai/weekend-in-house-pool-party-belly-dance-dj-ramp-show-games-buffet-dinner-and-drinks-mumbai-tickets/80002894464730" target="_blank" rel="noreferrer" aria-label="Event page at allevents.in, opens in a new tab">Event page at allevents.in</a></div></div></li></ol></div></li>
</main>
`;

  test("parseDayPage extracts card details", () => {
    const cards = parseDayPage(fixtureHtml, "mumbai", "2026-11-08");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.id).toBe("947c600a-9542-5ddb-a92f-11e386e7c9c7");
    expect(card.detailPath).toBe("/e/weekend-in-house-pool-party-belly-dance-dj-2026-11-08-947c60");
    expect(card.time).toBe("6:30");
    expect(card.timeHeading).toBe("6pm");
    expect(card.title).toBe(
      "Weekend In House Pool Party, Belly Dance, DJ, Ramp Show, Games, Buffet Dinner & Drinks @ Mumbai",
    );
    expect(card.kinds).toEqual(["Other social dancing", "Social"]);
    expect(card.status).toBe("Starts at 6:30pm, until 11:45pm");
    expect(card.secondary).toEqual(["AB Nair Road, Juhu", "12 mi", "Free"]);
    expect(card.outLinks).toEqual([
      {
        href: "https://allevents.in/mumbai/weekend-in-house-pool-party-belly-dance-dj-ramp-show-games-buffet-dinner-and-drinks-mumbai-tickets/80002894464730",
        label: "Event page at allevents.in",
      },
    ]);
  });

  test("parseDayPage handles card without time stamp", () => {
    const modifiedHtml = fixtureHtml
      .replace(
        'data-card-id="947c600a-9542-5ddb-a92f-11e386e7c9c7"',
        'data-card-id="96bd4e79-0000"',
      )
      .replace(
        '<span class="type-marker text-toner">6pm</span>',
        '<span class="type-marker text-toner">Time not listed</span>',
      )
      .replace('<span class="type-stamp">6:30</span>', "");

    const cards = parseDayPage(modifiedHtml, "mumbai", "2026-11-08");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.id).toBe("96bd4e79-0000");
    expect(card.time).toBeNull();
    expect(card.timeHeading).toBe("Time not listed");
  });

  test("pairHints detects same-title", () => {
    const htmlWithTwoCards = `
<main>
<div data-card-id="id1"><a href="/e/event1" class="grid min-h-22"><span class="type-card-name">Salsa Night</span></a></div>
<div data-card-id="id2"><a href="/e/event2" class="grid min-h-22"><span class="type-card-name">Salsa Night</span></a></div>
</main>
`;
    const cards = parseDayPage(htmlWithTwoCards, "mumbai", "2026-11-08");
    expect(cards).toHaveLength(2);
    const hints = pairHints(cards);
    expect(hints).toHaveLength(1);
    const hint = hints[0];
    expect(hint).toBeDefined();
    if (!hint) return;
    expect(hint.why).toBe("same-title");
    expect(hint.a).toBe("id1");
    expect(hint.b).toBe("id2");
  });

  test("pairHints detects similar-title", () => {
    const html = `
<main>
<div data-card-id="id1"><a href="/e/event1" class="grid min-h-22"><span class="type-card-name">Salsa Arriba</span></a></div>
<div data-card-id="id2"><a href="/e/event2" class="grid min-h-22"><span class="type-card-name">Salsa Arriba con DJ Pepe</span></a></div>
</main>
`;
    const cards = parseDayPage(html, "mumbai", "2026-11-08");
    const hints = pairHints(cards);
    expect(hints).toHaveLength(1);
    const hint = hints[0];
    expect(hint).toBeDefined();
    if (!hint) return;
    expect(hint.why).toBe("similar-title");
  });

  test("pairHints detects same-link", () => {
    const html = `
<main>
<div data-card-id="id1"><a href="/e/event1" class="grid min-h-22"><span class="type-card-name">Event One</span></a><a target="_blank" href="https://example.com/event">External</a></div>
<div data-card-id="id2"><a href="/e/event2" class="grid min-h-22"><span class="type-card-name">Event Two</span></a><a target="_blank" href="https://example.com/event/">External</a></div>
</main>
`;
    const cards = parseDayPage(html, "mumbai", "2026-11-08");
    const hints = pairHints(cards);
    expect(hints).toHaveLength(1);
    const hint = hints[0];
    expect(hint).toBeDefined();
    if (!hint) return;
    expect(hint.why).toBe("same-link");
  });

  test("pairHints gives no hint across different days", () => {
    const html = `
<main>
<div data-card-id="id1"><a href="/e/event1" class="grid min-h-22"><span class="type-card-name">Same Title</span></a></div>
</main>
`;
    const cards1 = parseDayPage(html, "mumbai", "2026-11-08");
    const cards2 = parseDayPage(html, "mumbai", "2026-11-09");
    const allCards = [...cards1, ...cards2];
    const hints = pairHints(allCards);
    expect(hints).toHaveLength(0);
  });

  test("parseDayPage returns empty array when no main", () => {
    const cards = parseDayPage("<div>No main here</div>", "mumbai", "2026-11-08");
    expect(cards).toEqual([]);
  });

  test("normalizeTitle handles Unicode scripts", () => {
    const title1 = "週五莎莎舞會";
    const title2 = "探戈之夜";
    const norm1 = normalizeTitle(title1);
    const norm2 = normalizeTitle(title2);
    // They should not be equal
    expect(norm1).not.toBe(norm2);
    // Same Chinese titles should be equal
    expect(normalizeTitle(title1)).toBe(normalizeTitle("週五莎莎舞會"));
  });

  test("outLinks extraction works when href comes before target", () => {
    const html = `
<main>
<div data-card-id="test-id">
  <a href="https://example.com/event" target="_blank">Event page</a>
</div>
</main>
`;
    const cards = parseDayPage(html, "mumbai", "2026-11-08");
    expect(cards).toHaveLength(1);
    const card = cards[0];
    expect(card).toBeDefined();
    if (!card) return;
    expect(card.outLinks).toHaveLength(1);
    const outLink = card.outLinks[0];
    expect(outLink).toBeDefined();
    if (!outLink) return;
    expect(outLink.href).toBe("https://example.com/event");
    expect(outLink.label).toBe("Event page");
  });
});
