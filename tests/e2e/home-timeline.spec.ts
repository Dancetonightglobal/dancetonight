// The bill of the evening (DESIGN.md section 6): the stamped times down the rail, an hour marker
// for every hour from the first start to the last end, the empty hours drawn as 32px rows (the
// owner's answer of 2026-09-22), and the now rule between what has started and what has not.
//
// Nothing here looks at a class name or a test id. A card is an anchor into /e/ because the design
// makes the whole card one link; the hour markers are the level-2 headings whose text is an hour;
// the now rule is the separator whose accessible name starts with "Now" (src/i18n a11y.nowMarker).

import { expect, test, type Page } from "@playwright/test";

import { en } from "@/src/i18n";
import { skipInEarlyHours } from "./early-hours";

// The New York seed's centre (src/db/seed/nyc-data.ts, NYC_METRO.center). A dev server has no
// IP-geo headers, so every test names its point instead of hoping the page guesses one.
const SEED_CENTER = { lat: 40.7128, lng: -74.006 };

/** The home page at the seeded point. URL state is PLAN section 11: lat, lng, day, r, s, sort, view. */
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

/** The now rule: a separator carrying a11y.nowMarker, "Now, 7:42pm". */
const NOW_RULE = '[role="separator"][aria-label^="Now"]';

/** What a string says before its first placeholder, so an assertion quotes src/i18n, not prose. */
function prefixOf(template: string): string {
  return (template.split("{")[0] ?? "").trim();
}

/**
 * The hour a label stands for: "8PM" and "Starting at 8pm" are 20, "12AM" is 0, "20:00" is 20.
 * The config pins en-US so the rail is the 12-hour form, but formatTime drops the meridiem in a
 * 24-hour locale and the same parser reads that rail too.
 */
function hourOf(label: string): number | null {
  const twelve = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(label);
  if (twelve) {
    const hour = Number(twelve[1]) % 12;
    return twelve[3]?.toLowerCase() === "pm" ? hour + 12 : hour;
  }
  const twentyFour = /^\s*(\d{1,2})(?::\d{2})?\s*$/.exec(label);
  if (!twentyFour) return null;
  const hour = Number(twentyFour[1]);
  return hour < 24 ? hour : null;
}

/** A card's stamped time is its first element, so it is the first word of the card's text. */
function stampedTimeOf(cardText: string): string {
  return (cardText.trim().split(/\s+/)[0] ?? "").trim();
}

/**
 * The stamp of a listing whose source gives its night and no time (D-060). Off the rail (distance
 * sort) the phrase stands in the stamp slot, as the card's first inline element, where a clock
 * time would be. On the rail the group's heading says it once and its cards carry no stamp
 * (D-067): the phrase is then in each card's accessible name, never printed again.
 */
const TIME_NOT_LISTED = en.card.stamp.timeNotListed;

/** True when a card opens with the phrase rather than a clock time. */
function startsWithTimeNotListed(cardText: string): boolean {
  return cardText.trim().startsWith(TIME_NOT_LISTED);
}

/** True when a card is named "Time not listed, {name}" (DESIGN.md section 11), on or off the rail. */
function isUntimed(card: PlacedCard): boolean {
  return card.label.startsWith(`${TIME_NOT_LISTED}, `);
}

/** The h2 that opens the group of listings whose time is not listed; its text is its name. */
function untimedHeading(page: Page) {
  return page.getByRole("heading", { level: 2, name: en.home.untimed.heading, exact: true });
}

interface PlacedCard {
  top: number;
  /** The DOM text, sentence case (display caps are CSS), so a phrase from en.ts matches it. */
  text: string;
  label: string;
}

/** Every card with its document top, its DOM text and its accessible name. */
async function placedCards(page: Page): Promise<PlacedCard[]> {
  return page.locator(CARD).evaluateAll((elements) =>
    elements.map((element) => ({
      top: element.getBoundingClientRect().top + window.scrollY,
      text: element.textContent ?? "",
      label: element.getAttribute("aria-label") ?? "",
    })),
  );
}

async function documentTop(locator: ReturnType<Page["locator"]>): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().top + window.scrollY);
}

/**
 * The "Time not listed" group as DESIGN.md section 5 draws it: the heading follows the last hour
 * marker, every card under it is named by the phrase without printing it again (the heading
 * already says it, D-067), and no card above it is untimed. Found by its heading, never by a
 * title, so any untimed listing the seed carries is held to it.
 */
