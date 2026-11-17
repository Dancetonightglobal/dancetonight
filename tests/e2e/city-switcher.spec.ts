// The city switcher in the home heading (D-183): the city name is a button that opens the list of
// cities through a modal <dialog>. Mock mode has New York (with listings) and London (no
// listings), so London is listed as coming soon and is not a link.

import { expect, test } from "@playwright/test";

import { en } from "@/src/i18n";
import { skipInEarlyHours } from "./early-hours";

const headline = en.home.header.tonight.replace("{place}", "New York");
const cityButtonName = en.home.header.city.button.replace("{place}", "New York");

test("the city in the heading opens the city list", async ({ page }) => {
  skipInEarlyHours();
  await page.goto("/");
  const heading = page.getByRole("heading", { level: 1 });
  // The heading reads as before; the city inside it is the button.
  await expect(heading).toHaveText(headline);
  const button = heading.getByRole("button", { name: cityButtonName });
  await expect(button).toHaveText("New York");
  // Underlined like "Use my exact location", no arrow.
  await expect(button).toHaveCSS("text-decoration-line", "underline");

  const list = page.locator("#city-picker");
  await expect(list).toBeHidden();
  await button.click();
  await expect(list).toBeVisible();
  await expect(list.getByText(en.home.header.city.choose, { exact: true })).toBeVisible();
  // The dialog itself takes focus, not its first row, so no focus ring is drawn on open (D-584).
  await expect(list).toBeFocused();

  // New York is where the page is: said so, not a link.
  await expect(list.getByText(en.home.header.city.current, { exact: true })).toBeVisible();
  await expect(list.getByRole("link", { name: "New York" })).toHaveCount(0);
  // London has no listings yet: named, marked coming soon, not a link.
  await expect(list.getByText("London", { exact: true })).toBeVisible();
  await expect(list.getByText(en.home.header.city.comingSoon, { exact: true })).toBeVisible();
  await expect(list.getByRole("link", { name: "London" })).toHaveCount(0);

  // Escape closes it, as a modal dialog does.
  await page.keyboard.press("Escape");
  await expect(list).toBeHidden();
  await expect(button).toBeFocused();
});

test("on a phone the list opens below the headline, which stays in view", async ({ page }) => {
  skipInEarlyHours();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: cityButtonName }).click();
  await expect(page.locator("#city-picker")).toBeVisible();
  const box = await page.locator("#city-picker").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(box!.width).toBeGreaterThanOrEqual(389);
  // Below the headline, not over it (D-584).
  const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(h1).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(h1!.y + h1!.height - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box!.height).toBeLessThanOrEqual(844 * 0.7 + 2);
});

test("a small phone keeps the sheet on screen", async ({ page }) => {
  skipInEarlyHours();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: cityButtonName }).click();
  await expect(page.locator("#city-picker")).toBeVisible();
  const box = await page.locator("#city-picker").boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeLessThanOrEqual(1);
  expect(box!.width).toBeGreaterThanOrEqual(319);
  // Below the headline, not over it (D-584).
  const h1 = await page.getByRole("heading", { level: 1 }).boundingBox();
  expect(h1).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(h1!.y + h1!.height - 1);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(box!.height).toBeLessThanOrEqual(640 * 0.7 + 2);
});

test("a tap outside the list closes it and does not reach the page", async ({ page }) => {
  skipInEarlyHours();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const initialUrl = page.url();
  await page.getByRole("button", { name: cityButtonName }).click();
  // Wait for the dialog: a tap before hydration opens nothing and lands on the tab bar.
  await expect(page.locator("#city-picker")).toBeVisible();
  // Below the sheet (it comes from the top, at most 70% of the height).
  await page.mouse.click(195, 830);
  await expect(page.locator("#city-picker")).toBeHidden();
  expect(page.url()).toBe(initialUrl);
});

test("on desktop the list drops down from the city name", async ({ page }) => {
  skipInEarlyHours();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // The page opens scrolled to "now" (D-577); measure from the top, where the heading is.
  await page.evaluate(() => window.scrollTo(0, 0));
  const button = page.getByRole("button", { name: cityButtonName });
  await button.click();
  await expect(page.locator("#city-picker")).toBeVisible();
  const box = await page.locator("#city-picker").boundingBox();
  const buttonBox = await button.boundingBox();
  expect(box).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  expect(box!.width).toBeGreaterThanOrEqual(286);
  expect(box!.width).toBeLessThanOrEqual(290);
  expect(box!.y).toBeGreaterThanOrEqual(buttonBox!.y + buttonBox!.height - 1);
  expect(box!.y).toBeLessThanOrEqual(buttonBox!.y + buttonBox!.height + 16);
});

test("the city button is at least 44px tall to a finger", async ({ page }) => {
  skipInEarlyHours();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  // The page opens scrolled to "now" (D-577); measure from the top, where the heading is.
  await page.evaluate(() => window.scrollTo(0, 0));
  const button = page.getByRole("button", { name: cityButtonName });
  const box = await button.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const top = box!.y;
  const bottom = box!.y + box!.height;
  // The pseudo-element widens the target past the button's own box.
  const hits = (y: number) =>
    page.evaluate(
      ({ x, y }) =>
        document.elementFromPoint(x, y)?.closest('button[aria-haspopup="dialog"]') != null,
      { x: cx, y },
    );
  const topElement = await hits(top - 4);
  const bottomElement = await hits(bottom + 4);
  expect(topElement).toBe(true);
  expect(bottomElement).toBe(true);
});
