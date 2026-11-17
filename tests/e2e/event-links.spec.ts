// Links to the night itself, not only to its organiser (D-073): the owner's ask of 2026-09-29, "these
// event links need to be everywhere, the list, the event, the map blurb". Every card carries one
// link out, after its own link and never inside it; the phone map's card carries the same one; in
// the split view the lit list card is the blurb; and the event page names it in the card's words.
//
// Run against mock mode (D-011). No page outside the app is fetched: every external host is
// answered here, and the map's tiles by stubTiles.

import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";

import { listingsFromSeed } from "@/src/data/mock-repository";
import { seedNyc } from "@/src/db/seed/nyc";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate, pickerLength } from "@/src/domain/tonight";
import { en, t } from "@/src/i18n";
import { withTextFragment } from "@/src/ui/links";

import { e2eNow } from "./early-hours";

import { MARKER, PIN, REACHABLE_CARD, homePath, stubTiles } from "./map-helpers";

const NY = "America/New_York";
const CARD = 'a[href^="/e/"]';
const LINE = 'a[target="_blank"]';

const night = (offset: number) => addCalendarDays(currentNightDate(e2eNow(), NY), offset);

/** "Tickets at {site}" as a pattern that reads the site back. */
function template(words: string): RegExp {
  const [before, after] = words
    .split("{site}")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${before ?? ""}(\\S+)${after ?? ""}$`);
}
const KINDS = {
  tickets: template(en.links.ticketsAt),
  event: template(en.links.eventPageAt),
  listed: template(en.links.listedOn),
} as const;
type Kind = keyof typeof KINDS;

/** A URL as the browser requests it: normalised ("host/" for a bare host), with no fragment. */
function withoutFragment(url: string): string {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
}

function kindOf(text: string): Kind | null {
  for (const kind of Object.keys(KINDS) as Kind[]) if (KINDS[kind].test(text)) return kind;
  return null;
}

/** Every host outside the app answers with a plain page of its own; nothing leaves the machine. */
async function stubOutside(
  context: BrowserContext,
  baseURL: string | undefined,
): Promise<string[]> {
  const ours = new URL(baseURL ?? "http://localhost:3000").host;
  const opened: string[] = [];
  await context.route(
    (url) => url.host !== ours && url.protocol.startsWith("http"),
    async (route) => {
      opened.push(route.request().url());
      await route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<!doctype html><title>Outside</title><h1>A page outside DanceTonight</h1>",
      });
    },
  );
  return opened;
}

interface CardLine {
  slug: string;
  title: string;
  href: string;
  text: string;
}

/** Each card on the page with its event line, read from the wrapper both sit in. */
async function cardLines(page: Page): Promise<CardLine[]> {
  await expect(page.locator(CARD).first()).toBeVisible();
  return page.locator(`:not([inert]) > ${CARD}`).evaluateAll((cards) =>
    cards.map((card) => {
      const line = card.nextElementSibling?.querySelector('a[target="_blank"]');
      return {
        slug: (card.getAttribute("href") ?? "").replace(/^\/e\//, ""),
        title: card.querySelector(".type-card-name")?.textContent ?? "",
        href: line?.getAttribute("href") ?? "",
        text: line?.textContent ?? "",
      };
    }),
  );
}

/** The first card on the page whose line is of this kind. */
async function firstOfKind(page: Page, kind: Kind): Promise<CardLine> {
  const found = (await cardLines(page)).find((line) => kindOf(line.text) === kind);
  if (found === undefined) throw new Error(`no ${kind} card on ${page.url()}`);
  return found;
}

/** The event line that follows a card, by the card's slug. */
function lineOf(page: Page, slug: string): Locator {
  return page.locator(`${CARD}[href="/e/${slug}"] + div ${LINE}`);
}

test("every card has one link out, after its own link and never inside it, on every night", async ({
  page,
}) => {
  test.setTimeout(140_000);
  // Every night the day picker offers (D-075), not a count kept here.
  for (
    let offset = 0;
    offset < pickerLength(currentNightDate(e2eNow(), "America/New_York"));
    offset += 1
  ) {
    await page.goto(homePath({ day: night(offset) }));
    await expect(page.locator(CARD).first()).toBeVisible();
    expect(await page.evaluate(() => document.querySelectorAll("a a").length)).toBe(0);

    const cards = await page.locator(CARD).evaluateAll((links) =>
      links.map((card) => {
        const wrapper = card.parentElement;
        const lines = Array.from(wrapper?.querySelectorAll('a[target="_blank"]') ?? []);
        const line = lines[0];
        const box = line?.getBoundingClientRect();
        return {
          slug: card.getAttribute("href") ?? "",
          title: card.querySelector(".type-card-name")?.textContent ?? "",
          lines: lines.length,
          firstChild: wrapper?.firstElementChild === card,
          insideCard: line === undefined ? false : card.contains(line),
          follows:
            line === undefined
              ? false
              : Boolean(card.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING),
          lineParentIsWrapper: line?.parentElement === wrapper,
          text: line?.textContent ?? "",
          label: line?.getAttribute("aria-label") ?? "",
          rel: line?.getAttribute("rel") ?? "",
          lineHeight: box?.height ?? 0,
          cardHeight: card.getBoundingClientRect().height,
        };
      }),
    );
    expect(cards.length).toBeGreaterThan(0);
    const kinds = new Set<Kind | null>();
    for (const card of cards) {
      const where = `${night(offset)} ${card.slug}`;
      expect(card.lines, `${where}: one link out`).toBe(1);
      expect(card.firstChild, `${where}: the card link leads its wrapper`).toBe(true);
      expect(card.insideCard, `${where}: not inside the card link`).toBe(false);
      expect(card.follows, `${where}: after the card link`).toBe(true);
      expect(card.lineParentIsWrapper, `${where}: in its own div`).toBe(false);
      const kind = kindOf(card.text);
      kinds.add(kind);
      expect(kind, `${where}: "${card.text}" is one of the three`).not.toBeNull();
      expect(card.label).toBe(
        t("a11y.externalLink", {
          label: t("a11y.eventLinkFor", { link: card.text, title: card.title }),
        }),
      );
      expect(card.rel).toContain("noreferrer");
      expect(card.lineHeight, `${where}: a 44px target`).toBeGreaterThanOrEqual(44);
      expect(card.cardHeight, `${where}: the card keeps its 88px`).toBeGreaterThanOrEqual(88);
    }
    // Each night after tonight shows all three (tonight's tickets may be over by now).
    if (offset > 0)
      expect([...kinds].sort(), night(offset)).toEqual(["event", "listed", "tickets"]);
  }
});

test("the event line sits in the name's column, on the rail and off it", async ({ page }) => {
  const views: Record<string, string>[] = [{ day: night(1) }, { day: night(1), sort: "distance" }];
  for (const params of views) {
    await page.goto(homePath(params));
    await expect(page.locator(CARD).first()).toBeVisible();
    const offsets = await page.locator(CARD).evaluateAll((cards) =>
      cards.map((card) => {
        const name = card.querySelector(".type-card-name")?.getBoundingClientRect().left ?? -1;
        const line = card.nextElementSibling?.querySelector("a")?.getBoundingClientRect().left;
        return Math.abs((line ?? -100) - name);
      }),
    );
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(1);
  }
});

test("a card's link opens its page in a new tab, and the list stays as it was", async ({
  context,
  page,
  baseURL,
}) => {
  const opened = await stubOutside(context, baseURL);
  const list = homePath({ day: night(1) });
  await page.goto(list);
  const before = await page.locator(CARD).count();

  for (const kind of ["tickets", "event"] as const) {
    const card = await firstOfKind(page, kind);
    const line = lineOf(page, card.slug);
    await expect(line).toHaveAttribute("rel", /noreferrer/);
    const [tab] = await Promise.all([context.waitForEvent("page"), line.click()]);
    await tab.waitForLoadState("domcontentloaded");
    expect(tab.url(), kind).toBe(card.href);
    await expect(tab.getByRole("heading", { level: 1 })).toHaveText("A page outside DanceTonight");
    await tab.close();
  }
  expect(opened.length).toBeGreaterThanOrEqual(2);
  expect(`${new URL(page.url()).pathname}${new URL(page.url()).search}`).toBe(list);
  await expect(page.locator(CARD)).toHaveCount(before);
});

test("a card known only from a list opens that page scrolled to its title", async ({
  context,
  page,
  baseURL,
}) => {
  const opened = await stubOutside(context, baseURL);
  await page.goto(homePath({ day: night(1) }));
  const card = await firstOfKind(page, "listed");
  const listing = listingsFromSeed(seedNyc(e2eNow())).find((l) => l.slug === card.slug);
  const source = listing?.sources[0]?.url ?? "missing";
  // The page it was read from, with a text fragment of its title (WICG Scroll to Text Fragment).
  expect(card.href).toBe(withTextFragment(source, card.title));
  expect(card.href).toContain("#:~:text=");
  const [tab] = await Promise.all([context.waitForEvent("page"), lineOf(page, card.slug).click()]);
  await tab.waitForLoadState("domcontentloaded");
  // The request carries no fragment; the page asked for is the source page itself.
  expect(opened.map(withoutFragment)).toContain(withoutFragment(source));
  await tab.close();
});

test("the phone map's card carries the same link as the list's card, and it can be reached", async ({
  context,
  page,
  baseURL,
}) => {
  await stubOutside(context, baseURL);
  await stubTiles(page);
  await page.goto(homePath({ day: night(1), view: "map" }));
  await page.waitForLoadState("networkidle");
  const pin = page.locator(PIN).first();
  await expect(pin).toBeVisible();
  await pin.tap();

  const card = page.locator(REACHABLE_CARD);
  await expect(card).toHaveCount(1);
  const slug = ((await card.getAttribute("href")) ?? "").replace(/^\/e\//, "");
  const sheetLine = page.locator(`${REACHABLE_CARD} + div ${LINE}`);
  await expect(sheetLine).toHaveCount(1);
  await expect(sheetLine).toBeVisible();
  await expect(sheetLine).toBeInViewport();
  expect(await sheetLine.evaluate((element) => element.closest("[inert]") === null)).toBe(true);

  // The list under the map draws the same card; its line has the same page and the same words.
  const listLine = page.locator(`[inert] ${CARD}[href="/e/${slug}"] + div ${LINE}`);
  await expect(listLine).toHaveCount(1);
  expect(await sheetLine.getAttribute("href")).toBe(await listLine.getAttribute("href"));
  expect(await sheetLine.textContent()).toBe(await listLine.textContent());
  expect(kindOf((await sheetLine.textContent()) ?? "")).not.toBeNull();
  expect(await page.evaluate(() => document.querySelectorAll("a a").length)).toBe(0);

  // And it opens, from the sheet, in a new tab.
  const href = (await sheetLine.getAttribute("href")) ?? "";
  const [tab] = await Promise.all([context.waitForEvent("page"), sheetLine.tap()]);
  await tab.waitForLoadState("domcontentloaded");
  expect(withoutFragment(tab.url())).toBe(withoutFragment(href));
  await tab.close();
});

test.describe("the split view", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("off the rail too, only the card's first cell takes the pin number", async ({ page }) => {
    await stubTiles(page);
    // Sorted by distance there is no rail, so the number goes before the stamp.
    await page.goto(homePath({ day: night(1), sort: "distance" }));
    await expect(page.locator(MARKER).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const pin = page.locator(PIN).first();
    const number = (await pin.getAttribute("data-numbers")) ?? "";
    await pin.click();
    const lit = page.locator(`[data-pin-number="${number}"]`);
    await expect(lit).toHaveAttribute("aria-current", "true");
    await expect(lit.locator(LINE)).toHaveCount(1);
  });

  test("the lit card keeps its line, and focusing the line lights its pin", async ({ page }) => {
    await stubTiles(page);
    await page.goto(homePath({ day: night(1) }));
    await expect(page.locator(MARKER).first()).toBeVisible();
    await page.waitForLoadState("networkidle");

    // A pin picked on the map lights its card, line and all.
    const pin = page.locator(PIN).last();
    const number = (await pin.getAttribute("data-numbers")) ?? "";
    await pin.click();
    const lit = page.locator(`[data-pin-number="${number}"]`);
    await expect(lit).toHaveAttribute("aria-current", "true");
    const litLine = lit.locator(LINE);
    await expect(litLine).toHaveCount(1);
    await expect(litLine).toBeVisible();
    expect(kindOf((await litLine.textContent()) ?? "")).not.toBeNull();

    // Tabbing to another card's line lights that card's pin.
    await page.mouse.move(0, 0);
    const first = page.locator('[data-pin-number="1"]');
    await first.locator(LINE).focus();
    await expect(first).toHaveAttribute("aria-current", "true");
    await expect(
      page.locator(`${MARKER}[data-numbers="1"][aria-label$=", selected"]`),
    ).toBeVisible();
  });
});

test.describe("the event page names the card's link in the card's words", () => {
  for (const kind of ["tickets", "event", "listed"] as const) {
    test(kind, async ({ page }) => {
      await page.goto(homePath({ day: night(1) }));
      const card = await firstOfKind(page, kind);
      await page.goto(`/e/${card.slug}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(card.title);

      if (kind === "tickets") {
        const tickets = page.getByRole("link", { name: /^Get tickets/ });
        await expect(tickets).toHaveAttribute("href", card.href);
        // COST names the ticket page exactly as the card does.
        await expect(page.getByText(card.text, { exact: true })).toBeVisible();
      }
      if (kind === "event") {
        const button = page.locator(LINE, { hasText: card.text });
        await expect(button).toHaveCount(1);
        await expect(button).toHaveAttribute("href", card.href);
        await expect(button).toHaveClass(/chip-edge/);
        // In the first row, before Add to calendar in reading order (side by side since D-147).
        const [pageBox, calendarBox] = await Promise.all([
          button.boundingBox(),
          page.getByRole("link", { name: en.detail.actions.addToCalendar }).boundingBox(),
        ]);
        const before =
          (pageBox?.y ?? 0) < (calendarBox?.y ?? 0) ||
          ((pageBox?.y ?? 0) === (calendarBox?.y ?? 0) &&
            (pageBox?.x ?? 0) < (calendarBox?.x ?? 0));
        expect(before).toBe(true);
      }
      if (kind === "listed") {
        const line = page.locator(LINE, { hasText: card.text });
        await expect(line).toHaveCount(1);
        await expect(line).toHaveAttribute("href", card.href);
        await expect(line).toHaveClass(/text-toner/);
        // A page that lists the night is never called its event page, anywhere on the page.
        await expect(page.getByText(/^Event page at /)).toHaveCount(0);
        await expect(page.getByRole("link", { name: /^Get tickets/ })).toHaveCount(0);
      }
    });
  }
});

