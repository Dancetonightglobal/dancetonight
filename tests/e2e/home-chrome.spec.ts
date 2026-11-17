// The parts of the home page around the list (review of the live site, 2026-09-28): the search
// box, the location button, the day picker, the skip links, the theme, the sticky strip and the
// tab title. Each test drives the control the way a dancer would and reads the result.

import { expect, test, type Page } from "@playwright/test";

import { addCalendarDays, formatCalendarDate, formatCalendarDateFrom } from "@/src/domain/time";
import { currentNightDate, pickerLength } from "@/src/domain/tonight";
import { en } from "@/src/i18n";
import { PAPER_DARK, PAPER_LIGHT } from "@/src/ui/home/page-tokens";
import { e2eNow, skipInEarlyHours } from "./early-hours";

const SEED_CENTER = { lat: 40.7128, lng: -74.006 };
const NY = "America/New_York";

function homePath(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    lat: String(SEED_CENTER.lat),
    lng: String(SEED_CENTER.lng),
    ...params,
  });
  return `/?${query.toString()}`;
}

const CARD = 'a[href^="/e/"]';

/** True once React owns the element: a tap before that is an ordinary navigation or is lost. */
async function hydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((s) => {
    const element = document.querySelector(s);
    return element !== null && Object.keys(element).some((key) => key.startsWith("__reactProps"));
  }, selector);
}

function locationButton(page: Page) {
  return page.getByRole("button", { name: en.home.location.useExact });
}

test("a search filters the night and keeps the dancer's centre", async ({ page }) => {
  await page.goto(homePath({ lat: "40.7081", lng: "-73.9571" }));
  const initialCards = await page.locator(CARD).count();
  const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
  await expect(box).toHaveAttribute("placeholder", en.home.location.searchPlaceholder);
  await box.fill("bachata");
  await box.press("Enter");
  await expect(page).toHaveURL(/place=bachata/);

  const url = new URL(page.url());
  expect(url.searchParams.get("lat")).toBe("40.7081");
  expect(url.searchParams.get("lng")).toBe("-73.9571");
  await expect(box).toHaveValue("bachata");
  // At least one card visible, but not more than before the search.
  await expect(page.locator(CARD).first()).toBeVisible();
  const afterCards = await page.locator(CARD).count();
  expect(afterCards).toBeLessThanOrEqual(initialCards);
  // The "We can't look up" text should NOT appear (we are in a metro).
  const noResultsText = en.home.location.noResults
    .replace("{query}", "bachata")
    .replace("{place}", "New York");
  await expect(page.getByText(noResultsText)).not.toBeVisible();
});

test.describe("with the location allowed", () => {
  test.use({
    geolocation: { latitude: 40.7081, longitude: -73.9571 },
    permissions: ["geolocation"],
  });

  test("says the location was used", async ({ page }) => {
    await page.goto("/");
    await hydrated(page, "header button");
    await locationButton(page).click();
    await expect(page).toHaveURL(/lat=40\.70810/);
    await expect(page.getByText(en.home.location.usingYours)).toBeVisible();
  });
});

test("a declined location does not stretch the button across the row", async ({ page }) => {
  // Headless Chromium leaves the prompt unanswered rather than declining, so the browser's own
  // answer is stood in for: the error callback with PERMISSION_DENIED, as Safari gives it.
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = (_ok, fail) =>
      fail?.({
        code: 1,
        message: "denied",
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
      } as GeolocationPositionError);
  });
  await page.goto(homePath());
  await hydrated(page, "header button");
  const before = await locationButton(page).boundingBox();
  await locationButton(page).click();
  await expect(page.getByText(en.home.location.denied)).toBeVisible();
  const after = await locationButton(page).boundingBox();
  expect(after?.width).toBeCloseTo(before?.width ?? 0, 0);
});

test("the location button says it is not ready until it is", async ({ page }) => {
  // Holding the bundle back reproduces a slow phone: the server HTML is on screen first.
  await page.route(/_next\/static\/chunks\//, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await route.continue();
  });
  await page.goto(homePath(), { waitUntil: "domcontentloaded" });
  await expect(locationButton(page)).toBeDisabled();
  await expect(locationButton(page)).toBeEnabled({ timeout: 15_000 });
});

