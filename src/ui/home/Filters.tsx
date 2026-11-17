// The filter row: the segmented control, the family chips with their counts, the sort control
// and the way into the more-filters sheet. Every one of them is a link, so filter state lives
// in the URL (PLAN section 11): a filtered view is shareable and the back button works.
//
// They are next/link links with scroll={false}: before hydration a tap is an ordinary
// navigation, and after it the page is re-rendered in place, so the page does not jump and the
// chip row keeps its sideways scroll (review, 2026-09-28: every tap used to reload the page, reset
// the chip row and, after 7:30pm, jump past the controls to the now rule). Prefetch is off: each
// link is a different dynamic render.
//
// Two invariants from the design a reviewer checks here:
//   - a family colour never appears without its label, which FamilyChip guarantees;
//   - the selected state is never colour alone: a selected chip adds a 2px imprint border and a
//     check mark, a selected segment is a filled ink pill, and both carry aria-current.

import Link from "next/link";

import { FAMILIES, familyLabel, type FamilyKey } from "@/config/styles";
import type { ListingCounts } from "@/src/data/repository";
import { FamilyChip } from "@/src/ui/primitives";
import { t } from "@/src/i18n";

import { intoViewScript } from "./into-view";
import {
  SEGMENTS,
  activeFilterCount,
  hrefWith,
  toggleFamilyHref,
  type HomeQuery,
  type RawParams,
  type Segment,
} from "./params";
import { PendingBar } from "./PendingBar";

const SEGMENT_COPY = {
  all: { full: "home.segments.all.full", short: "home.segments.all.short" },
  social: { full: "home.segments.social.full", short: "home.segments.social.short" },
  clubs: { full: "home.segments.clubs.full", short: "home.segments.clubs.short" },
  classes: { full: "home.segments.classes.full", short: "home.segments.classes.short" },
  other: { full: "home.segments.other.full", short: "home.segments.other.short" },
} as const;

/**
 * The short forms at every width, with the spec's full label as the spoken name (each full label
 * begins with its short one, so the name still contains what is seen, WCAG 2.5.3). The full labels
 * used to appear from 1024px, where the list is a 440px column beside the map and five of them
 * do not fit: "Other" was cut to "Oth" (review, 2026-09-28).
 */
function segmentName(segment: Segment): string | undefined {
  const full = t(SEGMENT_COPY[segment].full);
  return full === t(SEGMENT_COPY[segment].short) ? undefined : full;
}

