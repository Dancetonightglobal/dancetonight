// The map, as the owner found it on his iPhone on 2026-09-28 and as D-068 settled it: "the map only
// turns on when clicked, which is a problem, and for some reason you can't click on the buttons in
// the map". Each test here names the settled point it proves (M1 to M13 of the fix contract) and
// fails on the code before that point was fixed.
//
// Tiles never leave the machine: map-helpers.ts answers every style and tile request.

import { expect, test, type Locator, type Page } from "@playwright/test";

import { currentNightDate, pickerLength } from "@/src/domain/tonight";
import { en, t } from "@/src/i18n";

import {
  CLUSTER,
  FAR_AWAY,
  MARKER,
  PIN,
  REACHABLE_CARD,
  TILED_STYLE,
  TOGGLE,
  homePath,
  interceptMapChunk,
  numbersIn,
  stubTiles,
  tileZoom,
} from "./map-helpers";
import { e2eNow, skipInEarlyHours } from "./early-hours";

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("expected the element to be laid out");
  return box;
}

function overlaps(a: Box, b: Box, tolerance = 0.5): boolean {
  return !(
    a.x + a.width <= b.x + tolerance ||
    b.x + b.width <= a.x + tolerance ||
    a.y + a.height <= b.y + tolerance ||
    b.y + b.height <= a.y + tolerance
  );
}

/** The map's own section, named "Map with N places" (a11y.mapWithCount). */
function mapSection(page: Page): Locator {
  return page.locator('section[aria-label^="Map"]').first();
}

/** Wait until React owns the page, so a tap is handled in place rather than as a navigation. */
async function hydrated(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
}

/** A detail page's path, taken from the first card on tonight's list. */
async function firstDetailPath(page: Page): Promise<string> {
  await page.goto(homePath());
  const href = await page.locator('a[href^="/e/"]').first().getAttribute("href");
  if (href === null) throw new Error("tonight's list has no card");
  return href;
}

/** Every night in the day picker, as its `day` parameter. */
async function pickerDays(page: Page): Promise<string[]> {
  await page.goto(homePath());
  const days = await page
    .locator('a[href*="day="]')
    .evaluateAll((links) => [
      ...new Set(
        links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("day")),
      ),
    ]);
  const nights = days.filter((day): day is string => day !== null);
  // The whole week the picker offers (D-075): a shorter picker would leave nights unchecked.
  expect(nights).toHaveLength(pickerLength(currentNightDate(e2eNow(), "America/New_York")));
  return nights;
}

/** Each pair of markers whose drawn targets overlap, as the tap would find them. */
async function overlappingMarkers(page: Page, where: string): Promise<string[]> {
  const drawn = await page.locator(MARKER).evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect();
      return {
        name: el.getAttribute("aria-label") ?? "",
        box: { x: box.x, y: box.y, width: box.width, height: box.height },
      };
    }),
  );
  const found: string[] = [];
  for (const [i, a] of drawn.entries()) {
    for (const b of drawn.slice(i + 1)) {
      if (overlaps(a.box, b.box)) found.push(`${where}: "${a.name}" and "${b.name}"`);
    }
  }
  return found;
}

// --- M1: a pin tap shows its card ----------------------------------------------------------------