test("the chosen night is in sight in the day picker", async ({ page }) => {
  await page.goto(homePath());
  const picker = page.getByRole("navigation", { name: en.home.day.label });
  const last = await picker.locator("a").last().getAttribute("href");
  await page.goto(last ?? "/");
  const chosen = picker.locator('a[aria-current="page"]');
  await expect(chosen).toHaveCount(1);
  const [strip, link] = await Promise.all([
    picker.locator("ul").boundingBox(),
    chosen.boundingBox(),
  ]);
  expect(link && strip).toBeTruthy();
  if (!link || !strip) return;
  expect(link.x).toBeGreaterThanOrEqual(strip.x - 1);
  expect(link.x + link.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
});

test("a focused skip link floats over the page instead of pushing it down", async ({ page }) => {
  await page.goto(homePath());
  const heading = page.getByRole("heading", { level: 1 });
  // In the document, not the viewport: focusing the link may scroll the page to it.
  const top = () =>
    heading.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
  const before = await top();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: en.a11y.skipToList });
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box?.x ?? 0, "clear of the screen's edge").toBeGreaterThanOrEqual(8);
  expect(await top()).toBeCloseTo(before, 0);
});

test("a chosen theme paints the browser bar too, and a reload keeps it", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(homePath());
  // The colour the browser paints its bar with: the first theme-color meta that applies.
  const bar = () =>
    page.evaluate(() => {
      const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
      const applies = metas.find((meta) => !meta.media || window.matchMedia(meta.media).matches);
      return applies?.content ?? null;
    });
  const metaCount = () => page.locator('meta[name="theme-color"]').count();
  expect(await bar()).toBe(PAPER_LIGHT);

  const group = page.getByRole("group", { name: en.home.theme.label });
  await group.scrollIntoViewIfNeeded();
  await hydrated(page, 'input[name="dancetonight-theme"]');
  await group.getByText(en.home.theme.dark, { exact: true }).click();
  await expect.poll(bar).toBe(PAPER_DARK);

  await page.reload();
  await expect.poll(bar).toBe(PAPER_DARK);
  // Hydration leaves the head as the script left it: the two device metas and the chosen one.
  await expect.poll(metaCount).toBe(3);

  await hydrated(page, 'input[name="dancetonight-theme"]');
  await group.getByText(en.home.theme.system, { exact: true }).click();
  await expect.poll(bar).toBe(PAPER_LIGHT);
  await expect.poll(metaCount).toBe(2);
});

test("Back to now in the sticky strip is a 44px target", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();
  const rule = page.locator('[role="separator"][aria-label^="Now"]');
  await expect(rule).toHaveCount(1);
  // Past the rule, so the strip shows. Room below the bill first: late in the evening the page
  // ends less than a screen below the rule and the strip, rightly, never appears.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "100vh";
    window.scrollTo(0, document.body.scrollHeight);
  });
  const back = page.getByRole("link", { name: en.home.now.backToNow });
  await expect(back).toBeVisible();
  const box = await back.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  // The strip is 32px with a 2px edge; the link's hit area runs 14px below it, to 44px.
  const x = box.x + box.width / 2;
  for (const y of [box.y + 1, box.y + 43]) {
    const hit = await page.evaluate(
      ([px, py]) => document.elementFromPoint(px, py)?.closest("a")?.getAttribute("href") ?? null,
      [x, y] as const,
    );
    expect(hit, `a tap at ${Math.round(y)}px`).toMatch(/^#/);
  }
});

test("the now strip has a city button that opens the city list", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();
  const rule = page.locator('[role="separator"][aria-label^="Now"]');
  await expect(rule).toHaveCount(1);
  // Past the rule, so the strip shows. Room below the bill first: late in the evening the page
  // ends less than a screen below the rule and the strip, rightly, never appears.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "100vh";
    window.scrollTo(0, document.body.scrollHeight);
  });
  const strip = page.locator("div.fixed.border-spot");
  const cityButton = strip.getByRole("button", {
    name: en.home.header.city.button.replace("{place}", "New York"),
  });
  await expect(cityButton).toBeVisible();
  await cityButton.click();
  await expect(page.locator("#city-picker")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#city-picker")).toBeHidden();
});

