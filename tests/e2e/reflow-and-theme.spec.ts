// Two things the design promises on every screen (DESIGN.md sections 8 and 11): the page reflows
// at 320px with no horizontal scroll, and light and dark are each designed rather than inverted.

import { expect, test, type Page } from "@playwright/test";

import { e2eNow } from "./early-hours";
import { addCalendarDays } from "@/src/domain/time";
import { currentNightDate, pickerLength } from "@/src/domain/tonight";
import { en } from "@/src/i18n";
import { THEME_STORAGE_KEY } from "@/src/ui/theme";

const NY = "America/New_York";
const SEED_CENTER = { lat: 40.7128, lng: -74.006 };

function homePath(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    lat: String(SEED_CENTER.lat),
    lng: String(SEED_CENTER.lng),
    ...params,
  });
  return `/?${query.toString()}`;
}

const CARD = 'a[href^="/e/"]';
const NOW_RULE = '[role="separator"][aria-label^="Now"]';

interface Overhang {
  width: number;
  clientWidth: number;
  culprits: string[];
}

/** Anything sticking out past the right edge of the page, named so a failure says what to fix. */
async function overhangs(page: Page): Promise<Overhang> {
  return page.evaluate(() => {
    const root = document.documentElement;
    const limit = root.clientWidth;

    // The chip row scrolls sideways on purpose (DESIGN.md section 5), so anything inside a
    // scroller or a clip is the scroller's business, not the page's.
    const clipped = (element: Element): boolean => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        const overflow = window.getComputedStyle(node).overflowX;
        if (overflow === "auto" || overflow === "scroll" || overflow === "hidden") return true;
      }
      return false;
    };

    const culprits: string[] = [];
    for (const element of Array.from(document.body.querySelectorAll("*"))) {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (box.right <= limit + 1) continue;
      if (clipped(element)) continue;
      const tag = element.tagName.toLowerCase();
      const classes = element.getAttribute("class") ?? "";
      culprits.push(`<${tag} class="${classes}"> reaches ${Math.round(box.right)}px`);
      if (culprits.length >= 5) break;
    }
    return { width: root.scrollWidth, clientWidth: limit, culprits };
  });
}

test.describe("at 320px", () => {
  // The narrowest phone the spec supports. WCAG 2.2 reflow (1.4.10) reads 320px as the width a
  // 1280px page has at 400% zoom, so this is the zoom check too.
  test.use({ viewport: { width: 320, height: 800 } });

  test("the bill reflows with no horizontal scroll, on every night of the picker", async ({
    page,
  }) => {
    // Every night, not only tonight: the cards' event lines name hosts of any length (D-073), and
    // the seed's longest (39 characters) is on a night a few days out.
    for (
      let offset = 0;
      offset < pickerLength(currentNightDate(e2eNow(), "America/New_York"));
      offset += 1
    ) {
      const day = addCalendarDays(currentNightDate(e2eNow(), NY), offset);
      await page.goto(homePath({ day }));
      await expect(page.locator(CARD).first()).toBeVisible();

      const result = await overhangs(page);
      expect(result.culprits, `${day}: nothing sticks out past the right edge`).toEqual([]);
      expect(result.width, `${day}: the page does not scroll sideways`).toBeLessThanOrEqual(
        result.clientWidth + 1,
      );
    }
  });

  test("a listing reflows with no horizontal scroll", async ({ page }) => {
    await page.goto(homePath());
    await page.locator(CARD).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const result = await overhangs(page);
    expect(result.culprits, "nothing sticks out past the right edge").toEqual([]);
    expect(result.width, "the page does not scroll sideways").toBeLessThanOrEqual(
      result.clientWidth + 1,
    );
  });
});

test("both themes print the same flyer: the stamped rail and the now rule in each", async ({
  page,
}) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();

  const spotByTheme: Record<string, string> = {};

  for (const theme of ["light", "dark"] as const) {
    // The choice is stamped on <html> before first paint, so a dark visitor never sees a flash
    // of paper (src/ui/theme.tsx).
    await page.evaluate(
      (stored: { key: string; value: string }) =>
        window.localStorage.setItem(stored.key, stored.value),
      { key: THEME_STORAGE_KEY, value: theme },
    );
    await page.reload();

    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // The rail is stamped and readable.
    const firstCard = page.locator(CARD).first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toHaveText(/\d/);

    // The now rule is the single loudest thing on the page, in both prints.
    const rule = page.locator(NOW_RULE);
    await expect(rule).toBeVisible();

    // The spot colour it is drawn in: opaque, and not the paper it sits on.
    const spot = await rule.evaluate((element) => {
      const paper = window.getComputedStyle(document.body).backgroundColor;
      const nodes = [element, ...Array.from(element.querySelectorAll("*"))];
      for (const node of nodes) {
        const background = window.getComputedStyle(node).backgroundColor;
        if (background && background !== "rgba(0, 0, 0, 0)" && background !== paper) {
          return background;
        }
      }
      return null;
    });
    expect(spot, `the now rule is drawn in the spot colour (${theme})`).not.toBeNull();
    spotByTheme[theme] = spot ?? "";
  }

  // Dark is a second print run on navy stock, not an inversion of the first: the spot colour is a
  // hi-vis orange sticker there and poster red here, so the two are not the same ink.
  expect(spotByTheme["dark"], "dark is designed, not inverted").not.toBe(spotByTheme["light"]);
});

test("the print-run control changes the page and is remembered", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();

  // Three choices, not a two-state switch: "match my device" has to stay reachable, or the first
  // tap is one-way (DESIGN.md section 12).
  const group = page.getByRole("group", { name: en.home.theme.label });
  await expect(group).toBeVisible();
  for (const label of [en.home.theme.system, en.home.theme.light, en.home.theme.dark]) {
    await expect(group.getByRole("radio", { name: label })).toHaveCount(1);
  }

  // The radio itself is visually hidden and the label is the target, which is what a thumb hits.
  const choose = (label: string) => group.locator("label").filter({ hasText: label }).click();

  const paperOf = () => page.evaluate(() => window.getComputedStyle(document.body).backgroundColor);
  const before = await paperOf();

  await choose(en.home.theme.dark);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await paperOf(), "navy stock is not the paper one").not.toBe(before);

  // Remembered across a cold load, and stamped before first paint.
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(group.getByRole("radio", { name: en.home.theme.dark })).toBeChecked();

  // And the device preference is reachable again afterwards.
  await choose(en.home.theme.system);
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
});

test("the type scale answers a browser font-size preference", async ({ page }) => {
  // WCAG 2.2 1.4.4: the scale is in rem and <html> carries no font-size of its own, so a visitor
  // who set 24px in their browser reads a bigger flyer. A px scale would ignore them silently.
  await page.goto(homePath());
  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();

  const nameSize = async () =>
    page
      .locator(".type-card-name")
      .first()
      .evaluate((element) => Number.parseFloat(window.getComputedStyle(element).fontSize));

  const atDefault = await nameSize();
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "24px";
  });
  const atLarge = await nameSize();
  expect(atLarge, "the card name grows with the root font size").toBeGreaterThan(atDefault);
});
