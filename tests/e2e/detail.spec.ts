// Opening a card reaches its listing (SPEC section 11: "open a detail page"). The detail page is
// the flyer's back: the family chip with its label, the title, the when rail with the now rule cut
// into it, and the sources with when each was last checked (DESIGN.md section 7).

import { expect, test, type Page } from "@playwright/test";

import { FAMILY_KEYS, familyLabel, type FamilyKey } from "@/config/styles";
import { en } from "@/src/i18n";

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

/** The families a piece of text names. A family colour never appears without its label. */
function familiesNamedIn(text: string): FamilyKey[] {
  return FAMILY_KEYS.filter((key) => text.includes(familyLabel(key)));
}

/** A clock time from src/domain/time.ts formatTime: "7:30pm", "1am", or "19:30" in a 24-hour locale. */
const CLOCK_TIME = /\b(\d{1,2}(:\d{2})?(am|pm)|\d{1,2}:\d{2})\b/i;

async function openFirstCard(page: Page): Promise<{ href: string; families: FamilyKey[] }> {
  await page.goto(homePath());
  const card = page.locator(CARD).first();
  await expect(card).toBeVisible();

  // The whole card is one link, at least 88px tall (DESIGN.md section 5).
  const box = await card.boundingBox();
  expect(box?.height ?? 0, "a card is at least 88px tall").toBeGreaterThanOrEqual(88);

  const href = (await card.getAttribute("href")) ?? "";
  const families = familiesNamedIn(await card.innerText());
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href.split("?")[0]}(\\?|$)`));
  // The card is a plain link, so the tap loads a new document, and the URL changes when it
  // commits, while the page is still streaming in. Wait for all of it: under `next dev` a test
  // that read the page at the URL change saw half of it (no links yet, 2026-09-28).
  await page.waitForLoadState("load");
  return { href, families };
}

test("a card opens its listing, with the family chip, the when rail and the sources", async ({
  page,
}) => {
  const { families } = await openFirstCard(page);

  // The flyer headline: the family chip with its label above the title.
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const family = families[0];
  if (!family) throw new Error("the card carried a family colour with no label");
  await expect(
    page.getByText(familyLabel(family), { exact: true }).first(),
    "the family colour carries its label here too",
  ).toBeVisible();

  // WHEN: the same stamped-time rail as home. The heading is sentence case in the DOM; the
  // uppercase is CSS text-transform (DESIGN.md section 11).
  const when = page.getByRole("heading", { name: en.detail.when.heading, exact: true });
  await expect(when).toBeVisible();
  const whenRows = [
    en.detail.when.doors,
    en.detail.when.lesson,
    en.detail.when.dancingStarts,
    en.detail.when.ends,
    en.detail.when.endNotListed,
  ];
  // Not an exact match: a row is a stamped time and then its word ("7:30pm  Doors"), so the word
  // is a text node inside the row rather than an element of its own.
  const rowsShown = await Promise.all(
    whenRows.map((row) =>
      page
        .getByText(row)
        .first()
        .isVisible()
        .catch(() => false),
    ),
  );
  expect(rowsShown.some(Boolean), "the when rail lists the night's times").toBe(true);
  await expect(page.getByText(CLOCK_TIME).first(), "the rail is stamped with times").toBeVisible();

  // SOURCES: where every fact came from, and when we last looked.
  await expect(
    page.getByRole("heading", { name: en.detail.sources.heading, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp(`\\b${en.detail.sources.checked.split("{")[0]?.trim()}\\b`)).first(),
    "each source says when it was last checked",
  ).toBeVisible();
  // Scoped to the sources list: an unscoped a[href^="http"] matches the directions link first,
  // which the design deliberately keeps collapsed behind its two-choice sheet.
  // Scoped to the sources list: an unscoped a[href^="http"] matches the directions link first,
  // which the design deliberately keeps collapsed behind its two-choice sheet.
  const sourcesList = page
    .getByRole("heading", { name: en.detail.sources.heading, exact: true })
    .locator("xpath=following::ol[1]");
  await expect(
    sourcesList.locator('a[href^="http"]').first(),
    "the sources link out",
  ).toBeVisible();
});

test("the back link returns to tonight", async ({ page }) => {
  await openFirstCard(page);
  // "Back to tonight" at the top left (DESIGN.md section 7, D-069): a link back to the bill.
  const back = page.locator('a[href="/"], a[href^="/?"]').first();
  await expect(back).toContainText(en.detail.back.tonight);
  await back.click();
  await expect(page.locator(CARD).first()).toBeVisible();
});

// The map in WHERE loads by itself now, and is tested with the other maps in map.spec.ts (D-068).

test("a listing whose time is not listed says so in its When list (D-060)", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();

  // Found by the group's heading, never by a title: the first card after "Time not listed".
  const heading = page.getByRole("heading", {
    level: 2,
    name: en.home.untimed.heading,
    exact: true,
  });
  await expect(heading, "tonight has a Time not listed heading").toHaveCount(1);
  const card = heading.locator("xpath=following::a[starts-with(@href, '/e/')][1]");
  const href = (await card.getAttribute("href")) ?? "";
  expect(href.startsWith("/e/")).toBe(true);
  await card.click();
  await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // The title block's status reads as the card's stamp would: the time is not listed (or the
  // night is cancelled, which wins, and which the date line carries beside the date, D-069).
  const titleBlock = page
    .locator("header")
    .filter({ has: page.getByRole("heading", { level: 1 }) });
  const cancelledSuffix = en.detail.date.cancelled.replace("{day}", "");
  await expect(titleBlock).toContainText(
    new RegExp(`${en.card.status.timeNotListed}|${cancelledSuffix}`),
  );

  // WHEN opens with the "Time not listed" row, its rail cell empty: no clock time before it.
  const whenList = page
    .getByRole("heading", { name: en.detail.when.heading, exact: true })
    .locator("xpath=following::ol[1]");
  const rows = whenList.locator(":scope > li");
  await expect(rows.first()).toHaveText(en.detail.when.timeNotListed);
  // No now rule: there is no stamped row to place it between.
  await expect(whenList.locator('[role="separator"]')).toHaveCount(0);
  // "End not listed" under "Time not listed" would be noise; an end appears only when listed.
  await expect(whenList).not.toContainText(en.detail.when.endNotListed);

  // "Times are in" only when some row stamps a time, which here means a listed end.
  const stampsAnEnd = (await whenList.getByText(CLOCK_TIME).count()) > 0;
  const zoneLine = page.getByText(new RegExp(`^${en.detail.when.timesInZone.split("{")[0]}`));
  await expect(zoneLine).toHaveCount(stampsAnEnd ? 1 : 0);

  // The JSON-LD dates the night and states no time (D-060: a date-only startDate, no endDate).
  const jsonLd = JSON.parse(
    (await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}",
  ) as { startDate?: string; endDate?: string };
  expect(jsonLd.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(jsonLd.endDate).toBeUndefined();
});

test("every link that leaves the app says so before it is followed", async ({ page }) => {
  await openFirstCard(page);
  // There is at least one, so the check below is not vacuously true; waited for, not counted
  // once, so a page still arriving is not read as a page with none.
  await expect(page.locator('a[target="_blank"]').first()).toBeAttached();

  // WCAG 2.2 3.2.5: a new tab is a change of context, and a dancer holding a phone in a dark hall
  // is the last person who should have to discover it afterwards.
  const unannounced = await page
    .locator('a[target="_blank"]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => !(element.getAttribute("aria-label") ?? "").includes("new tab"))
        .map((element) => element.getAttribute("href") ?? "(no href)"),
    );
  expect(unannounced, "every new-tab link names the new tab").toEqual([]);
});