test("Jump to now shows above the now rule and goes to it", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();
  const rule = page.locator('[role="separator"][aria-label^="Now"]');
  await expect(rule).toHaveCount(1);
  // Add room above the rule so it can be below the viewport.
  await page.evaluate(() => {
    document.body.style.paddingBottom = "100vh";
    window.scrollTo(0, 0);
  });
  // Scroll past the header first, then enough to put the rule below the viewport.
  await page.evaluate(() => {
    const header = document.getElementById("page-header");
    const r = document.querySelector('[role="separator"][aria-label^="Now"]')!;
    const headerBottom = header ? header.getBoundingClientRect().bottom + window.scrollY : 0;
    const targetScroll = Math.max(
      headerBottom + 1,
      r.getBoundingClientRect().top + window.scrollY - window.innerHeight - 200,
    );
    window.scrollTo(0, targetScroll);
  });
  // Check if the rule is actually below the viewport.
  const below = await rule.evaluate((el) => el.getBoundingClientRect().top > window.innerHeight);
  if (!below) {
    test.skip(true, "not enough of the bill above now to scroll it out of view");
    return;
  }
  // Also skip if the header is still in view.
  const headerInView = await page
    .locator("#page-header")
    .evaluate((el) => el.getBoundingClientRect().bottom > 0);
  if (headerInView) {
    test.skip(true, "header still in view");
    return;
  }
  const jump = page.getByRole("link", { name: en.home.now.jumpToNow });
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(rule).toBeInViewport();
});

/** The whole tab title: the headline, then the site's name, "Tonight near New York · DanceTonight". */
function tabTitle(headline: string): string {
  return `${headline} · ${en.common.siteName}`;
}

test("the tab says which night and where, and whose site it is", async ({ page }) => {
  skipInEarlyHours();
  // The layout's title template never reached the home page, which shares its segment, so the
  // tab read "Tonight near New York" alone (D-076). An exact match, not a pattern.
  await page.goto(homePath());
  await expect(page).toHaveTitle(tabTitle(en.home.header.tonight.replace("{place}", "New York")));

  // Tomorrow, by a tap on the picker: a client-side navigation brings its own title.
  await hydrated(page, `nav[aria-label="${en.home.day.label}"] a`);
  await page
    .getByRole("navigation", { name: en.home.day.label })
    .getByRole("link", { name: new RegExp(`^${en.home.day.tomorrow},`) })
    .click();
  await expect(page).toHaveURL(/day=/);
  await expect(page).toHaveTitle(tabTitle(en.home.header.tomorrow.replace("{place}", "New York")));
});

test("the day picker offers a whole week and the next full weekend", async ({ page }) => {
  await page.goto(homePath());
  const days = await page
    .getByRole("navigation", { name: en.home.day.label })
    .locator("a")
    .evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("day") ?? ""),
    );
  const tonight = currentNightDate(e2eNow(), NY);
  // The picker shows the correct number of nights for today
  expect(days.length).toBe(pickerLength(tonight));
  expect(days.length).toBeGreaterThanOrEqual(7);
  // Check that we have all weekdays (0-6) covered
  const weekdays = new Set(days.map((day) => new Date(`${day}T12:00:00Z`).getUTCDay()));
  expect(weekdays.size).toBe(7);
});

test("a link to a night beyond the picker opens that night, names it, and marks no day", async ({
  page,
}) => {
  // Ten nights on (D-075): past the picker's seven, inside the twelve a link opens.
  const later = addCalendarDays(currentNightDate(e2eNow(), NY), 10);
  const name = en.home.header.day
    .replace("{day}", formatCalendarDate(later))
    .replace("{place}", "New York");
  await page.goto(homePath({ day: later }));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
  await expect(page).toHaveTitle(tabTitle(name));
  // The picker offers its own seven nights; none of them is the night on screen, so none is
  // marked and the strip is left at its start.
  const picker = page.getByRole("navigation", { name: en.home.day.label });
  await expect(picker.locator("a")).toHaveCount(pickerLength(currentNightDate(e2eNow(), NY)));
  await expect(picker.locator("a[aria-current]")).toHaveCount(0);
  expect(await picker.locator("ul").evaluate((list) => list.scrollLeft)).toBe(0);
  // The list is that night's: the seed's weekly nights are on it, each card for that date.
  const hrefs = await page
    .locator(CARD)
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) expect(href.endsWith(`-${later}`), href).toBe(true);
});

