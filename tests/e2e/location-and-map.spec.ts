// The last two things Phase 1 promises (SPEC section 11): "use the map, and change location".
//
// The map is MapLibre over our own venue coordinates, reached from the list/map toggle at the foot
// of the phone screen, with numbered pins (the owner's answer of 2026-09-22) that match the list.

import { expect, test, type Page } from "@playwright/test";

import { e2eNow } from "./early-hours";
import { addCalendarDays, formatCalendarDateFrom } from "@/src/domain/time";
import { currentNightDate } from "@/src/domain/tonight";
import { en } from "@/src/i18n";
import { MAPLIBRE_WORKER_URL } from "@/src/ui/map/worker";

/**
 * The map's tiles come from OpenFreeMap (D-013), a host these tests must not depend on: a network
 * that cannot reach it would fail a test about OUR pins, and a network that can would make the run
 * slower and flakier for no added confidence. So every style and tile request is answered locally
 * with a valid, empty MapLibre style. The canvas, the pins and the toggle are ours and are what is
 * under test; the tile imagery is not.
 */
const EMPTY_STYLE = {
  version: 8,
  name: "test",
  sources: {},
  layers: [{ id: "paper", type: "background", paint: { "background-color": "#F2EDE3" } }],
};

async function stubTiles(page: Page): Promise<void> {
  await page.route(/(openfreemap|protomaps|maptiler|tiles)\./i, async (route) => {
    const url = route.request().url();
    if (/style|\.json/i.test(url)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify(EMPTY_STYLE),
      });
      return;
    }
    await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" }, body: "" });
  });
}

// The New York seed's centre (src/db/seed/nyc-data.ts) and a point well across town, so a change
// of location is a change a dancer would notice.
const SEED_CENTER = { lat: 40.7128, lng: -74.006 };
const RIDGEWOOD = { lat: 40.7043, lng: -73.9038 };
// Boston: a real place, hundreds of kilometres outside the only metro the seed knows.
const FAR_AWAY = { lat: 42.3601, lng: -71.0589 };

function homePath(
  center: { lat: number; lng: number } = SEED_CENTER,
  params: Record<string, string> = {},
): string {
  const query = new URLSearchParams({
    lat: String(center.lat),
    lng: String(center.lng),
    ...params,
  });
  return `/?${query.toString()}`;
}

const CARD = 'a[href^="/e/"]';

/** A single pin on the map: a marker that is not a cluster. */
const PIN = '.maplibregl-marker[data-marker="pin"]';

/** The things a visitor can press: the toggle may be a link, a button or a radio. */
const PRESSABLE = 'a, button, [role="button"], [role="radio"], [role="tab"], label';

async function cardHrefs(page: Page): Promise<string[]> {
  return page
    .locator(CARD)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("href") ?? ""));
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function control(page: Page, name: string) {
  return page
    .locator(PRESSABLE)
    .filter({ hasText: new RegExp(`^\\s*${escapeForRegExp(name)}\\s*$`) })
    .first();
}

test.describe("changing the location", () => {
  test.use({
    permissions: ["geolocation"],
    geolocation: { latitude: RIDGEWOOD.lat, longitude: RIDGEWOOD.lng },
  });

  test("the exact-location button moves the evening to where the dancer is", async ({ page }) => {
    await page.goto(homePath(SEED_CENTER, { sort: "distance" }));
    await expect(page.locator(CARD).first()).toBeVisible();
    const downtown = await cardHrefs(page);

    await control(page, en.home.location.useExact).click();

    // The point is in the URL, so the view stays shareable and survives a reload (PLAN section 11).
    await expect
      .poll(
        () => {
          const params = new URL(page.url()).searchParams;
          const lat = Number(params.get("lat"));
          const lng = Number(params.get("lng"));
          return Math.abs(lat - RIDGEWOOD.lat) < 0.01 && Math.abs(lng - RIDGEWOOD.lng) < 0.01;
        },
        { message: `the URL carries the dancer's own point, got ${page.url()}` },
      )
      .toBe(true);

    // Nearest first from a different point is a different order.
    await expect(page.locator(CARD).first()).toBeVisible();
    expect(await cardHrefs(page)).not.toEqual(downtown);
  });

  test("from a link to a night the page did not open, it leaves that night out", async ({
    page,
  }) => {
    // Tonight + 13 (D-075): the page opens tonight and says so (audit F16).
    const later = addCalendarDays(currentNightDate(e2eNow(), "America/New_York"), 13);
    await page.goto(homePath(SEED_CENTER, { day: later }));
    await expect(page.getByText(/Showing tonight\.$/)).toBeVisible();

    await control(page, en.home.location.useExact).click();

    await expect
      .poll(
        () => Math.abs(Number(new URL(page.url()).searchParams.get("lng")) - RIDGEWOOD.lng) < 0.01,
        { message: `the URL carries the dancer's own point, got ${page.url()}` },
      )
      .toBe(true);
    expect(new URL(page.url()).searchParams.get("day"), page.url()).toBeNull();
    await expect(page.locator(CARD).first()).toBeVisible();
    await expect(page.getByText(/Showing tonight\.$/)).toHaveCount(0);
  });
});