function Segments({ query, params }: { query: HomeQuery; params: RawParams }) {
  return (
    <nav aria-label={t("home.segments.label")}>
      <ul role="list" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scroll-px-4">
        {SEGMENTS.map((segment) => {
          const current = query.segment === segment;
          return (
            <li key={segment}>
              <Link
                href={hrefWith(params, { t: segment === "all" ? null : segment, filters: null })}
                scroll={false}
                prefetch={false}
                rel="nofollow"
                aria-current={current ? "true" : undefined}
                aria-label={segmentName(segment)}
                className="type-label text-ink min-h-11 flex items-center whitespace-nowrap"
              >
                <span
                  className={`rounded-pill px-4 py-1.5 ${
                    current ? "bg-ink text-paper" : "chip-edge text-ink"
                  }`}
                >
                  {t(SEGMENT_COPY[segment].short)}
                </span>
                <PendingBar />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function FamilyChips({
  query,
  params,
  counts,
}: {
  query: HomeQuery;
  params: RawParams;
  counts: ListingCounts;
}) {
  // A family with nothing to add is left out, unless it is on: a filter that is on is always
  // drawn, with its 0, so it can be seen and tapped off (review, 2026-09-28).
  const present = FAMILIES.map((f) => f.key as FamilyKey).filter(
    (key) => (counts.byFamily[key] ?? 0) > 0 || query.families.includes(key),
  );
  if (present.length === 0) return null;

  return (
    <nav aria-label={t("home.styles.label")} className="mt-2">
      <ul
        id={CHIP_ROW_ID}
        role="list"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scroll-px-4"
      >
        {present.map((family) => {
          const count = counts.byFamily[family] ?? 0;
          const selected = query.families.includes(family);
          const label = selected
            ? t("home.styles.chipSelected", { family: familyLabel(family), count })
            : t("home.styles.chip", { family: familyLabel(family), count });
          return (
            <li key={family}>
              <Link
                href={toggleFamilyHref(params, query.families, family)}
                scroll={false}
                prefetch={false}
                rel="nofollow"
                aria-label={label}
                aria-current={selected ? "true" : undefined}
                className="min-h-11 flex items-center whitespace-nowrap"
              >
                {/* One rectangle: the 2px imprint border and the check sit on the stock itself,
                    never on the page, where imprint is invisible in the dark theme (DESIGN 11). */}
                <FamilyChip family={family} count={count} selected={selected} />
              </Link>
            </li>
          );
        })}
      </ul>
      {/* On a first load the row starts at its left edge; bring the first chip that is on into
          view, so a shared link to "Folk" shows Folk selected. Runs during parse, like
          ScrollToNow, and does nothing when no chip is on. */}
      {query.families.length === 0 ? null : (
        <script dangerouslySetInnerHTML={{ __html: intoViewScript(CHIP_ROW_ID) }} />
      )}
    </nav>
  );
}

const CHIP_ROW_ID = "family-chips";

function Sort({ query, params }: { query: HomeQuery; params: RawParams }) {
  const options = [
    { value: "start", label: t("home.sort.startTime"), param: null },
    { value: "distance", label: t("home.sort.distance"), param: "distance" },
  ] as const;

  return (
    <nav aria-label={t("home.sort.label")} className="flex items-center gap-2">
      <span className="type-label text-toner">{t("home.sort.label")}</span>
      <ul role="list" className="flex gap-2">
        {options.map((option) => {
          const current = query.sort === option.value;
          return (
            <li key={option.value}>
              <Link
                href={hrefWith(params, { sort: option.param, filters: null })}
                scroll={false}
                prefetch={false}
                rel="nofollow"
                aria-current={current ? "true" : undefined}
                className={`type-label min-h-11 flex items-center px-1 ${
                  current ? "text-ink font-semibold underline underline-offset-4" : "text-toner"
                }`}
              >
                {option.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Filters({
  query,
  params,
  counts,
}: {
  query: HomeQuery;
  params: RawParams;
  counts: ListingCounts;
}) {
  const active = activeFilterCount(query);
  return (
    // No accessible name: the sheet is the "Filters" region, and two regions of one name were one
    // too many (review, 2026-09-28). The id is still the skip link's target.
    <section id="filters" className="mt-4 px-4">
      <Segments query={query} params={params} />
      <FamilyChips query={query} params={params} counts={counts} />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4">
        <Sort query={query} params={params} />
        {/* Beside the sort rather than on a row of its own (review, 2026-09-28). It clears the
            style keys too: a shared link can carry `s`, which has no chip of its own. */}
        {query.families.length === 0 && query.styles.length === 0 ? null : (
          <Link
            href={hrefWith(params, { f: null, s: null })}
            scroll={false}
            prefetch={false}
            className="type-label text-ink min-h-11 flex items-center underline underline-offset-4"
          >
            {t("home.styles.clear")}
          </Link>
        )}
        <Link
          href={hrefWith(params, { filters: query.sheetOpen ? null : "1" })}
          scroll={false}
          prefetch={false}
          aria-expanded={query.sheetOpen}
          aria-controls="more-filters"
          className="type-label text-ink min-h-11 flex items-center underline underline-offset-4"
        >
          {t("home.filters.open")}
          {active === 0 ? null : (
            <span className="ms-2 text-toner">{t("home.filters.active", { count: active })}</span>
          )}
        </Link>
      </div>
    </section>
  );
}
