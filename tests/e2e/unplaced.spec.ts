// A night whose source names no place is listed for its night, as "Location not listed", with its
// link out and no pin (D-082, the owner's choice of 2026-09-29).
import { expect, test, type Page } from "@playwright/test";

import { e2eNow } from "./early-hours";
import { listingsFromSeed } from "@/src/data/mock-repository";
import { seedNyc } from "@/src/db/seed/nyc";
import { addCalendarDays } from "@/src/domain/time";
import { formatDayLabel } from "@/src/domain/tonight";
import { en, t } from "@/src/i18n";

import { MARKER, TOGGLE, homePath, numbersIn, stubTiles } from "./map-helpers";

const CARD = 'a[href^="/e/"]';
const LINE = 'a[target="_blank"]';

/** The seed's one listing with no venue, read from the seed rather than named here. */
function unplaced(): { slug: string; title: string; nightDate: string } {
  const found = listingsFromSeed(seedNyc(e2eNow())).filter((l) => l.venue === null);
  expect(found, "the seed has one listing with no venue").toHaveLength(1);
  return found[0]!;
}

/** The phone map's strip: the link back to the list across the top of the map. */
function stripOf(page: Page) {
  return page.locator("div.touch-none > a").filter({ hasText: en.map.strip.toList });
}

/** How many lines the strip's words take, and how tall the strip is. */
async function stripBox(page: Page): Promise<{ lines: number; height: number }> {
  return stripOf(page).evaluate((link) => {
    const range = document.createRange();
    range.selectNodeContents(link.firstElementChild ?? link);
    const tops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
    return { lines: tops.size, height: link.getBoundingClientRect().height };
  });
}

async function overflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("a listing with no location is on its night, says so, links out, and sorts last by distance", async ({
  page,
}) => {
  const listing = unplaced();
  await page.goto(homePath({ day: listing.nightDate }));
  const card = page.locator(`${CARD}[href="/e/${listing.slug}"]`);
  await expect(card).toHaveCount(1);
  await expect(card).toContainText(en.card.place.locationNotListed);
  await expect(card).not.toContainText(/\d(\.\d)? mi\b/);
  // Its accessible name is the card's usual one: stamp, title, status; no venue in it.
  await expect(card).toHaveAttribute("aria-label", new RegExp(`^9:00, ${listing.title}`));
  await expect(page.locator(`${CARD}[href="/e/${listing.slug}"] + div ${LINE}`)).toHaveCount(1);
  // The header counts it, and the day picker's count is the list's.
  const cards = await page.locator(CARD).count();
  await expect(
    page.getByText(t("home.header.count", { count: cards }), { exact: true }),
  ).toBeVisible();

  await page.goto(homePath({ day: listing.nightDate, sort: "distance" }));
  await expect(page.locator(CARD).last()).toHaveAttribute("href", `/e/${listing.slug}`);

  // A distance the dancer chose cannot be claimed for it: within 10 miles, it is not listed.
  await page.goto(homePath({ day: listing.nightDate, r: "16" }));
  await expect(page.locator(CARD).first()).toBeVisible();
  await expect(page.locator(`${CARD}[href="/e/${listing.slug}"]`)).toHaveCount(0);
});

test("a narrowed distance that leaves the night empty says how many have no location, not Nothing on", async ({
  page,
}) => {
  const listing = unplaced();
  // Ten metres: no place of the seed stands that close to its centre, so the night is empty within
  // it, and the listing with no location is left out, as under any distance the dancer chose.
  await page.goto(homePath({ day: listing.nightDate, r: "0.01" }));
  await expect(page.getByText(t("home.empty.unplacedHidden", { count: 1 }))).toBeVisible();
  await expect(page.locator(CARD)).toHaveCount(0);
  await expect(page.getByText(/^Nothing on/)).toHaveCount(0);
  await page.getByRole("link", { name: en.home.filters.clearDistance, exact: true }).click();
  await expect(page.locator(`${CARD}[href="/e/${listing.slug}"]`)).toHaveCount(1);
  expect(new URL(page.url()).searchParams.has("r")).toBe(false);
});

test("its event page says Location not listed, with no map, no directions and no Event JSON-LD", async ({
  page,
}) => {
  const listing = unplaced();
  await page.goto(`/e/${listing.slug}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(listing.title);
  const where = page.getByRole("heading", { name: en.detail.where.heading, exact: true });
  await expect(where).toBeVisible();
  await expect(page.getByText(en.card.place.locationNotListed, { exact: true })).toBeVisible();
  await expect(page.locator("summary", { hasText: en.detail.actions.getDirections })).toHaveCount(
    0,
  );
  await expect(page.getByText(en.map.loading, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Google Maps|Apple Maps/ })).toHaveCount(0);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(0);
  await expect(page.locator(LINE).first()).toBeAttached();
});

test.describe("at 320px", () => {
  test.use({ viewport: { width: 320, height: 800 } });
  test("the night and the event page reflow with no horizontal scroll", async ({ page }) => {
    const listing = unplaced();
    await page.goto(homePath({ day: listing.nightDate }));
    await expect(page.locator(`${CARD}[href="/e/${listing.slug}"]`)).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
    await page.goto(`/e/${listing.slug}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });

  test("the map's strip counts the place with no pin within its 44px, adding no line", async ({
    page,
  }) => {
    // Measured 2026-09-29: at 320px a night named by its date already takes two lines ("Fri,
    // Oct 2 near New York · 12 / places"), which the strip's 44px holds; only tonight's is one.
    // The count of places with no pin may not add a line to that, nor ever grow the strip.
    const listing = unplaced();
    await stubTiles(page);
    await page.goto(homePath({ day: addCalendarDays(listing.nightDate, 1), view: "map" }));
    await expect(stripOf(page)).toBeVisible();
    await expect(stripOf(page)).not.toContainText(t("map.strip.notOnMap", { count: 1 }));
    const before = await stripBox(page);

    await page.goto(homePath({ day: listing.nightDate, view: "map" }));
    await expect(stripOf(page)).toContainText(t("map.strip.notOnMap", { count: 1 }));
    const after = await stripBox(page);
    expect(after.lines).toBeLessThanOrEqual(Math.max(before.lines, 2));
    expect(after.height).toBeLessThanOrEqual(44.5);
    expect(await overflow(page)).toBeLessThanOrEqual(1);
  });
});

