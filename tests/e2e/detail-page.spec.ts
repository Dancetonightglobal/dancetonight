// The detail page after the owner's audit of the live site on 2026-09-28 (D-069): it names the
// night it is about, finds its way back to the dancer's own list, sells nothing once a night is
// over, adds to the calendar by a plain link, and leaves no link on the page that ends in a 404.
// Run against mock mode (D-011): the New York seed is rebuilt around the real clock, so dates
// here are computed the same way the server computes them.

import { expect, test, type Page } from "@playwright/test";

import { addCalendarDays, formatCalendarDate } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { en } from "@/src/i18n";
import { COPIED_RESET_MS } from "@/src/ui/detail/share-button";
import { e2eNow, skipInEarlyHours } from "./early-hours";

const NY = "America/New_York";
const SEED_CENTER = { lat: 40.7128, lng: -74.006 };
const CARD = 'a[href^="/e/"]';

function homePath(params: Record<string, string> = {}): string {
  const query = new URLSearchParams({
    lat: String(SEED_CENTER.lat),
    lng: String(SEED_CENTER.lng),
    ...params,
  });
  return `/?${query.toString()}`;
}

const tomorrow = () => addCalendarDays(currentNightDate(e2eNow(), NY), 1);

/** React has attached its handlers to this element: a tap now reaches the component. */
async function hydrated(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      const element = document.querySelector(sel);
      return element !== null && Object.keys(element).some((key) => key.startsWith("__reactProps"));
    },
    selector,
    { timeout: 15_000 },
  );
}

/** Opens the first card of tomorrow's list and returns the detail page's path. */
async function openTomorrowsFirst(page: Page): Promise<string> {
  await page.goto(homePath({ day: tomorrow() }));
  const card = page.locator(CARD).first();
  const href = (await card.getAttribute("href")) ?? "";
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  // The URL changes when the new document commits, while it is still streaming in: a test that
  // then reads the page without waiting saw half of it under `next dev` (2026-09-28).
  await page.waitForLoadState("load");
  return href;
}

test("the page names its night, on the page and in the tab (C1, C2, C10)", async ({ page }) => {
  await openTomorrowsFirst(page);
  const date = formatCalendarDate(tomorrow());
  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  await expect(header).toContainText(en.detail.date.tomorrow.replace("{date}", date));
  // The tab: "{title} · Tue, Sep 29 · DanceTonight", the plain date so a bookmark stays true,
  // joined by a middle dot because the US date carries its own comma (D-072).
  const title = (await page.getByRole("heading", { level: 1 }).textContent()) ?? "";
  const pageTitle = en.detail.pageTitle.replace("{title}", title).replace("{date}", date);
  await expect(page).toHaveTitle(`${pageTitle} · ${en.common.siteName}`);
  // Nothing on the page claims a night is a one-off: no source says so.
  await expect(page.getByText(en.detail.recurrence.oneOff)).toHaveCount(0);
});

test("the back link steps back to the dancer's own list, filters and scroll (C4)", async ({
  page,
}) => {
  const list = homePath({ day: tomorrow(), t: "social" });
  await page.goto(list);
  const cards = page.locator(CARD);
  await expect(cards.nth(2)).toBeVisible();
  await cards.nth(2).scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 120));
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);
  await cards.nth(2).click();
  await expect(page).toHaveURL(/\/e\//);

  const back = page.locator("main nav a").first();
  await expect(back).toHaveText(en.detail.back.tomorrow);
  await hydrated(page, "main nav a");
  await back.click();

  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === list);
  await expect
    .poll(() => page.evaluate(() => window.scrollY), { message: "the list keeps its scroll" })
    .toBeGreaterThan(scrolled - 40);
});