test("a cancelled night with a ticket page says Event page, and the event page sells nothing", async ({
  page,
}) => {
  await page.goto(homePath());
  const cancelled = (await cardLines(page)).filter((line) =>
    line.slug.startsWith("salsa-and-bachata-social-"),
  );
  expect(cancelled, "tonight's seed has a cancelled night with a ticket page").toHaveLength(1);
  const card = cancelled[0] as CardLine;
  expect(kindOf(card.text)).toBe("event");
  expect(card.href).toMatch(/^https:\/\/www\.eventbrite\.com\/e\//);
  await expect(page.locator(`${CARD}[href="/e/${card.slug}"]`)).toHaveAttribute(
    "aria-label",
    /, cancelled$/,
  );

  await page.goto(`/e/${card.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(card.title);
  await expect(page.getByRole("link", { name: /^Get tickets/ })).toHaveCount(0);
  await expect(page.getByText(/^Tickets at /)).toHaveCount(0);
  await expect(page.locator(LINE, { hasText: card.text })).toHaveAttribute("href", card.href);
});

test.describe("at 320px", () => {
  test.use({ viewport: { width: 320, height: 800 } });

  test("a long host wraps inside the page, in the name's column, still a 44px target", async ({
    page,
  }) => {
    await page.goto(homePath({ day: night(4) }));
    const card = (await cardLines(page)).find((line) => line.text.length >= 40);
    expect(card, "the seed's long ticket host is on this night").toBeDefined();
    const slug = card?.slug ?? "";
    const line = lineOf(page, slug);
    const box = await line.boundingBox();
    const name = await page.locator(`${CARD}[href="/e/${slug}"] .type-card-name`).boundingBox();
    expect(box?.height ?? 0, "it wraps to a second line").toBeGreaterThan(44);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320 - 16 + 0.5);
    expect(Math.abs((box?.x ?? 0) - (name?.x ?? -100))).toBeLessThanOrEqual(1);
    const scroll = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(scroll.width).toBeLessThanOrEqual(scroll.client + 1);

    // And on its own page: the ticket line in COST wraps too.
    await page.goto(`/e/${slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const detail = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(detail.width).toBeLessThanOrEqual(detail.client + 1);
  });
});