test("the phone map gives it no pin, numbers the others 1 to n, and its strip says one is not on the map", async ({
  page,
}) => {
  const listing = unplaced();
  await stubTiles(page);
  await page.goto(homePath({ day: listing.nightDate }));
  const cards = await page.locator(CARD).count();
  await page.goto(homePath({ day: listing.nightDate, view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const markers = await page.locator(MARKER).evaluateAll((els) =>
    els.map((el) => ({
      label: el.getAttribute("aria-label") ?? "",
      numbers: el.getAttribute("data-numbers") ?? "",
    })),
  );
  const labels = markers.map((marker) => marker.label);
  const numbers = markers.flatMap((marker) => numbersIn(marker.numbers)).sort((a, b) => a - b);
  expect(numbers).toEqual(Array.from({ length: cards - 1 }, (_, i) => i + 1));
  expect(labels.some((label) => label.includes(listing.title))).toBe(false);
  await expect(
    page.locator(`section[aria-label="${t("a11y.mapWithCount", { count: cards - 1 })}"]`),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", {
      name: new RegExp(
        `${t("map.strip.places", { count: cards - 1 })} · ${t("map.strip.notOnMap", { count: 1 })}`,
      ),
    }),
  ).toBeVisible();
});

test("focusing the card with no location and opening the map shows no card under the map", async ({
  page,
}) => {
  const listing = unplaced();
  await stubTiles(page);
  await page.goto(homePath({ day: listing.nightDate }));
  // Hydrated, so a focus selects: a focus that lands before React does would prove nothing.
  await page.waitForLoadState("networkidle");
  const bar = page.locator(TOGGLE);
  const toMap = bar.getByRole("link", { name: en.home.view.map, exact: true });
  const toList = bar.getByRole("link", { name: en.home.view.list, exact: true });
  const sheet = page.locator("div.max-h-1\\/2");

  // A card with a pin: focused on the list, it is the card under the map.
  const placed = page.locator(`${CARD}:not([href="/e/${listing.slug}"])`).first();
  const placedHref = await placed.getAttribute("href");
  await placed.focus();
  await expect(placed.locator("xpath=..")).toHaveAttribute("aria-current", "true");
  await toMap.click();
  await expect(toMap).toHaveAttribute("aria-current", "page");
  await expect(page.locator(MARKER).first()).toBeVisible();
  await expect(sheet.locator(`a[href="${placedHref}"]`)).toHaveCount(1);

  // The card with no location: selected on the list, but no pin's card, so the sheet is not drawn.
  await toList.click();
  await expect(toList).toHaveAttribute("aria-current", "page");
  const card = page.locator(`${CARD}[href="/e/${listing.slug}"]`);
  await card.focus();
  await expect(card.locator("xpath=..")).toHaveAttribute("aria-current", "true");
  await toMap.click();
  await expect(toMap).toHaveAttribute("aria-current", "page");
  await expect(page.locator(MARKER).first()).toBeVisible();
  await expect(sheet.locator(`a[href="/e/${listing.slug}"]`)).toHaveCount(0);
  await expect(sheet).toHaveCount(0);
});

test("with no place on the list on the map, the strip counts them and never says No places", async ({
  page,
}) => {
  const listing = unplaced();
  await stubTiles(page);
  // Only the listing with no location is cumbia, on any night (src/db/seed/nyc-data.ts).
  await page.goto(homePath({ day: listing.nightDate, s: "cumbia", view: "map" }));
  const day = formatDayLabel(listing.nightDate, e2eNow(), "America/New_York", "en-US");
  const where = t("home.header.day", { day, place: "New York" });
  await expect(stripOf(page)).toContainText(t("map.strip.allUnplaced", { where, count: 1 }));
  await expect(stripOf(page)).not.toContainText(en.map.strip.places.zero);
  await expect(page.getByText(t("map.unplacedOnly", { count: 1 }), { exact: true })).toBeVisible();
});

test.describe("the split view", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });
  test("its card prints no pin number, and the others run 1 to n", async ({ page }) => {
    const listing = unplaced();
    await stubTiles(page);
    await page.goto(homePath({ day: listing.nightDate }));
    await expect(page.locator(MARKER).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    const wrapper = page.locator(`${CARD}[href="/e/${listing.slug}"]`).locator("xpath=..");
    await expect(wrapper).not.toHaveAttribute("data-pin-number", /.*/);
    const printed = await page
      .locator("[data-pin-number]")
      .evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-pin-number"))));
    const cards = await page.locator(CARD).count();
    expect(printed).toEqual(Array.from({ length: cards - 1 }, (_, i) => i + 1));
  });
});