test("a shared link's back link goes to the listing's own night (C4)", async ({ browser }) => {
  const first = await browser.newPage();
  const href = await openTomorrowsFirst(first);
  await first.close();

  // A new tab with no history of ours, as a link opened from a message is.
  const page = await browser.newPage();
  await page.goto(href);
  const back = page.locator("main nav a").first();
  await expect(back).toHaveText(en.detail.back.tomorrow);
  await expect(back).toHaveAttribute("href", `/?day=${tomorrow()}`);
  await hydrated(page, "main nav a");
  await back.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.search === `?day=${tomorrow()}`,
  );
  await expect(page.locator(CARD).first()).toBeVisible();

  // Back to the page with the browser: the list is ahead of it now, not behind, so a second tap
  // follows the href again instead of stepping back onto nothing (review, 2026-09-28).
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  await hydrated(page, "main nav a");
  await back.click();
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.search === `?day=${tomorrow()}`,
  );
  await expect(page.locator(CARD).first()).toBeVisible();
  await page.close();
});

test("after a reload the back link still steps back to the dancer's own list (review)", async ({
  page,
}) => {
  const list = homePath({ day: tomorrow(), t: "social" });
  await page.goto(list);
  await page.locator(CARD).first().click();
  await expect(page).toHaveURL(/\/e\//);
  await page.reload();
  await hydrated(page, "main nav a");
  await page.locator("main nav a").first().click();
  // The list with its filter, which only history holds: the href is /?day= alone.
  await expect(page).toHaveURL((url) => `${url.pathname}${url.search}` === list);
});

test("a card opened in a new tab from the list follows the href (review)", async ({
  context,
  page,
}) => {
  await page.goto(homePath({ day: tomorrow(), t: "social" }));
  const href = (await page.locator(CARD).first().getAttribute("href")) ?? "";
  // A long press and "Open in new tab": the new tab's referrer is our list, and nothing is behind.
  const [tab] = await Promise.all([
    context.waitForEvent("page"),
    page.evaluate((url) => void window.open(url, "_blank", "noopener"), href),
  ]);
  await tab.waitForURL(new RegExp(`${href}$`));
  await hydrated(tab, "main nav a");
  await tab.locator("main nav a").first().click();
  await expect(tab).toHaveURL((url) => url.pathname === "/" && url.search === `?day=${tomorrow()}`);
  // And again after the browser's back, when the tab's own list is ahead, not behind.
  await tab.goBack();
  await expect(tab).toHaveURL(new RegExp(`${href}$`));
  await hydrated(tab, "main nav a");
  await tab.locator("main nav a").first().click();
  await expect(tab).toHaveURL((url) => url.pathname === "/" && url.search === `?day=${tomorrow()}`);
});

test("a page reached from another site follows the href, even after our list (review)", async ({
  page,
  baseURL,
}) => {
  const href = await openTomorrowsFirst(page);
  // Another site, visited from our list in the same tab, links to the listing. Served by the test,
  // so no network is involved; its referrer reaches us as its bare origin, whose path is "/".
  const other = "http://other-site.example/";
  await page.route(other, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><a id="go" href="${new URL(href, baseURL).href}">Dance</a>`,
    }),
  );
  await page.goto(other);
  await page.click("#go");
  await expect(page).toHaveURL(new RegExp(`${href}$`));
  expect(await page.evaluate(() => document.referrer)).toBe(other);

  await hydrated(page, "main nav a");
  await page.locator("main nav a").first().click();
  await expect(page).toHaveURL(
    (url) =>
      url.origin === new URL(baseURL ?? "").origin &&
      url.pathname === "/" &&
      url.search === `?day=${tomorrow()}`,
  );
});

/**
 * A weekly listing's page on `from` + 7, found from `from`'s list (a night the picker offers):
 * the same series a week later, by its slug.
 */
async function aWeekAfter(page: Page, from: string): Promise<string | null> {
  const to = addCalendarDays(from, 7);
  await page.goto(homePath({ day: from }));
  const hrefs = await page
    .locator(CARD)
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  for (const href of hrefs.filter((h) => h.endsWith(`-${from}`))) {
    const candidate = `${href.slice(0, -from.length)}${to}`;
    if ((await page.request.get(candidate)).status() === 200) return candidate;
  }
  return null;
}

test("a night beyond the day picker goes back to that night, named by its date (D-075)", async ({
  page,
}) => {
  // Ten nights on: past the picker's seven, inside the twelve the home page opens, so the way
  // back names that night and the tap opens it.
  const tonight = currentNightDate(e2eNow(), NY);
  const later = addCalendarDays(tonight, 10);
  const detail = await aWeekAfter(page, addCalendarDays(tonight, 3));
  expect(detail, "a weekly listing ten nights from tonight").not.toBeNull();

  await page.goto(detail ?? "");
  const back = page.locator("main nav a").first();
  await expect(back).toHaveText(en.detail.back.day.replace("{day}", formatCalendarDate(later)));
  await expect(back).toHaveAttribute("href", `/?day=${later}`);
  await hydrated(page, "main nav a");
  await back.click();
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === `?day=${later}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    en.home.header.day.replace("{day}", formatCalendarDate(later)).replace("{place}", "New York"),
  );
});

test("a night the home page does not open goes back to tonight, and says so (review)", async ({
  page,
}) => {
  skipInEarlyHours();
  // Thirteen nights on, the ingest's last night, which may not be written yet: the home page
  // reads ?day= that far ahead as tonight, so the link must not name that night.
  const tonight = currentNightDate(e2eNow(), NY);
  const later = await aWeekAfter(page, addCalendarDays(tonight, 6));
  expect(later, "a weekly listing thirteen nights from tonight").not.toBeNull();

  await page.goto(later ?? "");
  const back = page.locator("main nav a").first();
  await expect(back).toHaveText(en.detail.back.tonight);
  await expect(back).toHaveAttribute("href", "/");
  await hydrated(page, "main nav a");
  await back.click();
  // The href, not a step back to the list this test opened first: this page was reached by its
  // address, so nothing of ours is behind it.
  await expect(page).toHaveURL((url) => url.pathname === "/" && url.search === "");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    en.home.header.tonight.split("{")[0] ?? "",
  );
});

