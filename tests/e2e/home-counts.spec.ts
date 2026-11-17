// Every number on the home page is what its tap gives (D-067). The owner opened Tomorrow, chose
// Classes and ticked Swing, Tango and Folk: the chip read "Tango 2" and no tango showed, and the
// header said seven places over two cards. Each test here taps (or follows) a control and counts
// the cards that come back, so a number that promises more than the list holds fails.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { currentNightDate, pickerLength } from "@/src/domain/tonight";
import { en } from "@/src/i18n";

import { e2eNow } from "./early-hours";

const SEED_CENTER = { lat: 40.7128, lng: -74.006 };

function homePath(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    lat: String(SEED_CENTER.lat),
    lng: String(SEED_CENTER.lng),
    ...params,
  });
  return `/?${query.toString()}`;
}

/** The whole card is one link (DESIGN.md section 5), so every card is an anchor into /e/. */
const CARD = 'a[href^="/e/"]';

function chipLinks(page: Page): Locator {
  return page.getByRole("navigation", { name: en.home.styles.label }).locator("a");
}

function segmentLinks(page: Page): Locator {
  return page.getByRole("navigation", { name: en.home.segments.label }).locator("a");
}

function dayLinks(page: Page): Locator {
  return page.getByRole("navigation", { name: en.home.day.label }).locator("a");
}

/** "Swing, 1 place" or "Swing, 3 places, selected" (home.styles.chip): the number it promises. */
function chipCount(label: string): number {
  const match = /, (\d+) places?(, selected)?$/.exec(label);
  if (!match) throw new Error(`a chip without a count: ${label}`);
  return Number(match[1]);
}

/** The family a chip names: "Swing" from "Swing, 1 place". */
function familyOf(label: string): string {
  return label.replace(/, \d+ places?(, selected)?$/, "");
}

/** The header's "7 places to dance" as a number; "No places to dance" is 0. */
async function headerCount(page: Page): Promise<number> {
  const text = await page.locator("header p span").first().innerText();
  const match = /^(\d+)/.exec(text.trim());
  return match ? Number(match[1]) : 0;
}

/** Every chip on the page as its href and promised count. */
async function chips(page: Page): Promise<{ href: string; count: number; label: string }[]> {
  return chipLinks(page)
    .evaluateAll((links) =>
      links.map((link) => ({
        href: link.getAttribute("href") ?? "",
        label: link.getAttribute("aria-label") ?? "",
        count: 0,
      })),
    )
    .then((rows) => rows.map((row) => ({ ...row, count: chipCount(row.label) })));
}

