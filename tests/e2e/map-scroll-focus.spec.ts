// A pin picked on the map smooth-scrolls its card into view (D-068). If focus moves elsewhere in
// the page while that scroll is still running, the scroll stops where focus put the page: it must
// not carry on and drag the newly focused element out of view (D-171).

import { expect, test } from "@playwright/test";

import { MARKER, PIN, REACHABLE_CARD, homePath, stubTiles } from "./map-helpers";

test.describe("the split view", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("a map pick's smooth scroll stops when focus moves to the list", async ({ page }) => {
    await stubTiles(page);
    await page.goto(homePath());
    await expect(page.locator(MARKER).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));

    // The pin of the last card that has one, so its card is far below the fold.
    const last = Math.max(
      ...(await page
        .locator(PIN)
        .evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-numbers"))))),
    );
    const far = page.locator(`[data-pin-number="${last}"]`);
    // Late at night tonight's list can be short enough to fit: then there is no scroll to stop.
    test.skip(
      (await far.isVisible()) && (await far.boundingBox())!.y < 800,
      "the list fits the window tonight",
    );
    await expect(far, "the picked card starts below the fold").not.toBeInViewport();

    // Pick it, then at once move focus to the first card, as a keyboard or screen reader user
    // might while the list is still gliding.
    await page.locator(`${PIN}[data-numbers="${last}"]`).click();
    await expect(far).toHaveAttribute("aria-current", "true");
    // A scrollend left over from an earlier scroll must not switch the guard off (it arrived
    // first late at night, when the list is shorter).
    await page.evaluate(() => window.dispatchEvent(new Event("scrollend")));
    const first = page.locator(REACHABLE_CARD).first();
    await first.focus();

    // Long after any smooth scroll would have finished, the focused card is still on screen.
    await page.waitForTimeout(1500);
    await expect(first).toBeFocused();
    await expect(first).toBeInViewport();
  });

  test("with focus left on the pin, the pick still brings its card into view", async ({ page }) => {
    await stubTiles(page);
    await page.goto(homePath());
    await expect(page.locator(MARKER).first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => window.scrollTo(0, 0));

    const last = Math.max(
      ...(await page
        .locator(PIN)
        .evaluateAll((els) => els.map((el) => Number(el.getAttribute("data-numbers"))))),
    );
    await page.locator(`${PIN}[data-numbers="${last}"]`).click();
    await expect(page.locator(`[data-pin-number="${last}"]`)).toBeInViewport();
  });
});
