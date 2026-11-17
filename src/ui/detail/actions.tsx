// The action row (DESIGN.md section 7). "Get directions" opens the two-choice sheet the design
// asks for; it is a <details> rather than a dialog so it needs no JavaScript and no focus trap.
// "Add to calendar" is a plain link to the night's .ics file, served by a route as text/calendar,
// so it needs no JavaScript either and iOS Safari opens Calendar with it (D-069).
//
// A night that is over (cancelled or ended) sells nothing: "Get tickets" is left out, and
// directions and calendar step down to secondary buttons, so the loudest thing on a cancelled
// page is not an invitation to go (D-069).
//
// The links out are the card's (D-073, src/ui/links.ts), so the page never calls a link by one
// name and the card by another: a page selling the night is "Get tickets"; the event's own page
// is a secondary button beside it, "Event page at {site}"; and a listing known only from a page
// that lists it gets an ink line under the row, "Listed on {site}", scrolled to its title.

import { appNow } from "@/src/config/clock";
import { isPlaced, type Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "@/src/ui/detail/buttons";
import { calendarPath, directionsUrls } from "@/src/ui/detail/format";
import { eventLink, hostOf, nightOutcome, outboundLinks } from "@/src/ui/links";
import { ExternalLink } from "@/src/ui/primitives";
import { linkNotWorkingText } from "@/src/ui/link-status";

export function Actions({ listing }: { listing: Listing }) {
  // No venue, no route: a listing with no location has no "Get directions" (D-082).
  const maps = isPlaced(listing) ? directionsUrls(listing) : null;
  const { tickets, eventPage } = outboundLinks(listing);
  const link = eventLink(listing);
  const linkDown = link === null ? null : linkNotWorkingText(listing, appNow());
  const over = nightOutcome(listing) !== null;
  const directions = over ? SECONDARY_BUTTON : PRIMARY_BUTTON;
  const mapLink = "type-button text-ink min-h-11 flex items-center px-4 underline";
  return (
    <div className="mt-6 px-4">
      <div className="flex flex-wrap items-start gap-2">
        {maps === null ? null : (
          <details className="min-w-0 grow basis-40">
            <summary
              className={`${directions} list-none [&::-webkit-details-marker]:hidden w-full`}
            >
              {t("detail.actions.getDirections")}
            </summary>
            <div className="bg-paper chip-edge rounded-control mt-2 overflow-hidden">
              <ExternalLink
                className={mapLink}
                href={maps.google}
                label={t("detail.where.googleMaps")}
              />
              <div aria-hidden="true" className="bg-halftone h-px" />
              <ExternalLink
                className={mapLink}
                href={maps.apple}
                label={t("detail.where.appleMaps")}
              />
            </div>
          </details>
        )}
        {tickets === null ? null : (
          <ExternalLink
            className={`${PRIMARY_BUTTON} grow basis-40`}
            href={tickets}
            label={t("detail.actions.getTickets")}
          />
        )}
        {/* The event's own page, never "Get tickets": it may sell nothing. A long host wraps
            inside the button rather than pushing the page sideways. When its text does not fit
            beside another button, it takes its own line (basis-auto). */}
        {eventPage === null ? null : (
          <ExternalLink
            className={`${SECONDARY_BUTTON} min-w-0 wrap-anywhere grow basis-auto`}
            href={eventPage}
            label={t("links.eventPageAt", { site: hostOf(eventPage) })}
          />
        )}
        <a
          className={`${SECONDARY_BUTTON} grow basis-40`}
          href={calendarPath(listing)}
          type="text/calendar"
        >
          {t("detail.actions.addToCalendar")}
        </a>
      </div>
      {/* Only a page that lists the night among others: named for what it is, never "Event page". */}
      {link?.kind !== "listed" ? null : (
        <p className="mt-2">
          <ExternalLink
            className="type-secondary text-toner inline-flex min-h-11 items-center underline wrap-anywhere"
            href={link.href}
            label={link.text}
          />
        </p>
      )}
      {/* D-768: the daily check found the card's own link not working; the link stays. */}
      {linkDown === null ? null : <p className="type-secondary text-toner mt-2">{linkDown}</p>}
    </div>
  );
}
