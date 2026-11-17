// One night on the bill. No box, no shadow, no rounded corner: a card is a grid
// [rail 5ch][12px gap][content], at least 88px tall, separated from the next by a toner
// hairline, and the WHOLE card is one link (docs/DESIGN.md section 5). Its event line follows it:
// a second link, out to the night's own page, placed after the card's link and never inside it,
// because an <a> may not hold another (D-073).
//
// Reading order, which a reviewer checks top to bottom: stamped time, family line, name,
// status line, lesson line, meta line (venue, distance, price), warning line; then, outside
// the card's link, the event line.
//
// Below 20rem — a 320px phone at 200% zoom — the rail collapses and the stamped time stacks
// above the name, staying the card's first element (DESIGN section 11, "Zoom and reflow").
//
// A listing whose time is not listed (D-060) is drawn as a distance-sort card: no rail, the
// phrase "Time not listed" as the first inline element in the small stamped-time style. It has no
// status line, because the stamp already carries the flag, except "Cancelled tonight"; nothing is
// struck through, because there is no time to strike; and its last line is "Check before you go".

import { familyLabel } from "@/config/styles";
import { ExternalLink, FamilyChip, StampedTime, StatusLine } from "@/src/ui/primitives";
import { eventLink } from "@/src/ui/links";
import { linkNotWorkingText } from "@/src/ui/link-status";
import type { Listing } from "@/src/domain/listing";
import { listingTypeLabel } from "@/config/styles";
import { t } from "@/src/i18n";
// The type-word rule is shared with the detail title block, so it lives beside the stocks (D-069).
import { typeWordShown, stockBarClass } from "@/src/ui/stocks";

import { cardPrice, cardWarning, formatDistance, lessonLine, venueLine } from "./format";

export interface CardProps {
  listing: Listing;
  /** The rail stamp, already through formatTime (docs/DESIGN.md's one time rule). */
  stamp: string;
  /** Clock formatter for the lesson line, likewise through formatTime. */
  formatClock: (instant: Date) => string;
  now: Date;
  locale: string;
  /**
   * Distance sort drops the rail, and so does a listing whose time is not listed; the stamp
   * becomes the card's first inline element.
   */
  railed: boolean;
  /**
   * The card sits in the "Time not listed" group under start sort, whose head already says so:
   * the phrase is left out of the card's visible first line and kept in its accessible name
   * (review, 2026-09-28; the owner saw it printed twice).
   */
  grouped?: boolean;
  /**
   * When true and the card is on the rail, the stamp is hidden (invisible) because it repeats
   * the previous card's stamp.
   */
  repeatStamp?: boolean;
  /**
   * When true and the card is on the rail and not a repeat, the stamp is made transparent
   * because a sticky overlay draws the visible copy. The card's own stamp stays in the DOM
   * for text selection and below-320px layouts.
   */
  stampUnderOverlay?: boolean;
}

