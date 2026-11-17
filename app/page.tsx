// The home screen: "where can I dance tonight, near me?" drawn as the gig flyer of
// docs/DESIGN.md section 6. A server component — the listing, the filtering, the hour markers
// and the now rule are all computed here against the real clock, and only three small pieces
// reach for the browser: the geolocation button, the sticky strip and the minute tick.

import type { Metadata } from "next";
import { cache } from "react";

import { appNow } from "@/src/config/clock";
import { env } from "@/src/config/env";
import { getRepository } from "@/src/data";
import { resolveHomeQuery } from "@/src/ui/home/home-query";
import { unplacedInReach } from "@/src/data/listing-mapper";
import { formatTime } from "@/src/domain/time";
import { formatDayLabel, labelFlags } from "@/src/domain/tonight";
import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";

import { Filters } from "@/src/ui/home/Filters";
import { DayPicker } from "@/src/ui/home/DayPicker";
import { Header, headline, unopenedDayNotice, PAGE_HEADER_ID } from "@/src/ui/home/Header";
import { MinuteTick } from "@/src/ui/home/MinuteTick";
import { MoreFilters } from "@/src/ui/home/MoreFilters";
import { ScrollToNow } from "@/src/ui/home/ScrollToNow";
import { StickyNowStrip } from "@/src/ui/home/StickyNowStrip";
import { Tail } from "@/src/ui/home/Tail";
import { Timeline, NOW_RULE_ID } from "@/src/ui/home/Timeline";
import { MapSplit, MapStrip, fallbackTileStyles, toMapPlaces } from "@/src/ui/map";
import { dominantCurrency } from "@/src/ui/home/format";
import {
  DEFAULT_TZ,
  parseCenter,
  DEFAULT_CENTER,
  hrefWith,
  linkParams,
  resolvePlace,
  type RawParams,
} from "@/src/ui/home/params";
import { buildTimeline, meridiemReference, railStamp } from "@/src/ui/home/timeline-rows";

/** English only in v1 (SPEC section 2); every Intl call takes it explicitly. */
const LOCALE = "en-US";

/** One metro lookup per request, shared by the page and its title. */
const metroAt = cache((lat: number, lng: number) => getRepository().metroFor({ lat, lng }));

/**
 * The tab and a shared link say which night and where, as the headline does (review, 2026-09-28:
 * every home page was titled "DanceTonight"), then whose site it is: "Tonight near New York ·
 * DanceTonight" (D-076). The layout's title template does not reach this page: Next applies a
 * layout's `title.template` to child route segments only, "not the segment it's defined in … a
 * `title` defined in a `page.js` of the same route segment" (node_modules/next/dist/docs, 01-app/
 * 03-api-reference/04-functions/generate-metadata.md), and this page shares the root layout's
 * segment. So the title is written whole from the same template in `src/i18n` and marked
 * `absolute`, which also keeps it from carrying the site's name twice if the page ever moves under
 * a child segment.
 */