test("a link to a night that is over, or not yet read, opens tonight and says so", async ({
  page,
}) => {
  skipInEarlyHours();
  const tonight = currentNightDate(e2eNow(), NY);
  const past = addCalendarDays(tonight, -1);
  // Tonight + 13, the ingest's last night, which may not be written yet (D-075).
  const later = addCalendarDays(tonight, 13);
  const cases: Array<[string, string]> = [
    [past, en.home.day.unopened.over.replace("{day}", formatCalendarDateFrom(past, tonight))],
    [later, en.home.day.unopened.notYet.replace("{day}", formatCalendarDateFrom(later, tonight))],
    ["soon", en.home.day.unopened.notADate],
  ];
  const headline = en.home.header.tonight.replace("{place}", "New York");
  for (const [day, notice] of cases) {
    // The sheet open too, so its form's hidden inputs are on the page.
    await page.goto(homePath({ day, t: "social", filters: "1" }));
    await expect(page.getByRole("heading", { level: 1 }), day).toHaveText(headline);
    await expect(page).toHaveTitle(tabTitle(headline));
    await expect(page.getByText(notice, { exact: true }), day).toBeVisible();
    // Every link and form carries the night on screen (audit F16): the filter links are there,
    // and none of them, nor any hidden input, names the night the page did not open.
    await expect(page.locator('a[href^="/?"][href*="t=social"]').first()).toBeAttached();
    const named = await page.evaluate(
      (asked) =>
        [
          ...[...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? ""),
          ...[...document.querySelectorAll('input[name="day"]')].map(
            (i) => `input:${(i as HTMLInputElement).value}`,
          ),
        ].filter(
          (v) =>
            v.startsWith("input:") ||
            new URLSearchParams(v.split("?")[1] ?? "").get("day") === asked,
        ),
      day,
    );
    expect(named, day).toEqual([]);
  }
  // A night the page opens says nothing of the kind.
  const far = addCalendarDays(tonight, 12);
  await page.goto(homePath({ day: far }));
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    formatCalendarDate(far, "en-US"),
  );
  await expect(page.getByText("Showing tonight")).toHaveCount(0);
});

test.describe("at 320px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("the seven-night picker scrolls in its own strip, never the page", async ({ page }) => {
    await page.goto(homePath());
    const picker = page.getByRole("navigation", { name: en.home.day.label });
    await expect(picker.locator("a")).toHaveCount(pickerLength(currentNightDate(e2eNow(), NY)));
    const widths = () =>
      page.evaluate(() => ({
        page: document.documentElement.scrollWidth,
        viewport: document.documentElement.clientWidth,
      }));
    const opened = await widths();
    expect(opened.page, "no sideways page scroll").toBeLessThanOrEqual(opened.viewport);

    // The last night, the seventh, chosen: in sight inside the strip, still no page scroll.
    const last = await picker.locator("a").last().getAttribute("href");
    await page.goto(last ?? "/");
    const chosen = picker.locator('a[aria-current="page"]');
    await expect(chosen).toHaveCount(1);
    await expect(chosen).toHaveAttribute("href", last ?? "");
    const [strip, link] = await Promise.all([
      picker.locator("ul").boundingBox(),
      chosen.boundingBox(),
    ]);
    expect(link && strip).toBeTruthy();
    if (!link || !strip) return;
    expect(link.x).toBeGreaterThanOrEqual(strip.x - 1);
    expect(link.x + link.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
    expect(link.x + link.width, "inside the screen").toBeLessThanOrEqual(320 + 1);
    const chosenWidths = await widths();
    expect(chosenWidths.page).toBeLessThanOrEqual(chosenWidths.viewport);
  });
});

