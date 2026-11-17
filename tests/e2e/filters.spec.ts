// Filtering by a style family (SPEC section 11: "filter by style"). The filter belongs to the URL,
// not to a component's memory, so the narrowed view can be shared and the back button puts the
// evening back the way it was (PLAN section 11, URL state).

import { expect, test, type Page } from "@playwright/test";

import { FAMILY_KEYS, familyLabel, stylesOf, type FamilyKey } from "@/config/styles";

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

/** The things a visitor can press. A chip may be a link, a button or a checkbox with its label. */
const PRESSABLE = 'a, button, [role="button"], [role="checkbox"], [role="switch"], label';

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function cardHrefs(page: Page): Promise<string[]> {
  return page
    .locator(CARD)
    .evaluateAll((elements) => elements.map((element) => element.getAttribute("href") ?? ""));
}

/**
 * The family that the fewest of tonight's cards carry, read off the page itself. A family colour
 * never appears without its label (DESIGN.md section 3), so the label is on the card to be read.
 * Picking the rarest one guarantees the filter has something to narrow.
 */
async function rarestFamilyOnThePage(page: Page): Promise<FamilyKey> {
  const texts = await page.locator(CARD).allInnerTexts();
  const counts = new Map<FamilyKey, number>();
  for (const key of FAMILY_KEYS) {
    const label = familyLabel(key);
    const seen = texts.filter((text) => text.includes(label)).length;
    if (seen > 0) counts.set(key, seen);
  }
  const rarest = [...counts.entries()].sort((a, b) => a[1] - b[1])[0];
  if (!rarest) throw new Error("no card named its family, so no family colour carried its label");
  return rarest[0];
}

/** The chip in the filter row for a family: "Salsa and Latin 5" (home.styles.chip). */
function familyChip(page: Page, family: FamilyKey) {
  return page
    .locator(PRESSABLE)
    .filter({ hasText: new RegExp(`^\\s*${escapeForRegExp(familyLabel(family))}\\b`) })
    .first();
}

/** Every value carried by the query string, comma lists split out. */
function queryValues(url: string): string[] {
  const values: string[] = [];
  for (const [, value] of new URL(url).searchParams) {
    values.push(...value.split(","));
  }
  return values;
}

test("filtering by a family narrows the list, and the URL carries it", async ({ page }) => {
  await page.goto(homePath());
  await expect(page.locator(CARD).first()).toBeVisible();

  const everything = await cardHrefs(page);
  expect(everything.length).toBeGreaterThan(1);

  const family = await rarestFamilyOnThePage(page);
  const chip = familyChip(page, family);
  await expect(chip, `the filter row offers ${familyLabel(family)}`).toBeVisible();

  // Chips, segments, cards and buttons are at least 44px tall (DESIGN.md section 5).
  const chipBox = await chip.boundingBox();
  expect(chipBox?.height ?? 0, "a chip is a 44px target").toBeGreaterThanOrEqual(44);

  await chip.click();

  // The list narrows to that family and does not empty. Both halves are polled as one condition:
  // part-way through the navigation the page carries no cards at all, and an empty list would
  // satisfy "not the whole evening" on its own.
  await expect
    .poll(
      async () => {
        const hrefs = await cardHrefs(page);
        return hrefs.length > 0 && hrefs.length < everything.length;
      },
      { message: "the list narrows to that family without emptying" },
    )
    .toBe(true);
  const narrowed = await cardHrefs(page);
  for (const href of narrowed) expect(everything).toContain(href);

  // The filter is in the URL, as the family's own key or as the style keys it stands for, so the
  // view is a place a dancer can send to a friend.
  const acceptable: string[] = [family, ...stylesOf(family)];
  expect(
    queryValues(page.url()).some((value) => acceptable.includes(value)),
    `the URL names ${family}: ${page.url()}`,
  ).toBe(true);

  // Selection is never carried by colour alone (DESIGN.md section 11): the chip says so.
  const selected = await chip.evaluate(
    (element) =>
      element.getAttribute("aria-pressed") === "true" ||
      element.getAttribute("aria-checked") === "true" ||
      element.getAttribute("aria-current") !== null ||
      (element.getAttribute("aria-label") ?? element.textContent ?? "")
        .toLowerCase()
        .includes("selected") ||
      (element.querySelector("input") as HTMLInputElement | null)?.checked === true,
  );
  expect(selected, "the selected chip says it is selected").toBe(true);

  // Shareable: the same URL opened cold shows the same narrowed evening.
  const shared = await page.context().newPage();
  await shared.goto(page.url());
  await expect(shared.locator(CARD).first()).toBeVisible();
  expect(await cardHrefs(shared)).toEqual(narrowed);
  await shared.close();

  // And the back button puts the whole evening back.
  await page.goBack();
  await expect(page.locator(CARD)).toHaveCount(everything.length);
  expect(await cardHrefs(page)).toEqual(everything);
});