export async function generateMetadata(props: PageProps<"/">): Promise<Metadata> {
  const opening = await metroAt(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  const params = resolvePlace(await props.searchParams, opening?.name ?? null);
  const now = appNow();
  const center = parseCenter(params) ?? DEFAULT_CENTER;
  const metro = await metroAt(center.lat, center.lng);
  // Outside every metro the tab is the site's name alone: whether anything is within reach is the
  // page's to say, from its counts, and the title makes no claim it cannot check here.
  if (metro === null) return {};
  const zone = metro.tz;
  const repository = getRepository();
  const query = await resolveHomeQuery(params, now, zone, metro.radiusKm, repository);
  const flags = labelFlags(query.nightDate, now, zone);
  const page = headline({
    place: metro.name,
    dayLabel: formatDayLabel(query.nightDate, now, zone, LOCALE),
    isTonight: flags.isTonight,
    isTomorrow: flags.isTomorrow,
  });
  return { title: { absolute: t("common.titleTemplate", { page, site: t("common.siteName") }) } };
}

export default async function Home(props: PageProps<"/">) {
  // The metro the site opens on: where a search for its name goes, and the way out offered from a
  // point in no metro we list.
  const opening = await metroAt(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
  const searchParams = resolvePlace(await props.searchParams, opening?.name ?? null);
  // The List/Map toggle owns `view` (D-068): every other link is built without it, so a day or a
  // filter always opens on the list, where those controls are.
  const now = appNow();
  const repository = getRepository();

  const center = parseCenter(searchParams) ?? DEFAULT_CENTER;
  const metro = await metroAt(center.lat, center.lng);
  const covered = metro === null ? opening : null;
  const zone = metro?.tz ?? DEFAULT_TZ;
  const query = await resolveHomeQuery(searchParams, now, zone, metro?.radiusKm, repository);
  // Every link and form carries the night on screen: a `day` the page did not open is left out,
  // so no tap lands on it again (audit F16).
  const params = linkParams(withoutView(searchParams), query);

  const cities = await repository.listCities(now);

  const {
    night: { listings, counts },
    days,
  } = await repository.nightWithDays({
    center: query.center,
    radiusKm: query.radiusKm,
    nightDate: query.nightDate,
    now,
    filters: query.filters,
    sort: query.sort,
  });

  // The map's places: the listings with a venue, numbered in list order (D-082). A listing with no
  // location is on the list as "Location not listed" and has no pin.
  const places = toMapPlaces(listings);
  const unplaced = listings.length - places.length;
  // A distance the dancer narrowed leaves out the listings with no location (D-082). When it also
  // leaves the night empty, the tail says how many there are rather than "Nothing on": the night
  // at the metro's whole reach, before any filter, counted only then.
  const unplacedHidden =
    listings.length === 0 &&
    counts.night === 0 &&
    metro !== null &&
    !unplacedInReach(metro, query.radiusKm)
      ? (
          await repository.listNight({
            center: query.center,
            radiusKm: metro.radiusKm,
            nightDate: query.nightDate,
            now,
            sort: query.sort,
          })
        ).listings.filter((listing) => listing.venue === null).length
      : 0;

  const timeline = buildTimeline({
    listings,
    now,
    zone,
    locale: LOCALE,
    sort: query.sort,
    showNow: query.isTonight,
  });

  // One time rule for the whole page: every clock string goes through formatTime, so a 24-hour
  // locale renders 19:42 (DESIGN section 5).
  const formatClock = (instant: Date) => formatTime(instant, zone, LOCALE);
  const stampReference = meridiemReference(query.nightDate, zone, now, query.isTonight);
  // A listing whose time is not listed stamps the phrase in its place, never an assumed hour
  // (D-060); the card draws it in the small stamped-time style with no rail.
  const stampFor = (listing: Listing) =>
    listing.startsAt === null
      ? t("card.stamp.timeNotListed")
      : railStamp(listing.startsAt, zone, LOCALE, stampReference, query.sort === "start");

  // The place the page is about. A point in no metro we list (more than 50 km from any centre)
  // can still have that metro's places within reach, say Greenwich 50 km from Midtown with
  // Queens 25 miles away: the page is then about that metro, and "We don't list places here yet"
  // is kept for a point with nothing within reach on any night (review, 2026-09-28).
  const place =
    metro?.name ??
    (covered !== null && (counts.night > 0 || days.some((day) => day.count > 0))
      ? covered.name
      : null);
  // The chosen night's name, whether or not the picker offers it: a link to a night beyond the
  // picker (tonight + 7 to + 12, D-075) is named by its date, "Wed, Oct 7 near New York", never
  // "2026-10-07". Computed once for the header, the map's strip and the list's tail.
  const dayLabel = formatDayLabel(query.nightDate, now, zone, LOCALE);
  const flags = labelFlags(query.nightDate, now, zone);

  return (
    <>
      {query.isTonight ? <MinuteTick /> : null}

      {/*
        The bill is the map's child: MapSplit owns the split at 1024px, the phone toggle and the
        pin-to-card selection, and reaches MapLibre only when a map is actually shown. `?view=`
        chooses the opening pane so a shared map link lands on the map. A map needs JavaScript,
        which is why the list, not the map, is the no-JavaScript experience.
      */}
      <MapSplit
        places={places}
        unplaced={unplaced}
        fallbackStyles={fallbackTileStyles(env)}
        center={{ lat: query.center.lat, lng: query.center.lng }}
        // As the list's tail decides it: the filters are the reason only when the night has
        // places within reach before them.
        hiddenByFilters={counts.night > 0}
        // The map frames every pin again for a new night, filter or sort, and keeps the dancer's
        // view through the minute refresh, when a night that has ended leaves the list.
        frameKey={`${query.nightDate} ${hrefWith(params, {})}`}
        initialView={query.view === "map" ? "map" : "list"}
        listHref={hrefWith(params, {})}
        mapHref={hrefWith(params, { view: "map" })}
        strip={
          <MapStrip
            place={place}
            dayLabel={dayLabel}
            isTonight={flags.isTonight}
            isTomorrow={flags.isTomorrow}
            count={places.length}
            unplaced={unplaced}
            listHref={hrefWith(params, {})}
            notice={unopenedDayNotice(query.unopenedDay, query.nightDate, LOCALE)}
          />
        }
      >
        {/* The now strip and the skip links belong to the list, so they sit in its pane: while the
            phone's map is up that pane is inert, and none of them can take focus under the map
            (review, 2026-09-28). The pane has no transform, so the strip is still fixed to the
            screen and a focused skip link still floats at its top. */}
        {timeline.nowLabel === null ? null : (
          <StickyNowStrip
            time={timeline.nowLabel}
            targetId={NOW_RULE_ID}
            headerId={PAGE_HEADER_ID}
            place={cities.length >= 2 ? place : null}
          />
        )}
        {/* Focused, a skip link floats over the page rather than pushing it down, clear of the
            screen's edge so its focus ring is whole (review, 2026-09-28). */}
        <a href="#bill" className={SKIP_LINK}>
          {t("a11y.skipToList")}
        </a>
        <a href="#filters" className={SKIP_LINK}>
          {t("a11y.skipToFilters")}
        </a>

        <div className="mx-auto max-w-list">
          <Header
            place={place}
            dayLabel={dayLabel}
            isTonight={flags.isTonight}
            isTomorrow={flags.isTomorrow}
            nightDate={query.nightDate}
            count={listings.length}
            locale={LOCALE}
            params={params}
            unmatchedQuery={unmatchedQuery(query.place, place)}
            coveredPlace={covered?.name ?? null}
            unopenedDay={query.unopenedDay}
            cities={cities}
            currentSlug={place === null ? null : (metro?.slug ?? covered?.slug ?? null)}
            openingSlug={opening?.slug ?? null}
          />

          <DayPicker days={days} selected={query.nightDate} params={params} />
          <Filters query={query} params={params} counts={counts} />
          {query.sheetOpen ? (
            <MoreFilters
              query={query}
              params={params}
              locale={LOCALE}
              currency={dominantCurrency(listings)}
              defaultRadiusKm={metro?.radiusKm ?? query.radiusKm}
            />
          ) : null}

          <main id="bill" className="mt-4">
            {/* The on-now count, announced at most once a minute and nothing else (DESIGN 11).
                Tonight only: another night has no now to count. */}
            {query.isTonight ? (
              <p aria-live="polite" className="sr-only">
                {t("a11y.onNowCount", {
                  count: listings.filter((l) => l.liveStatus?.kind === "on_now").length,
                })}
              </p>
            ) : null}
            <Timeline
              rows={timeline.rows}
              stampFor={stampFor}
              formatClock={formatClock}
              now={now}
              locale={LOCALE}
              railed={query.sort === "start"}
            />
          </main>
          <ScrollToNow targetId={NOW_RULE_ID} enabled={timeline.cardsAboveNow > 0} />

          <Tail
            place={place}
            dayLabel={dayLabel}
            isTonight={flags.isTonight}
            shown={listings.length}
            night={counts.night}
            unplacedHidden={unplacedHidden}
            params={params}
            search={query.filters.text ?? null}
          />
        </div>
      </MapSplit>
    </>
  );
}

const SKIP_LINK =
  "sr-only focus:not-sr-only focus:bg-paper focus:text-ink type-button focus:absolute focus:left-4 focus:top-2 focus:z-20 focus:px-3 focus:py-2";

/** The page's params without `view`, which only the List/Map toggle sets (D-068). */
function withoutView(params: RawParams): RawParams {
  return Object.fromEntries(Object.entries(params).filter(([key]) => key !== "view"));
}

/**
 * A searched place we could not act on. Until the geocoder lands (PLAN section 11, D-016) the
 * only place we can resolve is the metro we are already in, so anything else is reported as
 * "we can't look that up yet" rather than silently ignored.
 * In a metro we list, any search is a text search, so we do not report it as unmatched.
 */
function unmatchedQuery(place: string | null, metroName: string | null): string | null {
  if (place === null) return null;
  if (metroName !== null) return null;
  return place;
}
