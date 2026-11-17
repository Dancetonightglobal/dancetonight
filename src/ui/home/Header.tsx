// "Tonight near Williamsburg", the count and the date, then the two ways to move the map pin:
// the browser's own location and a search box. The headline relabels with the chosen night,
// because "Tonight" on a Tuesday you are planning for Thursday would be a lie.
// The city in the headline is a button that opens the list of cities (D-183).

import { t } from "@/src/i18n";
import Link from "next/link";

import { formatCalendarDate, formatCalendarDateFrom } from "@/src/domain/time";
import type { NightDate } from "@/src/domain/tonight";

import { SearchPlace } from "./SearchPlace";
import { UseMyLocation } from "./UseMyLocation";
import type { RawParams, UnopenedDay } from "./params";
import { CityButton, CityPicker } from "./CityPicker";
import type { CitySummary } from "@/src/data/repository";

export interface HeaderProps {
  /** The metro or neighbourhood name; null when no metro is within reach of the point. */
  place: string | null;
  /**
   * "Tonight", "Tomorrow", or a short date, from formatDayLabel() (tonight.ts): any night the page
   * opens, in the day picker or beyond it (D-075).
   */
  dayLabel: string;
  isTonight: boolean;
  isTomorrow: boolean;
  nightDate: NightDate;
  count: number;
  locale: string;
  params: RawParams;
  /** The place the visitor searched for, when nothing matched it. */
  unmatchedQuery: string | null;
  /** The metro the site opens on, offered when the point is in none (null when it is in one). */
  coveredPlace: string | null;
  /** The night a link asked for when the page opened tonight instead (audit F16). */
  unopenedDay: UnopenedDay | null;
  /** Every city we cover, by name (D-183); fewer than two and the headline is plain text. */
  cities?: CitySummary[];
  /** The city the page is about, or null if none. */
  currentSlug?: string | null;
  /** The city the site opens on, linked as "/". */
  openingSlug?: string | null;
}

/**
 * Why the page shows tonight and not the night its link named; null when it shows that night.
 * `tonight` is the night on screen: a date in another year carries its year.
 */
export function unopenedDayNotice(
  unopened: UnopenedDay | null,
  tonight: NightDate,
  locale: string,
): string | null {
  if (unopened === null) return null;
  if (unopened.reason === "not_a_date") return t("home.day.unopened.notADate");
  const day = formatCalendarDateFrom(unopened.date, tonight, locale);
  return unopened.reason === "over"
    ? t("home.day.unopened.over", { day })
    : t("home.day.unopened.notYet", { day });
}

/** The headline, which the page's title leads with (app/page.tsx generateMetadata, D-076). */
export function headline(
  props: Pick<HeaderProps, "place" | "dayLabel" | "isTonight" | "isTomorrow">,
): string {
  const place = props.place;
  if (place === null) return t("home.location.noMetro");
  if (props.isTonight) return t("home.header.tonight", { place });
  if (props.isTomorrow) return t("home.header.tomorrow", { place });
  return t("home.header.day", { day: props.dayLabel, place });
}

/**
 * Splits the headline into parts before, the place, and after.
 * Returns null when place is null.
 */
export function headlineParts(
  props: Pick<HeaderProps, "place" | "dayLabel" | "isTonight" | "isTomorrow">,
): { before: string; place: string; after: string } | null {
  const place = props.place;
  if (place === null) return null;
  // The same template as headline(), with a marker where the place goes, cut around it.
  const marker = "\u0000";
  const filled = headline({ ...props, place: marker });
  const at = filled.indexOf(marker);
  return { before: filled.slice(0, at), place, after: filled.slice(at + marker.length) };
}

export const PAGE_HEADER_ID = "page-header";

export function Header(props: HeaderProps) {
  const parts = headlineParts(props);
  const cities = props.cities ?? [];
  const canSwitch = cities.length >= 2 && parts !== null;
  return (
    <header id={PAGE_HEADER_ID} className="px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      <h1 className="type-detail-title text-ink break-words">
        {parts === null || !canSwitch ? (
          headline(props)
        ) : (
          <>
            {parts.before}
            <CityButton place={parts.place} />
            {parts.after}
          </>
        )}
      </h1>

      {canSwitch && (
        <CityPicker
          cities={cities}
          currentSlug={props.currentSlug ?? null}
          openingSlug={props.openingSlug ?? null}
        />
      )}

      <p className="type-secondary text-toner mt-2 flex flex-wrap items-baseline justify-between gap-x-4">
        <span>{t("home.header.count", { count: props.count })}</span>
        {/* The date once: a night after tomorrow is named by its date in the headline already. */}
        {props.isTonight || props.isTomorrow ? (
          <span>{formatCalendarDate(props.nightDate, props.locale)}</span>
        ) : null}
      </p>

      {/* Never another night in silence: the link named one the page does not open (audit F16). */}
      {props.unopenedDay === null ? null : (
        <p className="type-body text-ink mt-2">
          {unopenedDayNotice(props.unopenedDay, props.nightDate, props.locale)}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-stretch gap-2">
        {/* A located page shows tonight too, so it drops the unopened `day` with the rest. */}
        <UseMyLocation dropDay={props.unopenedDay !== null} />
        <SearchPlace params={props.params} />
      </div>

      {props.place === null && props.coveredPlace !== null ? (
        <p className="type-body text-ink mt-2">
          <Link
            href="/"
            className="type-label text-ink min-h-11 inline-flex items-center underline underline-offset-4"
          >
            {t("home.location.noMetroLink", { place: props.coveredPlace })}
          </Link>
        </p>
      ) : null}

      {/* A search is always answered, in a metro or outside every one (review, 2026-09-28). */}
      {props.unmatchedQuery === null ? null : (
        <p className="type-body text-ink mt-2">
          {props.place === null
            ? t("home.location.noResultsOutside", { query: props.unmatchedQuery })
            : t("home.location.noResults", { query: props.unmatchedQuery, place: props.place })}
        </p>
      )}
    </header>
  );
}