test("a different point lists a different evening", async ({ page }) => {
  await page.goto(homePath(SEED_CENTER, { sort: "distance" }));
  await expect(page.locator(CARD).first()).toBeVisible();
  const downtown = await cardHrefs(page);

  await page.goto(homePath(RIDGEWOOD, { sort: "distance" }));
  await expect(page.locator(CARD).first()).toBeVisible();
  expect(await cardHrefs(page)).not.toEqual(downtown);

  // And nowhere near the only metro the seed knows, there is nothing to list rather than New York.
  await page.goto(homePath(FAR_AWAY));
  await expect(page.locator(CARD)).toHaveCount(0);
});

test("the list and map toggle reaches the map", async ({ page }) => {
  await stubTiles(page);
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();

  const toMap = control(page, en.home.view.map);
  await expect(toMap, "the foot of the page offers the map").toBeVisible();
  const box = await toMap.boundingBox();
  expect(box?.height ?? 0, "the toggle is a 44px target").toBeGreaterThanOrEqual(44);

  await toMap.click();

  // The view is in the URL like every other piece of state (PLAN section 11).
  await expect(page).toHaveURL(/[?&]view=map\b/);

  // The map names itself for a screen reader (src/i18n a11y.map, a11y.mapWithCount).
  const map = page.locator('[aria-label^="Map"]').first();
  await expect(map).toBeVisible();
  const mapBox = await map.boundingBox();
  expect(mapBox?.height ?? 0, "the map has the screen").toBeGreaterThan(200);

  // And back to the list.
  await control(page, en.home.view.list).click();
  await expect(page.locator(CARD).first()).toBeVisible();
});

test("a shared map link to a night that is over says so on the phone's strip", async ({ page }) => {
  await stubTiles(page);
  const tonight = currentNightDate(e2eNow(), "America/New_York");
  const past = addCalendarDays(tonight, -1);
  const notice = en.home.day.unopened.over.replace(
    "{day}",
    formatCalendarDateFrom(past, tonight, "en-US"),
  );
  await page.goto(homePath(SEED_CENTER, { day: past, view: "map" }));
  // The header's notice is under the map, in the inert list pane; the strip is what shows.
  const strip = page.locator("a", { hasText: en.map.strip.toList });
  await expect(strip).toBeVisible();
  await expect(strip.getByText(notice, { exact: true })).toBeVisible();
  // And it leads back to tonight's list, not to the night that is over.
  expect(
    new URL((await strip.getAttribute("href")) ?? "/", "http://x").searchParams.get("day"),
  ).toBeNull();
});

test("the map's pins carry their number", async ({ page }) => {
  await stubTiles(page);
  await page.goto(homePath(SEED_CENTER, { view: "map" }));

  // Numbered pins, not two-letter family codes (DESIGN.md section 13, settled 2026-09-22): the
  // number is the card's position in the current list order, so list and map match without colour.
  // A pin is named by its printed time and its night ("9pm, Milonga la Nacional", D-170); a cluster by
  // the count and its venues ("2 places, Stepping Out Studios").
  const pins = page.locator(PIN);
  await expect(pins.first()).toBeVisible();
  await expect(pins.first()).toHaveAttribute("aria-label", /^\d{1,2}(:\d{2})?(am|pm), \S/);
  await expect(pins.first()).toHaveAttribute("data-marker", "pin");
});

/**
 * A style with one vector source, so the map cannot finish loading without its tile worker. The
 * empty style above needs no worker at all, which is how a map that never drew a tile on the live
 * site (MapLibre 6 looked for its worker beside a module Next had bundled away) passed every test
 * here. Tiles are answered empty, locally, like everything else from the tile host.
 */
const TILED_STYLE = {
  version: 8,
  name: "test-tiled",
  sources: {
    streets: {
      type: "vector",
      tiles: ["https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf"],
      minzoom: 0,
      maxzoom: 14,
    },
  },
  layers: [
    { id: "paper", type: "background", paint: { "background-color": "#F2EDE3" } },
    { id: "water", type: "fill", source: "streets", "source-layer": "water" },
  ],
};

test("the map starts its tile worker from our own copy and finishes loading", async ({ page }) => {
  const workers: string[] = [];
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.route(/(openfreemap|protomaps|maptiler|tiles)\./i, async (route) => {
    const url = route.request().url();
    if (/\.pbf/i.test(url)) {
      await route.fulfill({
        status: 204,
        headers: { "access-control-allow-origin": "*" },
        body: "",
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(TILED_STYLE),
    });
  });

  const worker = await page.request.get(MAPLIBRE_WORKER_URL);
  expect(worker.status()).toBe(200);
  expect(worker.headers()["content-type"]).toMatch(/javascript/);

  await page.goto(homePath(SEED_CENTER, { view: "map" }));
  // The pins are drawn as soon as the style is in (D-068). The "Loading the map" line stays until
  // the map's "load", which a style with a tiled source reaches only once its worker has fetched
  // and parsed the tiles in view.
  await expect(page.locator(PIN).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(en.map.loading, { exact: true })).toHaveCount(0, {
    timeout: 15_000,
  });
  // The page's "worker" event can reach the test a moment after the pins do (3 runs in 20 under
  // load, 2026-09-28), so it is waited for rather than read once. The pins already prove a worker
  // loaded the tiles; this says which file it was started from.
  await expect
    .poll(() => workers.map((url) => new URL(url).pathname), { timeout: 5_000 })
    .toContain(MAPLIBRE_WORKER_URL);
});