async function expectUntimedGroup(page: Page): Promise<{ headingTop: number }> {
  const heading = untimedHeading(page);
  await expect(heading, "one Time not listed heading on this night").toHaveCount(1);
  await expect(heading).toBeVisible();
  const headingTop = await documentTop(heading);

  const markers = await hourMarkers(page);
  for (const marker of markers) {
    expect(marker.bottom, `the ${marker.hour}:00 marker is above the heading`).toBeLessThanOrEqual(
      headingTop + 1,
    );
  }

  const cards = await placedCards(page);
  const below = cards.filter((card) => card.top > headingTop);
  const above = cards.filter((card) => card.top < headingTop);
  expect(below.length, "the heading opens a group of cards").toBeGreaterThan(0);
  for (const card of below) {
    // Named "Time not listed, {name}" (DESIGN.md section 11), with ", cancelled" when it is.
    expect(isUntimed(card), `card under the heading: ${card.label}`).toBe(true);
    // The heading says it once; the card does not print it a second time.
    expect(card.text, `card under the heading: ${card.text}`).not.toContain(TIME_NOT_LISTED);
    // Never names a confirming page (D-072): the time was not confirmed, whatever else was.
    expect(card.text).not.toContain(prefixOf(en.card.flags.onOrganizerPage));
    expect(card.text).not.toContain(prefixOf(en.card.flags.onTicketPage));
    expect(card.text).toContain(en.card.flags.checkBeforeYouGo);
  }
  for (const card of above) {
    expect(isUntimed(card), `card above the heading: ${card.label}`).toBe(false);
  }
  return { headingTop };
}

interface HourMarker {
  hour: number;
  top: number;
  bottom: number;
}

/**
 * The hour markers in page order, in document coordinates. Level-2 headings whose text is not an
 * hour (a section head, the "Tomorrow" heading of a thin night) are not markers and drop out.
 */
async function hourMarkers(page: Page): Promise<HourMarker[]> {
  const headings = await page.getByRole("heading", { level: 2 }).evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return {
        text: element.textContent ?? "",
        top: box.top + window.scrollY,
        bottom: box.bottom + window.scrollY,
      };
    }),
  );
  return headings
    .map((heading) => ({ ...heading, hour: hourOf(heading.text) }))
    .filter((heading): heading is HourMarker & { text: string } => heading.hour !== null);
}

/** Hours unwrapped past midnight, so 11PM, 12AM, 1AM reads 23, 24, 25 and gaps are visible. */
function unwrapPastMidnight(hours: readonly number[]): number[] {
  const unwrapped: number[] = [];
  let offset = 0;
  hours.forEach((hour, index) => {
    const previous = hours[index - 1];
    if (previous !== undefined && hour < previous) offset += 24;
    unwrapped.push(hour + offset);
  });
  return unwrapped;
}