test.describe("in the split view", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("the sticky strip spans the list, not the map beside it", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();
    await expect(page.locator('[role="separator"][aria-label^="Now"]')).toHaveCount(1);
    // Room below the bill, so the now rule can leave the top at any hour: late in the evening
    // the page ends less than a screen below it and the strip, rightly, never appears.
    await page.evaluate(() => {
      document.body.style.paddingBottom = "100vh";
      window.scrollTo(0, document.body.scrollHeight);
    });
    const back = page.getByRole("link", { name: en.home.now.backToNow });
    await expect(back).toBeVisible();
    const strip = await back.evaluate((element) => {
      const box = element.closest(".fixed")?.getBoundingClientRect();
      return box ? { left: box.left, right: box.right } : null;
    });
    const list = await page.locator("#bill").boundingBox();
    expect(strip && list).toBeTruthy();
    if (!strip || !list) return;
    expect(strip.left).toBeLessThanOrEqual(list.x + 1);
    expect(strip.right, "the strip stops at the list's edge").toBeLessThanOrEqual(
      list.x + list.width + 1,
    );
  });
});

// Greenwich, Connecticut: 50 km from Midtown, just past the metro match, with Queens in reach.
const GREENWICH = { lat: "41.0589", lng: "-73.6228" };
// London: nothing within reach on any night.
const LONDON = { lat: "51.5074", lng: "-0.1278" };

test.describe("outside every metro", () => {
  test("a point with New York's places in reach is about New York", async ({ page }) => {
    await page.goto(`/?${new URLSearchParams(GREENWICH).toString()}`);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).not.toHaveText(en.home.location.noMetro);
    await expect(heading).toContainText("New York");
    await expect(page).not.toHaveTitle(new RegExp(en.home.location.noMetro));
  });

  test("a point with nothing in reach says so, and a search for the metro goes there", async ({
    page,
  }) => {
    skipInEarlyHours();
    await page.goto(`/?${new URLSearchParams(LONDON).toString()}`);
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toHaveText(en.home.location.noMetro);
    // The tab makes no claim here: the site's name alone, never doubled or blank.
    await expect(page).toHaveTitle(en.common.siteName);

    const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
    await box.fill("Boston");
    await box.press("Enter");
    await expect(page).toHaveURL(/place=Boston/);
    await expect(
      page.getByText(en.home.location.noResultsOutside.replace("{query}", "Boston")),
    ).toBeVisible();

    await box.fill("New York");
    await box.press("Enter");
    await expect(heading).toHaveText(en.home.header.tonight.replace("{place}", "New York"));
    // The London point is dropped: no link the page builds carries it on.
    const hrefs = await page
      .getByRole("navigation", { name: en.home.day.label })
      .locator("a")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) expect(href).not.toContain("lat=");
  });
});

test.describe("the location message follows the URL", () => {
  test.use({
    geolocation: { latitude: 40.7081, longitude: -73.9571 },
    permissions: ["geolocation"],
  });

  test("and is gone once the page is back on the default centre", async ({ page }) => {
    await page.goto("/");
    await hydrated(page, "header button");
    await locationButton(page).click();
    await expect(page).toHaveURL(/lat=40\.70810/);
    await expect(page.getByText(en.home.location.usingYours)).toBeVisible();
    await page.goBack();
    await expect(page).not.toHaveURL(/lat=/);
    await expect(page.getByText(en.home.location.usingYours)).toHaveCount(0);
  });
});

test("a location prompt left unanswered does not lock the button", async ({ page }) => {
  // A dismissed prompt calls neither callback.
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => undefined;
  });
  await page.goto(homePath());
  await hydrated(page, "header button");
  await locationButton(page).click();
  await expect(page.getByText(en.home.location.locating)).toBeVisible();
  await expect(locationButton(page)).toBeEnabled();
});
test("the search updates as you type, without Enter", async ({ page }) => {
  await page.goto(homePath());
  const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
  await box.fill("bachata");
  // Wait for the debounced URL update
  await expect(page).toHaveURL(/place=bachata/);
  // Button should show "Clear"
  await expect(page.getByRole("button", { name: en.home.location.clearButton })).toBeVisible();
  // Box should still have value and be focused
  await expect(box).toHaveValue("bachata");
  await expect(box).toBeFocused();
});