/** Waits for the list to be drawn: a card, or the tail's sentence when there is none. */
async function settled(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("a chip's number is the cards its tap shows, in every segment and on every night", async ({
  page,
}) => {
  await page.goto(homePath());
  await settled(page);
  const nights = await dayLinks(page).evaluateAll((links) =>
    links.map((link) => link.getAttribute("href") ?? ""),
  );
  expect(nights.length).toBeGreaterThan(1);

  let checked = 0;
  for (const night of nights.slice(0, 2)) {
    await page.goto(night);
    await settled(page);
    const segments = await segmentLinks(page).evaluateAll((links) =>
      links.map((link) => link.getAttribute("href") ?? ""),
    );
    for (const segment of segments) {
      await page.goto(segment);
      await settled(page);
      // The header counts the list under it.
      expect(await headerCount(page), `header on ${segment}`).toBe(
        await page.locator(CARD).count(),
      );
      for (const chip of await chips(page)) {
        await page.goto(chip.href);
        await settled(page);
        expect(await page.locator(CARD).count(), `${chip.label} on ${segment}`).toBe(chip.count);
        expect(await headerCount(page), `header after ${chip.label}`).toBe(chip.count);
        checked += 1;
      }
    }
  }
  expect(checked, "the seed offers chips to check").toBeGreaterThan(5);
});

test("a day's number is the cards its tap shows, under the filters that are on", async ({
  page,
}) => {
  const filters: Record<string, string>[] = [{}, { t: "classes" }, { t: "social" }];
  for (const params of filters) {
    await page.goto(homePath(params));
    await settled(page);
    const days = await dayLinks(page).evaluateAll((links) =>
      links.map((link) => ({
        href: link.getAttribute("href") ?? "",
        count: Number(link.querySelectorAll("span")[1]?.textContent ?? "NaN"),
      })),
    );
    // Every night of the week the picker offers (D-075), each one checked.
    expect(days).toHaveLength(pickerLength(currentNightDate(e2eNow(), "America/New_York")));
    for (const day of days) {
      await page.goto(day.href);
      await settled(page);
      expect(await page.locator(CARD).count(), `${day.href}`).toBe(day.count);
    }
  }
});

test("a chip that is on stays in the row with its 0, so it can be tapped off", async ({ page }) => {
  // A family that tonight's socials hold but its classes do not: tick it under Social, then
  // switch the segment to Classes, which is how the owner met "Tango 2" with no tango showing.
  await page.goto(homePath({ t: "social" }));
  await settled(page);
  const social = await chips(page);
  await page.goto(homePath({ t: "classes" }));
  await settled(page);
  const classFamilies = new Set((await chips(page)).map((chip) => familyOf(chip.label)));
  const missing = social.find((chip) => !classFamilies.has(familyOf(chip.label)));
  expect(missing, "a family with a social and no class tonight").toBeDefined();
  if (!missing) return;

  const family = new URL(missing.href, "http://x").searchParams.get("f") ?? "";
  await page.goto(homePath({ t: "classes", f: family }));
  await settled(page);
  const name = `${familyOf(missing.label)}, 0 places, selected`;
  await expect(chipLinks(page).and(page.locator(`[aria-label="${name}"]`))).toHaveCount(1);
  await expect(page.locator(CARD)).toHaveCount(0);

  // The tail says why the list is empty and offers the way back, rather than "Nothing on".
  await expect(
    page.getByText(en.home.empty.noMatch.other.split("{count}")[1]!.trim()),
  ).toBeVisible();
  await page.getByRole("link", { name: en.home.filters.clear }).click();
  await expect(page.locator(CARD).first()).toBeVisible();
  expect(new URL(page.url()).searchParams.get("f")).toBeNull();
  expect(new URL(page.url()).searchParams.get("t")).toBeNull();
});

test("tapping a chip keeps the list where the thumb was", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();

  // The chip with the most places, so the list after the tap is as long as it can be. A list too
  // short to scroll puts the page at its top whatever the link does (Swing's one place did, on
  // live data), so the check is against how far the new page can scroll.
  const busiest = (await chips(page)).reduce((a, b) => (b.count > a.count ? b : a));
  const chip = chipLinks(page).and(page.locator(`[aria-label="${busiest.label}"]`));

  // A tap before hydration is a plain navigation (that is fine, and covered by the tests above);
  // this one is about the client navigation, so it waits until React owns the chip.
  await chip.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.waitForFunction((label) => {
    const link = document.querySelector(`nav[aria-label="${label}"] a`);
    return link !== null && Object.keys(link).some((key) => key.startsWith("__reactProps"));
  }, en.home.styles.label);
  await page.evaluate(() => window.scrollBy(0, -40));
  const before = await page.evaluate(() => window.scrollY);
  expect(before, "the page is scrolled down to the chips").toBeGreaterThan(0);

  await chip.click();
  await expect(page).toHaveURL(/[?&]f=/);
  await expect(page.locator(CARD)).toHaveCount(busiest.count);
  const { after, furthest } = await page.evaluate(() => ({
    after: window.scrollY,
    furthest: document.documentElement.scrollHeight - window.innerHeight,
  }));
  const expected = Math.min(before, furthest);
  expect(Math.abs(after - expected), `scrolled from ${before} to ${after}`).toBeLessThanOrEqual(2);
});