test("M1: tapping a pin shows its card above the toggle, links working, pin still in view", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  await hydrated(page);
  const pin = page.locator(PIN).first();
  await expect(pin).toBeVisible();
  // The pin's title attribute is the night's title; its name leads with the time it prints (D-170).
  const title = (await pin.getAttribute("title")) ?? "";

  // A finger, as the owner's iPhone: a tap sends touch events, which MapLibre also listens to,
  // where a click would send only the mouse's (review, 2026-09-28).
  await pin.tap();

  // The card the list would draw, the only card a dancer can reach while the map is up.
  const card = page.locator(REACHABLE_CARD);
  await expect(card).toHaveCount(1);
  await expect(card).toBeVisible();
  expect(await card.getAttribute("aria-label")).toContain(title);

  // Above the List/Map bar, and the picked pin is not under it.
  const cardBox = await boxOf(card);
  const toggleBox = await boxOf(page.locator(TOGGLE));
  expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(toggleBox.y + 0.5);
  const picked = page.locator(`${MARKER}[aria-label$=", selected"]`);
  await expect(picked).toBeVisible();
  const pickedBox = await boxOf(picked);
  const mapBox = await boxOf(page.locator(".maplibregl-canvas"));
  expect(pickedBox.y).toBeGreaterThanOrEqual(mapBox.y - 0.5);
  expect(pickedBox.y + pickedBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height + 0.5);

  // Its link works.
  const href = (await card.getAttribute("href")) ?? "";
  await card.tap();
  await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`));
});

// --- M2: the map pane ends above the bar ----------------------------------------------------------

test("M2: the phone map ends above the toggle, and its credits open from its corner", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible();
  const creditsButton = page.getByRole("button", { name: en.map.credits });
  await expect(creditsButton).toBeVisible();
  const buttonBox = await boxOf(creditsButton);
  const toggleBox = await boxOf(page.locator(TOGGLE));
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(toggleBox.y + 0.5);

  await creditsButton.click();
  const creditText = page.getByText(en.footer.attribution, { exact: true });
  await expect(creditText).toBeVisible();
  const closeButton = page.getByRole("button", { name: en.map.closeCredits });
  await expect(closeButton).toBeVisible();

  await closeButton.click();
  await expect(creditText).toBeHidden();
});

// --- M3: clusters print their count and always open --------------------------------------------

/** The venues a cluster's label names, after the count. */
const venuesIn = (label: string) => {
  const stripped = label.replace(/^\d+ places?(, |$)/, "");
  return stripped === "" ? [] : stripped.split(/, and |, | and /);
};

test("M3: a cluster prints how many places it holds, and one at a single spot opens into its pins", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto(homePath());
  const days = await page
    .locator('a[href*="day="]')
    .evaluateAll((links) => [
      ...new Set(
        links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get("day")),
      ),
    ]);
  expect(days.length).toBeGreaterThan(0);

  // A night with a cluster holding more places than it names venues: two nights at one spot.
  let members: number[] = [];
  let found = "";
  for (const day of days) {
    await page.goto(homePath({ day: day ?? "", view: "map" }));
    await expect(page.locator(MARKER).first()).toBeVisible();
    for (const el of await page.locator(CLUSTER).elementHandles()) {
      const label = (await el.getAttribute("aria-label")) ?? "";
      const dataNumbers = (await el.getAttribute("data-numbers")) ?? "";
      const numbers = numbersIn(dataNumbers);
      const venues = venuesIn(label);
      if (numbers.length > venues.length) {
        members = numbers;
        found = dataNumbers;
        break;
      }
    }
    if (members.length > 0) break;
  }
  expect(members.length, "some night this week has two places at one spot").toBeGreaterThan(1);
  await hydrated(page);

  // It prints how many places it holds (pins print a start time, so a bare number on the map is
  // only ever a count; owner, 2026-10-17), on a paper sticker with a 2px spot edge.
  const cluster = page.locator(`${MARKER}[data-numbers="${found}"]`);
  const printed = (await cluster.innerText()).trim();
  expect(printed).toBe(String(members.length));
  const edge = await cluster
    .locator("span")
    .evaluate((circle) => getComputedStyle(circle).borderTopWidth);
  expect(edge).toBe("2px");

  // Tapping opens it: it zooms while zooming can pull its places apart. Once a cluster of the
  // members stands at one spot, tapping it selects its first place and lays that spot's places
  // out side by side (D-068). A cluster can hold two such spots; only one opens at a time, so
  // the test follows the first spot it reaches.
  for (let tap = 0; tap < 6; tap += 1) {
    const elements = await page.locator(CLUSTER).elementHandles();
    const holding: Array<{ label: string; dataNumbers: string }> = [];
    for (const el of elements) {
      const label = (await el.getAttribute("aria-label")) ?? "";
      const dataNumbers = (await el.getAttribute("data-numbers")) ?? "";
      if (numbersIn(dataNumbers).some((number) => members.includes(number))) {
        holding.push({ label, dataNumbers });
      }
    }
    if (holding.length === 0) break;
    const spot = holding.find(
      (item) => venuesIn(item.label).length === 1 && numbersIn(item.dataNumbers).length > 1,
    );
    const target = spot ?? holding[0]!;
    if (spot !== undefined) members = numbersIn(spot.dataNumbers);
    await page.locator(`${MARKER}[data-numbers="${target.dataNumbers}"]`).tap();
    await page.waitForTimeout(700);
    if (spot !== undefined) break;
  }
  await expect(page.locator(`${MARKER}[aria-label$=", selected"]`)).toHaveCount(1);
  const boxes: Box[] = [];
  for (const number of members) {
    const own = page.locator(`${PIN}[data-numbers="${number}"]`);
    await expect(own, `place ${number} has its own pin`).toBeVisible();
    boxes.push(await boxOf(own));
  }
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      expect(overlaps(boxes[i]!, boxes[j]!), `pins ${members[i]} and ${members[j]} overlap`).toBe(
        false,
      );
    }
  }
});

// --- M4: the strip across the top of the phone map -------------------------------------------------

test("M4: the phone map says which night and how many places, and leads back to the list", async ({
  page,
}) => {
  skipInEarlyHours();
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible();
  await hydrated(page);

  const dataNumbers = await page
    .locator(MARKER)
    .evaluateAll((els) => els.map((el) => el.getAttribute("data-numbers") ?? ""));
  const count = Math.max(...dataNumbers.flatMap(numbersIn));
  const strip = page.getByRole("link", {
    name: new RegExp(
      `^${t("home.header.tonight", { place: "New York" })} · ${t("map.strip.places", { count })}`,
    ),
  });
  await expect(strip).toBeVisible();
  const stripBox = await boxOf(strip);
  expect(stripBox.y).toBeLessThan(1);

  await strip.click();
  await expect(page).not.toHaveURL(/[?&]view=map\b/);
  await expect(page.locator(REACHABLE_CARD).first()).toBeVisible();
  await expect(strip).toBeHidden();
});

// --- M5: links built on the server do not carry view ---------------------------------------------

test("M5: a day or filter link opened from the map opens on the list", async ({ page }) => {
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  const hrefs = await page
    .locator('a[href^="/?"]')
    .evaluateAll((links) =>
      links
        .filter((link) => link.closest('[role="group"][aria-label="List or map"]') === null)
        .map((link) => link.getAttribute("href") ?? ""),
    );
  expect(hrefs.length).toBeGreaterThan(3);
  for (const href of hrefs) expect(href, href).not.toMatch(/[?&]view=/);
});

// --- M6: the toggle works before hydration ---------------------------------------------------------

test("M6: a tap on Map before the page has hydrated still opens the map", async ({ page }) => {
  await stubTiles(page);
  // Hold the JavaScript back, as a slow phone does: the bar is on screen before React is.
  await page.route(/_next\/static\/chunks\/.*\.js/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    await route.continue();
  });
  await page.goto(homePath(), { waitUntil: "domcontentloaded" });
  const toMap = page.locator(TOGGLE).getByRole("link", { name: en.home.view.map, exact: true });
  await toMap.click();
  await expect(page).toHaveURL(/[?&]view=map\b/);
  await expect(mapSection(page)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.locator(TOGGLE).getByRole("link", { name: en.home.view.map, exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

// --- M7: the map stays built and the list keeps its place -----------------------------------------

test("M7: Map then List keeps the list where it was, and the map is not rebuilt", async ({
  page,
}) => {
  // Last night's list, opened in the early hours (D-518), can be too short to scroll 900px.
  skipInEarlyHours();
  await stubTiles(page);
  await page.goto(homePath());
  await expect(page.locator(REACHABLE_CARD).first()).toBeVisible();
  await hydrated(page);
  await page.evaluate(() => window.scrollTo(0, 900));
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);

  const bar = page.locator(TOGGLE);
  await bar.getByRole("link", { name: en.home.view.map, exact: true }).click();
  await expect(page.locator(MARKER).first()).toBeVisible();
  await page.locator(".maplibregl-canvas").evaluate((canvas) => {
    canvas.setAttribute("data-first-build", "yes");
  });

  await bar.getByRole("link", { name: en.home.view.list, exact: true }).click();
  await expect(page.locator(REACHABLE_CARD).first()).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - before)).toBeLessThanOrEqual(2);

  await bar.getByRole("link", { name: en.home.view.map, exact: true }).click();
  await expect(page.locator('.maplibregl-canvas[data-first-build="yes"]')).toBeVisible();
});

// --- M8: a faster first draw -----------------------------------------------------------------------

test("M8: the pins are drawn before the tiles arrive, under a visible loading line", async ({
  page,
}) => {
  await stubTiles(page, { style: TILED_STYLE, tiles: "hang" });
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(en.map.loading, { exact: true })).toBeVisible();
});

test("M8: while the map is on its way, the sheet says so", async ({ page }) => {
  await stubTiles(page, { styleDelayMs: 2_500 });
  await page.goto(homePath({ view: "map" }));
  await expect(page.getByText(en.map.loading, { exact: true })).toBeVisible();
  await expect(page.locator(MARKER).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(en.map.loading, { exact: true })).toHaveCount(0);
});

test("M8: the map opens framed on its pins, so no tile is fetched for a view it leaves", async ({
  page,
}) => {
  const tileLog: string[] = [];
  await stubTiles(page, { style: TILED_STYLE, tileLog });
  const path = await firstDetailPath(page);
  await page.goto(path);
  await page
    .getByRole("heading", { name: en.detail.where.heading, exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.locator(MARKER).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(en.map.loading, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  // One venue fits at the closest framing (zoom 15), which this source serves from zoom 14.
  expect(tileLog.length).toBeGreaterThan(0);
  expect([...new Set(tileLog.map(tileZoom))]).toEqual([14]);
});

test("M8: a phone on the list fetches the map's code while idle", async ({ page }) => {
  const mapChunk = page.waitForResponse(
    async (response) =>
      /\/_next\/static\/chunks\/.*\.js/.test(response.url()) &&
      (await response.text()).includes("maplibregl-canvas"),
    { timeout: 15_000 },
  );
  await page.goto(homePath());
  await expect(page.locator(REACHABLE_CARD).first()).toBeVisible();
  await mapChunk;
  // Nothing was drawn: the list is still the screen.
  await expect(page.locator(".maplibregl-canvas")).toHaveCount(0);
});

// --- M9: no places, and a map that failed ---------------------------------------------------------

test("M9: with no places the map opens on the search centre at a city's width, and says so", async ({
  page,
}) => {
  const tileLog: string[] = [];
  await stubTiles(page, { style: TILED_STYLE, tileLog });
  await page.goto(homePath({ view: "map" }, FAR_AWAY));
  // No filter is set, so none is blamed (review, 2026-09-28).
  await expect(page.getByText(en.map.noPlaces, { exact: true })).toBeVisible();
  await expect(page.getByText(en.map.noMatch, { exact: true })).toHaveCount(0);
  await expect(page.getByText(en.map.loading, { exact: true })).toHaveCount(0, { timeout: 15_000 });
  expect(tileLog.length).toBeGreaterThan(0);
  expect([...new Set(tileLog.map(tileZoom))]).toEqual([11]);
});

test("M9: a map the filters emptied says the filters are why", async ({ page }) => {
  await stubTiles(page);
  // Switches no night in the seed meets all at once.
  await page.goto(
    homePath({
      view: "map",
      f: "kpop",
      price: "free",
      lvl: "1",
      lesson: "1",
      live: "1",
      conf: "1",
    }),
  );
  await expect(page.getByText(en.map.noMatch, { exact: true })).toBeVisible();
  // The list under the map agrees: the night has places, and the filters hide them.
  await expect(
    page.getByRole("link", { name: en.home.filters.clear, exact: true, includeHidden: true }),
  ).toHaveCount(1);
});

test("M9: a map that failed to load offers to load it again, and does", async ({ page }) => {
  let networkDown = true;
  await stubTiles(page, { failStylesWhile: () => networkDown });
  await page.goto(homePath({ view: "map" }));
  await expect(page.getByText(en.map.failed, { exact: true })).toBeVisible();
  networkDown = false;
  await page.getByRole("button", { name: en.map.retry, exact: true }).click();
  await expect(page.locator(MARKER).first()).toBeVisible();
  await expect(page.getByText(en.map.failed, { exact: true })).toHaveCount(0);
});

// --- M10: Show all ---------------------------------------------------------------------------------

test("M10: Show all appears once a pin is out of view, and brings every pin back", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible();
  await hydrated(page);
  const showAll = page.getByRole("button", { name: en.map.showAll, exact: true });
  await expect(showAll).toHaveCount(0);

  // Pan the map 500px with the keyboard, one 100px step at a time, each allowed to finish.
  await page.locator(".maplibregl-canvas").focus();
  for (let step = 0; step < 5; step += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
  }
  await expect(showAll).toBeVisible();
  // It stays until it is used: the view does not drift back on its own.
  await page.waitForTimeout(800);
  await expect(showAll).toBeVisible();

  await showAll.click();
  await expect(showAll).toHaveCount(0);
  const canvasBox = await boxOf(page.locator(".maplibregl-canvas"));
  for (const marker of await page.locator(MARKER).all()) {
    const box = await boxOf(marker);
    expect(box.x + box.width / 2).toBeGreaterThanOrEqual(canvasBox.x);
    expect(box.x + box.width / 2).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
  }
});

test("the minute refresh keeps the view the dancer panned to, a pin selected or not", async ({
  page,
}) => {
  // Tonight's page asks the server for a fresh render on each minute boundary (MinuteTick), which
  // hands the map a new list of the same pins. The map used to take that for a new list and frame
  // every pin again, so once a minute a pan or a zoom snapped back. Found as an intermittent M10
  // failure: a minute boundary between the pan and the check hid "Show all". Then, with a pin
  // selected, the same refresh eased the map back to that pin (review, 2026-09-28), so the dancer
  // here picks a pin first and pans it off the map.
  // The page's clock reads 46 seconds past the minute, so the refresh comes 14 seconds in; timers
  // and the map's own animation clock run as usual.
  const now = new Date();
  now.setSeconds(46, 0);
  await page.clock.setFixedTime(now);
  await stubTiles(page);
  let refreshed = false;
  const refresh = page.waitForRequest(
    (request) => {
      const headers = request.headers();
      if (headers["rsc"] !== "1" || headers["next-router-prefetch"] !== undefined) return false;
      refreshed = true;
      return true;
    },
    { timeout: 30_000 },
  );
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible();
  await hydrated(page);
  const showAll = page.getByRole("button", { name: en.map.showAll, exact: true });

  await page.locator(PIN).first().tap();
  const picked = page.locator(`${MARKER}[aria-label$=", selected"]`);
  await expect(picked).toHaveCount(1);
  await expect(page.locator(REACHABLE_CARD)).toHaveCount(1);
  await page.waitForTimeout(600);

  await page.locator(".maplibregl-canvas").focus();
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(400);
  }
  await expect(showAll).toBeVisible();
  const before = await boxOf(picked);
  const canvasBox = await boxOf(page.locator(".maplibregl-canvas"));
  expect(before.x + before.width, "the picked pin was panned off the map").toBeLessThan(
    canvasBox.x,
  );
  expect(refreshed, "the refresh came after the pan, so it is what is tested").toBe(false);

  await refresh;
  await page.waitForTimeout(1_500);
  await expect(picked, "the pin is still the one selected").toHaveCount(1);
  await expect(showAll, "the pan survives the refresh").toBeVisible();
  const after = await boxOf(picked);
  expect(Math.abs(after.x - before.x), "the pins did not move").toBeLessThanOrEqual(1);
});

// --- M11: pins say what they are, and their halo is round ------------------------------------------

test("M11: a pin is named by its time and night, with a ring for a halo", async ({ page }) => {
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  const pin = page.locator(PIN).first();
  await expect(pin).toBeVisible();
  await expect(pin).toHaveAttribute("aria-label", /^\d{1,2}(:\d{2})?(am|pm), \S/);
  const halo = await pin.locator("span").evaluate((circle) => {
    const style = getComputedStyle(circle);
    return { outline: style.outlineStyle, shadow: style.boxShadow };
  });
  expect(halo.outline).toBe("none");
  expect(halo.shadow).not.toBe("none");
});

// --- M12: the split view: numbers in the rail, the picked card lit ---------------------------------

test.describe("the split view", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("M12: cards keep their pin numbers as data; a pin lights its card, a card lights its pin", async ({
    page,
  }) => {
    await stubTiles(page);
    await page.goto(homePath());
    await expect(page.locator(MARKER).first()).toBeVisible();
    await hydrated(page);

    // The card prints no number: pins print the start time (owner, 2026-10-17).
    const numbered = page.locator("[data-pin-number]");
    await expect(numbered.first()).toHaveAttribute("data-pin-number", "1");
    const printed = await numbered.first().evaluate((wrapper) => {
      const stamp = wrapper.querySelector(":scope > a:first-child > :first-child");
      if (stamp === null) return "none";
      const after = getComputedStyle(stamp, "::after").content;
      return after === "none" ? getComputedStyle(stamp, "::before").content : after;
    });
    expect(["none", "normal", '""']).toContain(printed);

    // A pin picked on the map lights its card and brings it into view.
    const pin = page.locator(PIN).last();
    const number = numbersIn((await pin.getAttribute("data-numbers")) ?? "")[0];
    await pin.click();
    const card = page.locator(`[data-pin-number="${number}"]`);
    await expect(card).toHaveAttribute("aria-current", "true");
    await expect(card).toBeInViewport();
    const lit = await card.evaluate((element) => getComputedStyle(element).backgroundColor);
    expect(lit).not.toBe("rgba(0, 0, 0, 0)");

    // A card under the pointer lights its pin.
    await page.locator('[data-pin-number="1"]').hover();
    await expect(
      page.locator(`${MARKER}[data-numbers="1"][aria-label$=", selected"]`),
    ).toBeVisible();
  });
});

// --- M13: the detail page's map -------------------------------------------------------------------

test("M13: the map in WHERE loads by itself, with the whole sheet, one finger scrolling the page", async ({
  page,
}) => {
  await stubTiles(page);
  const path = await firstDetailPath(page);
  await page.goto(path);
  await page
    .getByRole("heading", { name: en.detail.where.heading, exact: true })
    .scrollIntoViewIfNeeded();

  // No tap: it is there once WHERE is near the screen.
  const map = page.locator(`section[aria-label="${t("a11y.mapWithCount", { count: 1 })}"]`);
  await expect(map).toBeVisible();
  const canvas = map.locator(".maplibregl-canvas");
  await expect(canvas).toBeVisible();
  const canvasBox = await boxOf(canvas);
  expect(canvasBox.height).toBeGreaterThanOrEqual(170);
  // The credit button sits in the map's corner, drawn from first paint (DetailMap).
  const creditsButton = page.getByRole("button", { name: en.map.credits });
  await expect(creditsButton).toBeVisible();
  const buttonBox = await boxOf(creditsButton);
  expect(buttonBox.x).toBeGreaterThanOrEqual(canvasBox.x);
  expect(buttonBox.x + buttonBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width);
  expect(buttonBox.y).toBeGreaterThanOrEqual(canvasBox.y);
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height);

  // One finger scrolls the page, and the map stays where it is; two move the map. A real
  // one-finger drag up over the canvas, through the browser's touch input, not a check that
  // MapLibre was given the option (review, 2026-09-28).
  const pin = map.locator(MARKER);
  await expect(pin).toBeVisible();
  const where = async () => {
    const [pinBox, mapBox] = [await boxOf(pin), await boxOf(canvas)];
    return { x: pinBox.x - mapBox.x, y: pinBox.y - mapBox.y };
  };
  const pinBefore = await where();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  const cdp = await page.context().newCDPSession(page);
  const x = canvasBox.x + canvasBox.width / 4;
  const from = canvasBox.y + canvasBox.height * 0.8;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: from }] });
  for (let step = 1; step <= 10; step += 1) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: from - step * 12 }],
    });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.scrollY), "the page scrolled").toBeGreaterThan(
    scrollBefore + 40,
  );
  const pinAfter = await where();
  expect(Math.abs(pinAfter.x - pinBefore.x), "the map did not move").toBeLessThanOrEqual(1);
  expect(Math.abs(pinAfter.y - pinBefore.y), "the map did not move").toBeLessThanOrEqual(1);

  // The venue's pin is the spot sticker, not the ink of a selection.
  await expect(pin).toHaveAttribute("data-numbers", "1");
  await expect(pin).not.toHaveAttribute("aria-label", /, selected$/);
  const fill = await pin
    .locator("span")
    .evaluate((circle) => getComputedStyle(circle).backgroundColor);
  expect(fill).toBe("rgb(185, 56, 21)");
});

// --- The review of 2026-09-28 ----------------------------------------------------------------------

test("while the phone map is up, every Tab stop is on the map or its bar, and not under the map", async ({
  page,
}) => {
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(MARKER).first()).toBeVisible();
  await hydrated(page);
  // The list under the map is scrolled just past the now rule, so its sticky strip, with Back to
  // now, is showing under the map as well as the list's skip links (they were in the tab order).
  // Late in the evening the list below the rule is shorter than the screen, so the page is given
  // room below it first: where the rule sits depends on the time the test runs.
  await page.evaluate(() => {
    const rule = document.getElementById("now-rule");
    if (rule === null) return;
    document.body.style.paddingBottom = `${window.innerHeight}px`;
    window.scrollTo(0, rule.getBoundingClientRect().bottom + window.scrollY + 8);
  });
  await expect(page.locator('a[href="#now-rule"]')).toHaveCount(1);

  const stops: { name: string; where: string; onTop: boolean }[] = [];
  for (let step = 0; step < 60; step += 1) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      // Past the page's last stop: the browser's own chrome, or under `next dev` its tools button.
      if (active === null || active === document.body || active.tagName === "NEXTJS-PORTAL") {
        return null;
      }
      const pane = document.querySelector('section[aria-label^="Map"]')?.closest(".fixed");
      const bar = document.querySelector('[role="group"][aria-label="List or map"]');
      const box = active.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      const map = active.closest(".maplibregl-map");
      const onTop =
        hit !== null &&
        (active.contains(hit) ||
          // The canvas is the map, pins and all: a pin over its centre is still the map.
          (active.classList.contains("maplibregl-canvas") && map !== null && map.contains(hit)));
      return {
        name: active.getAttribute("aria-label") ?? active.textContent?.trim() ?? active.tagName,
        where: pane?.contains(active) ? "map" : bar?.contains(active) ? "bar" : "elsewhere",
        onTop,
      };
    });
    if (stop === null) break;
    if (stops.some((seen) => seen.name === stop.name && seen.where === stop.where)) break;
    stops.push(stop);
  }

  expect(stops.length).toBeGreaterThan(3);
  expect(
    stops.filter((stop) => /^\d{1,2}(:\d{2})?(am|pm), /.test(stop.name)).length,
    "the pins",
  ).toBeGreaterThan(0);
  for (const stop of stops) {
    expect(stop.where, `${stop.name} is on the map or its bar`).not.toBe("elsewhere");
    expect(stop.onTop, `${stop.name} can be seen where it is focused`).toBe(true);
  }
});

test("a map whose code does not arrive says so, the list still works, and it loads again", async ({
  page,
}) => {
  // A dropped connection, or a page left open across a deploy: the map's chunk fails. It used to
  // take the whole page down to "This page couldn't load" (review, 2026-09-28).
  let down = true;
  await interceptMapChunk(page, { failWhile: () => down });
  await stubTiles(page);
  // Tomorrow's bill, which no listing leaves as the clock moves: tonight's shrinks as its
  // listings end, to three cards in the small hours, so its count is not a fixed thing to compare.
  await page.goto(homePath());
  const tomorrow = await page
    .getByRole("navigation", { name: en.home.day.label })
    .locator("a")
    .nth(1)
    .getAttribute("href");
  await page.goto(tomorrow ?? homePath());
  await expect(page.locator(REACHABLE_CARD).first()).toBeVisible();
  const listed = await page.locator(REACHABLE_CARD).count();
  await hydrated(page);

  const bar = page.locator(TOGGLE);
  await bar.getByRole("link", { name: en.home.view.map, exact: true }).click();
  await expect(page.getByText(en.map.failed, { exact: true })).toBeVisible();

  // From the keyboard: under `next dev` the failure is logged, and the dev tools' issue badge
  // sits over the List half of the bar. The whole list comes back, not a part of it.
  await bar.getByRole("link", { name: en.home.view.list, exact: true }).press("Enter");
  await expect(page.locator(REACHABLE_CARD)).toHaveCount(listed);
  expect(listed).toBeGreaterThan(3);

  down = false;
  await bar.getByRole("link", { name: en.home.view.map, exact: true }).click();
  await page.getByRole("button", { name: en.map.retry, exact: true }).click();
  await expect(page.locator(MARKER).first()).toBeVisible();
  await expect(page.getByText(en.map.failed, { exact: true })).toHaveCount(0);
});

test("an event page whose map code does not arrive still shows the event, and offers the map again", async ({
  page,
}) => {
  let down = true;
  await interceptMapChunk(page, { failWhile: () => down });
  await stubTiles(page);
  const path = await firstDetailPath(page);
  await page.goto(path);
  const where = page.getByRole("heading", { name: en.detail.where.heading, exact: true });
  await where.scrollIntoViewIfNeeded();
  await expect(page.getByText(en.map.failed, { exact: true })).toBeVisible();
  await expect(where).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText(/couldn.t load/i);

  down = false;
  await page.getByRole("button", { name: en.map.retry, exact: true }).click();
  await expect(page.locator(MARKER)).toBeVisible();
});

test("nothing below WHERE moves when the event page's map arrives", async ({ page }) => {
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await interceptMapChunk(page, { holdUntil: released });
  await stubTiles(page);
  const path = await firstDetailPath(page);
  await page.goto(path);
  await page
    .getByRole("heading", { name: en.detail.where.heading, exact: true })
    .scrollIntoViewIfNeeded();
  // Where each section head sits in the page, not on the screen, so scrolling cannot hide a move.
  const heads = () =>
    page
      .locator("h2")
      .evaluateAll((all) => all.map((h) => Math.round(h.getBoundingClientRect().top + scrollY)));
  await expect(page.getByText(en.map.loading, { exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  const before = await heads();

  release();
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();
  await expect(page.locator(MARKER)).toBeVisible();
  expect(await heads()).toEqual(before);
});

test("Enter on a pin selects it and the focus stays on it; on a cluster it follows its places", async ({
  page,
}) => {
  // Choosing a pin redraws every marker. The one that had focus went with them, and focus fell
  // to the page, so the next Tab began again at pin 1 (review, 2026-09-28).
  await stubTiles(page);
  await page.goto(homePath({ view: "map" }));
  await expect(page.locator(PIN).first()).toBeVisible();
  await hydrated(page);
  const focused = page.locator(":focus");
  const labels = () =>
    page.locator(MARKER).evaluateAll((els) =>
      els.map((el) => ({
        ariaLabel: el.getAttribute("aria-label") ?? "",
        dataNumbers: el.getAttribute("data-numbers") ?? "",
      })),
    );

  const pin = page.locator(PIN).nth(1);
  const name = (await pin.getAttribute("aria-label")) ?? "";
  await pin.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(`${MARKER}[aria-label$=", selected"]`)).toHaveCount(1);
  await expect(focused).toHaveAttribute("aria-label", `${name}, selected`);

  // The next Tab goes on to the marker after it.
  const drawn = await labels();
  const currentIndex = drawn.findIndex((item) => item.ariaLabel === `${name}, selected`);
  const next = drawn[currentIndex + 1];
  await page.keyboard.press("Tab");
  if (next === undefined) await expect(focused).not.toHaveClass(/maplibregl-marker/);
  else await expect(focused).toHaveAttribute("aria-label", next?.ariaLabel ?? "");

  // A cluster chosen with Enter zooms in and is redrawn as its parts: the focus goes with its
  // first place.
  const cluster = page.locator(CLUSTER).first();
  if ((await cluster.count()) === 0) return;
  const first = numbersIn((await cluster.getAttribute("data-numbers")) ?? "")[0];
  await cluster.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(800);
  await expect(focused).toHaveClass(/maplibregl-marker/);
  expect(numbersIn((await focused.getAttribute("data-numbers")) ?? "")).toContain(first);
});

test("no two markers overlap on any night, as opened or zoomed out", async ({ page }) => {
  // Pins were grouped by how far apart their points were, 44px, while a cluster sticker grows
  // with the numbers it prints: pin 12 sat on the end of "1·3·6·8–11" (review, 2026-09-28).
  test.setTimeout(90_000);
  await stubTiles(page);
  const found: string[] = [];
  for (const day of await pickerDays(page)) {
    await page.goto(homePath({ day, view: "map" }));
    await expect(page.locator(MARKER).first()).toBeVisible();
    await hydrated(page);
    for (let out = 0; out <= 2; out += 1) {
      if (out > 0) {
        await page.locator(".maplibregl-canvas").focus();
        await page.keyboard.press("Minus");
        await page.waitForTimeout(700);
      }
      found.push(...(await overlappingMarkers(page, `${day}, ${out} steps out`)));
    }
  }
  expect(found).toEqual([]);
});

test.describe("the split view, markers", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("no two markers overlap when a card is selected, except under the selected pin", async ({
    page,
  }) => {
    // The selected pin stays at its own point; neighbours may sit partly under it (z-index raised).
    test.setTimeout(120_000);
    await stubTiles(page);
    const found: string[] = [];
    for (const day of await pickerDays(page)) {
      await page.goto(homePath({ day }));
      await expect(page.locator(MARKER).first()).toBeVisible();
      await hydrated(page);
      // Off the list: a pointer left over a card from the last page enters nothing.
      await page.mouse.move(0, 0);
      for (let out = 0; out <= 1; out += 1) {
        if (out > 0) {
          await page.locator(".maplibregl-canvas").focus();
          await page.keyboard.press("Minus");
          await page.waitForTimeout(700);
        }
        const cards = page.locator("[data-pin-number]");
        for (let index = 0; index < (await cards.count()); index += 1) {
          const card = cards.nth(index);
          const number = await card.getAttribute("data-pin-number");
          await card.hover();
          await expect(
            page.locator(`${MARKER}[data-numbers="${number}"][aria-label$=", selected"]`),
          ).toHaveCount(1);
          const overlaps = await overlappingMarkers(
            page,
            `${day}, ${out} steps out, card ${number}`,
          );
          // The selected pin and its spot's fanned nights are drawn on top (data-raised).
          const raised = await page
            .locator(`${MARKER}[data-raised="true"]`)
            .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
          const filtered = overlaps.filter(
            (line) => !raised.some((name) => line.includes(`"${name}"`)),
          );
          found.push(...filtered);
        }
      }
    }
    expect(found).toEqual([]);
  });
});

test.describe("a phone on its side", () => {
  // An iPhone 13 held landscape: 342px tall, 298 of it the map's pane.
  test.use({ viewport: { width: 750, height: 342 } });

  test("a pin tap leaves the map its 176px, and the card's sheet scrolls", async ({ page }) => {
    // The sheet took up to half the pane and never gave way, so one tap left a 68px strip of map
    // (review, 2026-09-28).
    await stubTiles(page);
    // A pane this small can draw a night as clusters only (tonight's twelve places at 8am on
    // 2026-09-29 were two), so take the first night of the week that draws a pin of its own.
    let night = "";
    for (const day of await pickerDays(page)) {
      await page.goto(homePath({ day, view: "map" }));
      await expect(page.locator(MARKER).first()).toBeVisible();
      await hydrated(page);
      if ((await page.locator(PIN).count()) > 0) {
        night = day;
        break;
      }
    }
    expect(night, "some night this week draws a pin of its own").not.toBe("");
    await expect(page.locator(PIN).first()).toBeVisible();
    await page.locator(PIN).first().tap();
    const card = page.locator(REACHABLE_CARD);
    await expect(card).toHaveCount(1);
    await page.waitForTimeout(300);

    const map = await boxOf(mapSection(page));
    expect(map.height, "the map with its credit keeps min-h-map").toBeGreaterThanOrEqual(175.5);
    const sheet = card.locator("xpath=ancestor::div[contains(@class,'overflow-y-auto')][1]");
    const sheetBox = await boxOf(sheet);
    expect(sheetBox.height, "the card is still there to read").toBeGreaterThan(44);
    expect(sheetBox.y + sheetBox.height).toBeLessThanOrEqual(
      (await boxOf(page.locator(TOGGLE))).y + 0.5,
    );
    // What does not fit scrolls inside the sheet.
    const scrolls = await sheet.evaluate((element) => element.scrollHeight > element.clientHeight);
    expect(scrolls).toBe(true);
  });
});