test("a screen reader hears each source's checked time and its own value (review)", async ({
  page,
}) => {
  // Milonga Gallo Ciego, every Friday: its two sources give different end times.
  const tonight = currentNightDate(e2eNow(), NY);
  const friday = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => addCalendarDays(tonight, i))
    .find((date) => new Date(`${date}T12:00:00Z`).getUTCDay() === 5);
  const response = await page.goto(`/e/milonga-gallo-ciego-${friday ?? ""}`);
  expect(response?.status()).toBe(200);
  await expect(page.getByText(en.detail.sources.conflictNote)).toBeVisible();

  const sources = page
    .getByRole("heading", { name: en.detail.sources.heading, exact: true })
    .locator("xpath=following::ol[1]");
  const links = sources.getByRole("link");
  await expect(links).toHaveCount(2);
  // A link's aria-label is all a screen reader says of it, so each link holds only the source's
  // name, and that name is inside its label (WCAG 2.5.3).
  for (const link of await links.all()) {
    const shown = (await link.innerText()).trim();
    expect(shown).not.toMatch(/checked|Ends/);
    expect(await link.getAttribute("aria-label")).toContain(shown);
  }
  // The checked times and both end times are text of their own in the accessibility tree.
  const tree = await sources.ariaSnapshot();
  expect(tree.match(/^\s*- (?:text|paragraph): .*checked /gm) ?? []).toHaveLength(2);
  expect(tree.match(/^\s*- (?:text|paragraph): Ends /gm) ?? []).toHaveLength(2);
});

test("add to calendar is a plain link to a text/calendar file (C12)", async ({ page }) => {
  await openTomorrowsFirst(page);
  const add = page.getByRole("link", { name: en.detail.actions.addToCalendar });
  await expect(add).toBeVisible();
  await expect(add).not.toHaveAttribute("download");
  const href = (await add.getAttribute("href")) ?? "";
  expect(href).toMatch(/^\/e\/[^/]+\/calendar\.ics$/);

  const response = await page.request.get(href);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^text\/calendar/);
  const ics = await response.text();
  expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
  expect(ics).toContain("\r\nSUMMARY:");
  expect(ics).toContain(`URL:${new URL(page.url()).origin}/e/`);
});