export function Card({
  listing,
  stamp,
  formatClock,
  now,
  locale,
  railed,
  grouped = false,
  repeatStamp = false,
  stampUnderOverlay = false,
}: CardProps) {
  const primary = listing.families[0];
  const status = listing.liveStatus;
  const cancelled = listing.confirmation === "cancelled" || status?.kind === "cancelled";
  const untimed = listing.startsAt === null;
  // On a card whose time is not listed the stamp carries the flag, and "Cancelled tonight" is the
  // only status line it shows (DESIGN section 5, D-060 point 5).
  const statusLine = status === null || (untimed && status.kind !== "cancelled") ? null : status;

  const extras: string[] = [];
  if (typeWordShown(listing.listingType, primary))
    extras.push(listingTypeLabel(listing.listingType));
  for (const family of listing.families.slice(1)) extras.push(familyLabel(family));
  if (listing.ageMin !== null && listing.ageMin > 0) {
    extras.push(t("detail.expect.ageMin", { age: listing.ageMin }));
  }
  if (listing.partnerRequired === false) extras.push(t("card.flags.noPartnerNeeded"));

  const lesson = lessonLine(listing, formatClock);
  const price = cardPrice(listing, locale);
  const warning = cardWarning(listing);
  const distance = listing.distanceKm === null ? null : formatDistance(listing.distanceKm, locale);

  // The stamped time, the family line, the name and the status line, in that order (DESIGN section 11). A card
  // with no status line to read is named by its stamp and name alone, never with a dangling comma.
  const accessibleName = cancelled
    ? t("a11y.cardCancelled", { time: stamp, title: listing.title })
    : statusLine === null
      ? t("a11y.cardNoStatus", { time: stamp, title: listing.title })
      : t("a11y.card", { time: stamp, title: listing.title, status: statusLine.text });

  // The phrase has no place in the rail, so an untimed card never takes one, whoever draws it.
  const onRail = railed && !untimed;
  const grid = onRail ? "grid-cols-1 min-[20rem]:grid-cols-rail" : "grid-cols-1";
  const showStamp = !(grouped && untimed);
  // The one link out, in the words the map's card and the event page use too (src/ui/links.ts).
  const link = eventLink(listing);
  // D-768: the link stays; a line under it says the daily check found it not working.
  const linkDown = link === null ? null : linkNotWorkingText(listing, now);

  return (
    <>
      <a
        href={`/e/${listing.slug}`}
        aria-label={accessibleName}
        className={`grid min-h-22 gap-x-3 gap-y-1 px-4 pt-3 ${link === null ? "pb-3" : "pb-1"} ${grid}`}
      >
        {showStamp ? (
          <div className={onRail ? "min-[20rem]:text-right" : ""}>
            <span className={cancelled && !untimed ? "line-through" : ""}>
              {repeatStamp && onRail ? (
                <span className="invisible" aria-hidden="true">
                  <StampedTime time={stamp} small={!onRail} />
                </span>
              ) : (
                <span className={stampUnderOverlay && onRail ? "min-[20rem]:text-transparent" : ""}>
                  <StampedTime time={stamp} small={!onRail} />
                </span>
              )}
            </span>
          </div>
        ) : null}

        <div
          className={
            primary === undefined
              ? "border-s-3 ps-3 border-halftone"
              : `border-s-3 ps-3 ${stockBarClass(primary)}`
          }
        >
          {(primary !== undefined || extras.length > 0) && (
            <p className="type-label">
              {primary !== undefined && <FamilyChip family={primary} />}
              {extras.map((extra, idx) => (
                <span key={extra}>
                  {idx === 0 && primary !== undefined && (
                    <span aria-hidden="true" className="text-toner">
                      {" · "}
                    </span>
                  )}
                  {idx > 0 && (
                    <span aria-hidden="true" className="text-toner">
                      {" · "}
                    </span>
                  )}
                  <span className="text-toner">{extra}</span>
                </span>
              ))}
            </p>
          )}

          <span className="type-card-name text-ink block break-words mt-0.5">{listing.title}</span>

          {statusLine === null ? null : (
            <div className="mt-1">
              <StatusLine status={statusLine} />
            </div>
          )}

          {lesson === null ? null : <p className="type-secondary text-toner mt-0.5">{lesson}</p>}

          {(venueLine(listing) !== null || distance !== null || price !== null) && (
            <p className="type-secondary text-toner mt-0.5">
              {[venueLine(listing), distance, price]
                .filter((x): x is string => x !== null)
                .map((part, idx) => (
                  <span key={idx}>
                    {idx > 0 && (
                      <span aria-hidden="true" className="text-toner">
                        {" · "}
                      </span>
                    )}
                    {part}
                  </span>
                ))}
            </p>
          )}

          {warning !== null && <p className="type-secondary text-ink mt-0.5">{warning}</p>}
        </div>
      </a>
      {/* The event line: a sibling of the card's link, in its own <div> so MapCard's pin number
        (drawn on its first <a>'s first cell) can never land on it. It sits in the name's column,
        on the rail and off it, in toner: spot is spent on the time and the way in (DESIGN
        section 9). Its name carries the night's title, so a list of such links still says which
        night each one is for (WCAG 2.4.4). */}
      {link === null ? null : (
        <div className={`grid gap-x-3 px-4 pb-2 ${grid}`}>
          <ExternalLink
            className={`type-secondary text-toner inline-flex min-h-11 items-center justify-self-start ms-3.75 underline wrap-anywhere ${onRail ? "min-[20rem]:col-start-2" : ""}`}
            href={link.href}
            label={t("a11y.eventLinkFor", { link: link.text, title: listing.title })}
          >
            {link.text}
          </ExternalLink>
          {linkDown === null ? null : (
            <p
              className={`type-secondary text-toner ms-3.75 ${onRail ? "min-[20rem]:col-start-2" : ""}`}
            >
              {linkDown}
            </p>
          )}
        </div>
      )}
    </>
  );
}