test.describe("the evening as a bill of times", () => {
  test("lists tonight's nights with a stamped time on every card", async ({ page }) => {
    skipInEarlyHours();
    await page.goto(homePath());

    // "Tonight near {place}" (home.header.tonight): the night and the place, in that order.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      prefixOf(en.home.header.tonight),
    );

    const cards = page.locator(CARD);
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);

    // The stamped time is the first and largest thing on a card, and it is a real clock time from
    // formatTime, not a hand-written string: "7:30pm", "1am" or "19:30" in a 24-hour locale. A
    // listing whose source gives no time is never given an assumed hour (D-060): it sits under the
    // Time not listed heading, named by the phrase, with no stamp of its own.
    // innerText, not textContent, so the stamp ends at its own element's edge.
    const rendered = await cards.evaluateAll((elements) =>
      elements.map((element) => ({
        label: element.getAttribute("aria-label") ?? "",
        text: (element as HTMLElement).innerText,
      })),
    );
    // A card starting at the same time as the one above prints no stamp of its own (D-147); its
    // accessible name still begins with the time, the same as the card above.
    let previousStamp: string | null = null;
    for (const { label, text } of rendered) {
      if (label.startsWith(`${TIME_NOT_LISTED}, `)) continue;
      const stamp = stampedTimeOf(text);
      if (/^\d/.test(stamp)) {
        expect(stamp, `card text: ${text}`).toMatch(/^(\d{1,2}(:\d{2})?(am|pm)|\d{1,2}:\d{2})$/i);
        previousStamp = stamp;
      } else {
        expect(previousStamp, `a repeated stamp follows a printed one: ${text}`).not.toBeNull();
        expect(label.startsWith(`${previousStamp}, `), `card: ${label}`).toBe(true);
      }
    }
  });

  test("draws hour markers in order through the night", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();

    const markers = await hourMarkers(page);
    expect(markers.length, "the bill has hour markers").toBeGreaterThan(0);

    // Only hours in which something starts are drawn (D-147), so the run may skip hours, but it
    // always rises.
    const hours = unwrapPastMidnight(markers.map((marker) => marker.hour));
    for (let index = 1; index < hours.length; index += 1) {
      expect(hours[index], `hour markers rise, got ${hours.join(", ")}`).toBeGreaterThan(
        hours[index - 1] ?? 0,
      );
    }

    // Every listed card sits under a marker. Asserted by position rather than by reading the
    // card's stamped time: the rail never prints a meridiem (DESIGN section 5, D-067), so "7:00"
    // in the rail is 19:00 by its marker, and a test that re-derived that rule would be testing
    // its own copy of it rather than the page.
    const cardTops = await page
      .locator(CARD)
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top + window.scrollY));
    const firstMarkerTop = Math.min(...markers.map((marker) => marker.top));
    for (const top of cardTops) {
      const above = markers.filter((marker) => marker.top <= top);
      expect(
        above.length,
        `a card at ${Math.round(top)} sits under an hour marker`,
      ).toBeGreaterThan(0);
    }
    expect(Math.min(...cardTops), "the bill opens with an hour marker").toBeGreaterThan(
      firstMarkerTop - 1,
    );
  });

  test("draws no empty hours: every hour marker has a card under it (D-147)", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();
    const markers = await hourMarkers(page);
    const cardTops = (await placedCards(page)).map((card) => card.top);
    for (const [index, marker] of markers.entries()) {
      const nextTop = markers[index + 1]?.top ?? Infinity;
      expect(
        cardTops.some((top) => top >= marker.bottom - 1 && top < nextTop),
        `the ${marker.hour}:00 marker has a card`,
      ).toBe(true);
    }
  });

  test("sets the now rule between what has started and what has not", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();

    const rule = page.locator(NOW_RULE);
    // Rendered only for tonight, and it is the single loudest thing on the page: exactly one.
    await expect(rule).toHaveCount(1);
    await expect(rule).toBeVisible();

    // Nothing touches it: 8px of clear paper above and below (DESIGN.md section 5).
    const clearance = await rule.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return { top: parseFloat(style.paddingTop), bottom: parseFloat(style.paddingBottom) };
    });
    expect(clearance.top).toBeGreaterThanOrEqual(8);
    expect(clearance.bottom).toBeGreaterThanOrEqual(8);

    // The cards and the rule in page order, each card with the text of its status line.
    const bill = await page.evaluate(
      ([cardSelector, ruleSelector]) =>
        Array.from(document.querySelectorAll(`${cardSelector}, ${ruleSelector}`)).map(
          (element) => ({
            isRule: element.getAttribute("role") === "separator",
            text: (element as HTMLElement).innerText ?? element.textContent ?? "",
          }),
        ),
      [CARD, NOW_RULE] as const,
    );

    const ruleIndex = bill.findIndex((entry) => entry.isRule);
    expect(ruleIndex, "the rule is placed among the cards").toBeGreaterThanOrEqual(0);

    // The status line says which side of the rule a night belongs on: "Starts in 18 min, until
    // 12:30am" is ahead of now, "On now until 11pm" and "Ends in 20 min" are behind it. A
    // cancelled night keeps its slot with the word "Cancelled" and is not a live status, so it
    // carries no claim about now.
    const starts = new RegExp(
      `(${prefixOf(en.card.status.startsIn)}|${prefixOf(en.card.status.startsAt)})`,
    );
    const running = new RegExp(
      `(${prefixOf(en.card.status.onNow)}|${prefixOf(en.card.status.endsIn)})`,
    );
    const cancelled = prefixOf(en.card.status.cancelled);

    bill.forEach((entry, index) => {
      if (entry.isRule || entry.text.includes(cancelled)) return;
      if (index < ruleIndex) {
        expect(entry.text, "a night above the rule has started").not.toMatch(starts);
      } else {
        expect(entry.text, "a night below the rule has not started").not.toMatch(running);
      }
    });
  });

  test("sticks the start time at the top left while its cards scroll", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();

    // Find a group with 2+ cards that has a sticky stamp overlay
    const groups = page.locator("li:has(> div > [data-sticky-stamp])");
    const groupCount = await groups.count();
    if (groupCount === 0) {
      test.skip(true, "no group of two cards in the mock data");
      return;
    }

    let targetGroup: ReturnType<Page["locator"]> | null = null;
    for (let i = 0; i < groupCount; i++) {
      const group = groups.nth(i);
      const cardCount = await group.locator('a[href^="/e/"]').count();
      if (cardCount >= 2) {
        targetGroup = group;
        break;
      }
    }

    if (!targetGroup) {
      test.skip(true, "no group of two cards in the mock data");
      return;
    }

    // Get the stamp from the first card's aria-label
    const firstCard = targetGroup.locator('a[href^="/e/"]').first();
    const firstLabel = await firstCard.getAttribute("aria-label");
    const stamp = firstLabel?.split(", ")[0]?.trim() || "";

    // Scroll so the second card is at the top of the viewport
    const secondCard = targetGroup.locator('a[href^="/e/"]').nth(1);
    await secondCard.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -40));

    // Find the sticky div inside the overlay
    const sticky = targetGroup.locator("[data-sticky-stamp] > div");
    await expect(sticky).toBeVisible();

    const rect = await sticky.boundingBox();
    expect(rect).not.toBeNull();
    if (rect) {
      // Should be visible near the top (accounting for the 32px sticky now strip)
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeLessThanOrEqual(120); // Reasonable range
    }

    // The overlay's text should match the group's stamp
    const overlayText = await sticky.textContent();
    expect(overlayText?.trim()).toBe(stamp);
  });
});

