// The slim paper strip across the top of the phone's map view (DESIGN.md section 6, D-068): the
// night and the place the pins are for, and how many there are, "Tonight near New York · 5
// places". The whole strip is the way back to the list, where the day and the filters live.
//
// A server component: the words are the page's, rendered with it. Only the link that switches the
// view in place is a client piece (ViewLink).

import { t } from "@/src/i18n";
import { headline } from "@/src/ui/home/Header";
import { ViewLink } from "@/src/ui/map/ListMapToggle";

export interface MapStripProps {
  /** The metro name, or null when no metro is within reach of the point. */
  place: string | null;
  /** "Tonight", "Tomorrow" or a short date, as the day picker labels it. */
  dayLabel: string;
  isTonight: boolean;
  isTomorrow: boolean;
  /** The places on the map: the cards in the list that have a pin. */
  count: number;
  /** The cards in the list with no location, so no pin (D-082). */
  unplaced?: number;
  /** This page without `view`. */
  listHref: string;
  /**
   * Why the map shows tonight and not the night its link named (audit F16): on a phone the
   * header's notice is under the map, so the strip says it too.
   */
  notice?: string | null;
}

/**
 * The strip's words: "Tonight near New York · 6 places", then "· 1 not on the map" when some of
 * the list's places have no pin, or only that when none has one (D-082).
 */
export function stripSummary(props: Omit<MapStripProps, "listHref" | "notice">): string {
  // The home header's own headline, so the strip and the header cannot disagree.
  const where = headline(props);
  const unplaced = props.unplaced ?? 0;
  const places = t("map.strip.places", { count: props.count });
  if (unplaced === 0) return t("map.strip.summary", { where, places });
  if (props.count === 0) return t("map.strip.allUnplaced", { where, count: unplaced });
  return t("map.strip.summaryUnplaced", {
    where,
    places,
    unplaced: t("map.strip.notOnMap", { count: unplaced }),
  });
}

export function MapStrip(props: MapStripProps) {
  return (
    <ViewLink
      view="list"
      href={props.listHref}
      className="bg-paper border-halftone flex min-h-11 items-center justify-between gap-3 border-b px-4"
    >
      <span className="flex flex-col py-1">
        <span className="type-strip text-ink">{stripSummary(props)}</span>
        {props.notice ? <span className="type-strip text-ink">{props.notice}</span> : null}
      </span>
      <span className="type-strip text-ink shrink-0 underline underline-offset-4">
        {t("map.strip.toList")}
      </span>
    </ViewLink>
  );
}