test("closing the share sheet copies nothing (C12)", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shared: number; copied: string[] };
    w.shared = 0;
    w.copied = [];
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: () => {
        w.shared += 1;
        return Promise.reject(new DOMException("Share canceled", "AbortError"));
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => (w.copied.push(text), Promise.resolve()) },
    });
  });
  await openTomorrowsFirst(page);
  const share = page.getByRole("button", { name: en.detail.actions.share });
  await hydrated(page, "main nav button");
  await share.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { shared: number }).shared))
    .toBe(1);
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([]);
  await expect(share).toHaveText(en.detail.actions.share);
});

test("with no share sheet the link is copied, and the button says Share again (C12)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { copied: string[] };
    w.copied = [];
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (text: string) => (w.copied.push(text), Promise.resolve()) },
    });
  });
  // A fake clock, so the 3-second reset is stepped rather than waited for: on a loaded machine
  // the real timer fired too late for the assertion (2026-10-22).
  await page.clock.install();
  const href = await openTomorrowsFirst(page);
  await hydrated(page, "main nav button");
  const share = page.locator("main nav button");
  await share.click();
  await expect(share).toHaveText(en.detail.actions.linkCopied);
  expect(await page.evaluate(() => (window as unknown as { copied: string[] }).copied)).toEqual([
    `${new URL(page.url()).origin}${href}`,
  ]);
  await page.clock.fastForward(COPIED_RESET_MS);
  await expect(share).toHaveText(en.detail.actions.share);
});

test("a cancelled night sells nothing and says so beside its date (C1, C5)", async ({ page }) => {
  await page.goto(homePath());
  const cancelled = page.locator(`${CARD}[aria-label$=", cancelled"]`).first();
  await expect(cancelled, "tonight's seed has a cancelled night").toHaveCount(1);
  await cancelled.click();
  await expect(page).toHaveURL(/\/e\//);

  const header = page.locator("header").filter({ has: page.getByRole("heading", { level: 1 }) });
  // "Tonight · Mon, Sep 28 · Cancelled": the word beside the date, and no status line repeating it.
  const tonight = en.detail.date.tonight.replace(
    "{date}",
    formatCalendarDate(currentNightDate(e2eNow(), NY)),
  );
  // The venue line follows the date line in the header (D-147), so match the date line itself.
  await expect(
    header.getByText(en.detail.date.cancelled.replace("{day}", tonight), { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /Get tickets/ })).toHaveCount(0);
  await expect(page.getByText(/^Tickets at /)).toHaveCount(0);
  // Directions steps down to the secondary button: ink in a hairline edge, not the ink fill.
  const directions = page.locator("summary", { hasText: en.detail.actions.getDirections });
  await expect(directions).toHaveClass(/chip-edge/);
  await expect(directions).not.toHaveClass(/bg-ink/);
});

test("the When rail holds 12:30am without touching its label (C6)", async ({ page }) => {
  await openTomorrowsFirst(page);
  const whenList = page
    .getByRole("heading", { name: en.detail.when.heading, exact: true })
    .locator("xpath=following::ol[1]");
  const stamp = whenList.locator(".type-stamp-sm").first();
  await expect(stamp).toBeVisible();
  // Only once React has hydrated the page: text changed under it before then is a hydration
  // mismatch, and React replaces the whole tree, stamp included, between the two measurements.
  await hydrated(page, "main nav a");
  for (const widest of ["12:30am", "10:30pm"]) {
    const gap = await stamp.evaluate((element, text) => {
      element.textContent = text;
      const row = element.closest("div");
      const label = row?.lastElementChild;
      if (!row || !label) return -1;
      return label.getBoundingClientRect().left - element.getBoundingClientRect().right;
    }, widest);
    // The grid's 12px gap, whole: the stamp stays inside its column.
    expect(gap, widest).toBeGreaterThanOrEqual(11.5);
  }
});

test("no link on an event page ends in a 404 (C3)", async ({ page }) => {
  await openTomorrowsFirst(page);
  await expect(page.getByRole("link", { name: en.detail.actions.reportProblem })).toHaveCount(0);
  await expect(page.getByRole("link", { name: en.detail.actions.suggestCorrection })).toHaveCount(
    0,
  );
  const hrefs = await page
    .locator('a[href^="/"]')
    .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  expect(hrefs.length).toBeGreaterThan(1);
  for (const href of new Set(hrefs)) {
    const response = await page.request.get(href);
    expect(response.status(), href).toBeLessThan(400);
  }
});

test("an address we do not have is our own page, with a way back (C3)", async ({ page }) => {
  const response = await page.goto("/report?listing=anything");
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.errors.notFound);
  await expect(page).toHaveTitle(`${en.errors.notFound} · ${en.common.siteName}`);
  const home = page.getByRole("link", { name: en.errors.goHome });
  await expect(home).toHaveAttribute("href", "/");
  // The paper, not the framework's grey page: the body carries the design's own background.
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(251, 250, 247)");
});