test.describe("listings whose time is not listed (D-060)", () => {
  test("follow the last hour under their own heading, each opening with the phrase", async ({
    page,
  }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();

    // The seed carries at least one listing tonight whose source gave no time.
    const markers = await hourMarkers(page);
    expect(markers.length, "tonight's bill still has its hour markers").toBeGreaterThan(0);
    await expectUntimedGroup(page);
  });

  test("keep the now rule above their heading, among the timed rows", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();

    const rule = page.locator(NOW_RULE);
    const heading = untimedHeading(page);
    await expect(rule).toHaveCount(1);
    await expect(heading, "tonight has a Time not listed heading").toHaveCount(1);
    const ruleTop = await documentTop(rule);
    const headingTop = await documentTop(heading);
    expect(ruleTop, "the now rule sits above the Time not listed heading").toBeLessThan(headingTop);
    // And no untimed card sits above the rule: they have no side of now.
    for (const card of await placedCards(page)) {
      if (isUntimed(card)) expect(card.top).toBeGreaterThan(ruleTop);
    }
  });

  test("sit in distance order among the rest under distance sort, with no heading", async ({
    page,
  }) => {
    await page.goto(homePath({ sort: "distance" }));
    await expect(page.locator(CARD).first()).toBeVisible();

    await expect(untimedHeading(page)).toHaveCount(0);
    const texts = (await placedCards(page)).map((card) => card.text);
    expect(
      texts.some(startsWithTimeNotListed),
      "the untimed listing is still on the bill, with the phrase in its stamp slot",
    ).toBe(true);
  });

  test("head their group on a future night too, with no now rule", async ({ page }) => {
    await page.goto(homePath());
    await expect(page.locator(CARD).first()).toBeVisible();

    // Every night the day picker offers after tonight; the seed puts an untimed listing on at
    // least one of them. Found by the heading, so the test does not know which night.
    const futureNights = await page
      .getByRole("navigation", { name: en.home.day.label })
      .locator('a:not([aria-current="page"])')
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    expect(futureNights.length).toBeGreaterThan(0);

    let nightsWithUntimed = 0;
    for (const href of futureNights) {
      await page.goto(href);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if ((await untimedHeading(page).count()) === 0) continue;
      nightsWithUntimed += 1;
      // There is no now on a future night (DESIGN.md section 5), with or without a time.
      await expect(page.locator(NOW_RULE)).toHaveCount(0);
      await expectUntimedGroup(page);
    }
    expect(nightsWithUntimed, "a future night lists an untimed listing").toBeGreaterThan(0);
  });
});