test("Clear empties the box and the search", async ({ page }) => {
  await page.goto(homePath());
  const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
  await box.fill("zzqx");
  // Wait for URL to update
  await expect(page).toHaveURL(/place=zzqx/);
  // Click the Clear button
  await page.getByRole("button", { name: en.home.location.clearButton }).click();
  // URL should no longer have place parameter
  await expect(page).not.toHaveURL(/place=/);
  // Box should be empty
  await expect(box).toHaveValue("");
  // Button should read "Search"
  await expect(page.getByRole("button", { name: en.home.location.searchButton })).toBeVisible();
  // At least one card should be visible
  await expect(page.locator(CARD).first()).toBeVisible();
});

test("a search that matches nothing says so and clears", async ({ page }) => {
  await page.goto(homePath());
  const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
  await box.fill("zzqx");
  await box.press("Enter");
  await expect(page).toHaveURL(/place=zzqx/);
  // Expect the "Nothing matches" text.
  await expect(page.getByText("Nothing matches “zzqx”")).toBeVisible();
  // Click the "Clear search" link.
  await page.getByRole("link", { name: en.home.filters.clearSearch }).click();
  await expect(page).not.toHaveURL(/place=/);
  // At least one card should be visible after clearing.
  await expect(page.locator(CARD).first()).toBeVisible();
});

// CI 2026-10-18: on the slow dev server the test typed into the box before hydration; React kept
// its own empty value, a re-render wiped the box and Enter searched for nothing ("place=").
test.describe("the search box", () => {
  test("text typed before the page hydrates is kept, and the box knows it holds text", async ({
    page,
  }) => {
    // Hold the page's code back so the box is typed into while it is still server-rendered.
    await page.route("**/_next/static/chunks/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      await route.continue();
    });
    await page.goto(`/?${new URLSearchParams(LONDON).toString()}`, { waitUntil: "commit" });
    const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
    await box.fill("Boston");
    await page.waitForLoadState("networkidle");
    // Hydrated, the box offers to clear what it holds rather than to search an empty box.
    const search = page.getByRole("search");
    await expect(search.getByRole("button", { name: en.home.location.clearButton })).toBeVisible();
    await expect(box).toHaveValue("Boston");
    await box.press("Enter");
    await expect(page).toHaveURL(/place=Boston/);
  });

  test("Enter loads the page once: the search-as-you-type request is cancelled", async ({
    page,
  }) => {
    await page.goto(`/?${new URLSearchParams(LONDON).toString()}`);
    await page.waitForLoadState("networkidle");
    const requests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).searchParams.get("place") !== null) {
        requests.push(`${request.resourceType()} ${request.url()}`);
      }
    });
    // A server slower than the debounce, as the dev server on CI is: the page Enter asked for
    // arrives after the search-as-you-type timer would have fired.
    await page.route("**/*", async (route) => {
      if (route.request().resourceType() === "document") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await route.continue();
    });
    const box = page.getByRole("searchbox", { name: en.home.location.searchLabel });
    // Enter well inside the 350ms debounce.
    await box.fill("Boston");
    await box.press("Enter");
    await expect(page).toHaveURL(/place=Boston/);
    await page.waitForLoadState("networkidle");
    // Past the debounce: nothing else is fetched for the search.
    await page.waitForTimeout(1000);
    expect(requests.filter((line) => line.startsWith("document"))).toHaveLength(1);
    expect(requests.filter((line) => !line.startsWith("document"))).toEqual([]);
  });
});
test("the now strip never covers the headline", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();
  // Ensure we are at the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  // The strip should not be visible.
  await expect(page.getByRole("link", { name: en.home.now.jumpToNow })).toHaveCount(0);
  // Check that the h1 is at the top-centre point.
  const h1 = page.getByRole("heading", { level: 1 });
  const h1Box = await h1.boundingBox();
  expect(h1Box).toBeTruthy();
  if (!h1Box) return;
  const x = h1Box.x + h1Box.width / 2;
  const y = h1Box.y + 4;
  const elementAtPoint = await page.evaluate(
    ([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest("h1") !== null;
    },
    [x, y] as const,
  );
  expect(elementAtPoint).toBe(true);
});
