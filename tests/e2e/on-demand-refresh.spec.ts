// The on-demand read's status line (D-899): a city other than New York asks /api/refresh when it
// opens and says when it was last read. Mock mode has only New York as a city with a page (London
// is a point with nothing in reach), so this proves the New York side: no line and no request.
// The decisions behind the line are tested in tests/unit/on-demand.test.ts.

import { expect, test } from "@playwright/test";

import { en } from "@/src/i18n";

const lastUpdatedPrefix = en.home.header.refresh.updated.split("{ago}")[0]!.trim();
const stub = (state: string, lastUpdated: string | null) => ({
  status: 200,
  contentType: "application/json",
  body: JSON.stringify({ state, lastUpdated }),
});

test("New York is read on its schedule: no status line and no request", async ({ page }) => {
  let asked = false;
  await page.route("**/api/refresh?**", (route) => {
    asked = true;
    return route.fulfill(stub("updating", null));
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Hydration has run once the heading's city button answers a tap; give the effect its turn.
  await page.waitForLoadState("networkidle");
  expect(asked).toBe(false);
  await expect(page.getByText(lastUpdatedPrefix)).toHaveCount(0);
});