test("a listing we do not have is on the page before any script runs (review)", async ({
  browser,
}) => {
  // Without JavaScript: what a slow phone shows before the bundle arrives, and what a crawler or
  // a link preview reads. Next's notFound() here was an empty shell titled "DanceTonight".
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const response = await page.goto("/e/no-such-listing-2026-09-28");
  // A real 404 since D-092, with the whole page in the HTML (proxy.ts).
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.errors.listingNotFound);
  await expect(page).toHaveTitle(`${en.errors.listingNotFound} · ${en.common.siteName}`);
  await expect(page.getByRole("link", { name: en.errors.goHome })).toHaveAttribute("href", "/");
  // Kept out of search results, as a 404 would be, and set on our own paper.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(background).toBe("rgb(251, 250, 247)");
  await context.close();
});

test("a merged listing's old address takes the dancer to the listing that stands (D-092)", async ({
  page,
}) => {
  // The seed's one night listed twice: `listed-twice-<tonight>`, merged into tonight's first
  // timed listing.
  const old = `/e/listed-twice-${currentNightDate(e2eNow(), NY)}`;
  const first = await page.request.get(old, { maxRedirects: 0 });
  expect(first.status()).toBe(307);
  const target = first.headers()["location"] ?? "";
  expect(target).toMatch(/^\/e\/[^/]+$/);

  const response = await page.goto(old);
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe(target);
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(en.errors.listingNotFound);

  // Its calendar file follows it too, and a gone listing's file is a 404.
  const ics = await page.request.get(`${old}/calendar.ics`, { maxRedirects: 0 });
  expect(ics.status()).toBe(307);
  expect(ics.headers()["location"]).toBe(`${target}/calendar.ics`);
  expect((await page.request.get("/e/no-such-listing/calendar.ics")).status()).toBe(404);
});

test("/bot says who the crawler is and the rules it keeps (C3)", async ({ page }) => {
  const response = await page.goto("/bot");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(en.bot.title);
  await expect(page).toHaveTitle(`${en.bot.title} · ${en.common.siteName}`);
  // The interval through the plural leaf, counted from CRAWL_INTERVAL_MS (review, 2026-09-28).
  await expect(page.getByText(en.bot.how.other.replace("{count}", "5"))).toBeVisible();
  await expect(page.getByText(en.bot.optOut)).toBeVisible();
  // The User-Agent it sends links back to this very page.
  const origin = new URL(page.url()).origin;
  await expect(page.getByText(`DanceTonightBot/1.0 (+${origin}/bot`)).toBeVisible();
});

test("the site has an icon, in every size a phone or a browser asks for (C14)", async ({
  page,
}) => {
  await page.goto(homePath());
  const favicon = await page.request.get("/favicon.ico");
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toMatch(/icon/);

  const svg = page.locator('head link[rel="icon"][type="image/svg+xml"]');
  await expect(svg).toHaveCount(1);
  const svgResponse = await page.request.get((await svg.getAttribute("href")) ?? "");
  expect(svgResponse.headers()["content-type"]).toMatch(/^image\/svg\+xml/);

  const apple = page.locator('head link[rel="apple-touch-icon"]');
  await expect(apple).toHaveCount(1);
  const appleResponse = await page.request.get((await apple.getAttribute("href")) ?? "");
  expect(appleResponse.headers()["content-type"]).toBe("image/png");
});
