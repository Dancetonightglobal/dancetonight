// WHERE: the venue, the address, the distance, and the halftone sheet that becomes a map when a
// dancer taps it. The sheet and the MapLibre canvas both live in DetailMap, which is the only
// client component on this page; everything here is rendered on the server.

import { isPlaced, type Listing } from "@/src/domain/listing";
import { formatTime } from "@/src/domain/time";
import { t } from "@/src/i18n";
import { ExternalLink, SectionHead } from "@/src/ui/primitives";
import { DetailMap, PIN_NUMBER } from "@/src/ui/detail/DetailMap";
import type { TileStyles } from "@/src/ui/map";
import {
  addressBesideName,
  formatDistance,
  placeUrls,
  venueAddress,
  venueLine,
} from "@/src/ui/detail/format";

export function WhereSection({
  listing,
  fallbackStyles,
}: {
  listing: Listing;
  /** From `fallbackTileStyles(env)` on the page, or null when none is configured (D-013). */
  fallbackStyles: TileStyles | null;
}) {
  if (!isPlaced(listing)) {
    // No pin, no address, no map links: the line says so, and the event's link above is where a
    // dancer finds out where it is (D-082).
    return (
      <section>
        <div className="px-4">
          <SectionHead>{t("detail.where.heading")}</SectionHead>
        </div>
        <p className="type-body text-ink mt-3 px-4">{venueLine(listing)}</p>
      </section>
    );
  }
  const address = venueAddress(listing);
  // A venue named by its own address prints it once, on the name's line (brief F17).
  const sameAsName = address !== null && addressBesideName(listing) === null;
  const distance = listing.distanceKm === null ? null : formatDistance(listing.distanceKm);
  const maps = placeUrls(listing);
  const mapLink =
    "type-body text-ink min-h-11 inline-flex items-center underline underline-offset-4";
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.where.heading")}</SectionHead>
      </div>
      <div className="mt-3 px-4">
        <DetailMap
          place={{
            id: listing.id,
            number: PIN_NUMBER,
            title: listing.title,
            time: listing.startsAt === null ? null : formatTime(listing.startsAt, listing.tz),
            venueName: listing.venue.name,
            location: listing.venue.location,
          }}
          fallbackStyles={fallbackStyles}
        />
        <p className="type-body text-ink mt-3">{venueLine(listing)}</p>
        {sameAsName && distance === null ? null : (
          <p className="type-secondary text-toner">
            {sameAsName ? null : (address ?? t("common.notListed"))}
            {distance === null ? null : (
              <span className={sameAsName ? undefined : "ml-3"}>{distance}</span>
            )}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-x-6">
          <ExternalLink
            className={mapLink}
            href={maps.google}
            label={t("detail.where.googleMaps")}
          />
          <ExternalLink className={mapLink} href={maps.apple} label={t("detail.where.appleMaps")} />
        </div>
      </div>
    </section>
  );
}
