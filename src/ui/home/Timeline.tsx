// The bill of times. An ordered list, because the order is the meaning (DESIGN section 11):
// each hour is an h2 a screen-reader user can jump to, the now rule is a list item, and the
// cards run between them separated by toner hairlines.
//
// Under distance sort the rail, the markers and the now rule are gone and this is a plain
// hairline-separated list: a timeline out of time order would lie.
//
// Listings whose time is not listed (D-060) follow the hour groups under a section head, an h2
// whose visible text is its accessible text, and their cards drop the rail exactly as a
// distance-sort card does: there is no time to stamp in it.

import { Hairline, HourMarker, NowRule, SectionHead, StampedTime } from "@/src/ui/primitives";
import type { Listing } from "@/src/domain/listing";
import { MapCard } from "@/src/ui/map/MapCard";

import { Card } from "./Card";
import type { TimelineRow } from "./timeline-rows";

/** The id the sticky strip observes and the first-paint script scrolls to. */
export const NOW_RULE_ID = "now-rule";

export interface TimelineProps {
  rows: readonly TimelineRow[];
  stampFor: (listing: Listing) => string;
  formatClock: (instant: Date) => string;
  now: Date;
  locale: string;
  railed: boolean;
}

type CardRow = Extract<TimelineRow, { kind: "card" }>;
type GroupItem = { kind: "group"; cards: CardRow[]; stamp: string };
type RowItem = { kind: "row"; row: TimelineRow };
type TimelineItem = GroupItem | RowItem;

function renderRow(
  item: TimelineRow,
  previous: TimelineRow | undefined,
  stampFor: (listing: Listing) => string,
  formatClock: (instant: Date) => string,
  now: Date,
  locale: string,
  railed: boolean,
  stampUnderOverlay: boolean = false,
) {
  if (item.kind === "hour") {
    return (
      <li key={item.key}>
        <HourMarker label={item.label} />
      </li>
    );
  }
  if (item.kind === "now") {
    return (
      <li key={item.key} id={NOW_RULE_ID}>
        <NowRule time={item.label} />
      </li>
    );
  }
  if (item.kind === "section") {
    return (
      <li key={item.key}>
        <div className="px-4">
          <SectionHead className="pt-1.5 pb-1">{item.label}</SectionHead>
        </div>
      </li>
    );
  }
  // item.kind === "card"
  const previousWasCard = previous?.kind === "card";
  const onRail = railed && item.listing.startsAt !== null;
  const repeatStamp =
    previousWasCard &&
    previous.kind === "card" &&
    previous.listing.startsAt !== null &&
    item.listing.startsAt !== null &&
    stampFor(previous.listing) === stampFor(item.listing);
  // Under distance sort (railed=false), untimed cards should show their stamp
  // Under start sort with rail, untimed cards are grouped and don't show stamp
  const grouped = railed && item.listing.startsAt === null;

  return (
    <li key={item.key}>
      {previousWasCard ? <Hairline /> : null}
      <MapCard id={item.listing.id} railed={onRail}>
        <Card
          listing={item.listing}
          stamp={stampFor(item.listing)}
          formatClock={formatClock}
          now={now}
          locale={locale}
          railed={onRail}
          grouped={grouped}
          repeatStamp={repeatStamp}
          stampUnderOverlay={stampUnderOverlay}
        />
      </MapCard>
    </li>
  );
}

export function Timeline({ rows, stampFor, formatClock, now, locale, railed }: TimelineProps) {
  if (!railed) {
    // Distance sort or untimed cards: render exactly as today
    return (
      <ol role="list" className="list-none">
        {rows.map((row, index) =>
          renderRow(row, rows[index - 1], stampFor, formatClock, now, locale, railed, false),
        )}
      </ol>
    );
  }

  // Build items: group consecutive timed cards with same stamp
  const items: TimelineItem[] = [];
  let currentGroup: CardRow[] = [];

  for (const row of rows) {
    if (row.kind !== "card" || row.listing.startsAt === null) {
      // End current group if any
      if (currentGroup.length > 0) {
        items.push({
          kind: "group",
          cards: [...currentGroup],
          stamp: stampFor(currentGroup[0]!.listing),
        });
        currentGroup = [];
      }
      items.push({ kind: "row", row });
    } else {
      // Card with start time
      if (currentGroup.length === 0) {
        currentGroup.push(row);
      } else {
        const lastStamp = stampFor(currentGroup[currentGroup.length - 1]!.listing);
        const currentStamp = stampFor(row.listing);
        if (lastStamp === currentStamp) {
          // Same stamp: continue group
          currentGroup.push(row);
        } else {
          // Different stamp: start new group
          items.push({
            kind: "group",
            cards: [...currentGroup],
            stamp: lastStamp,
          });
          currentGroup = [row];
        }
      }
    }
  }
  if (currentGroup.length > 0) {
    items.push({
      kind: "group",
      cards: [...currentGroup],
      stamp: stampFor(currentGroup[0]!.listing),
    });
  }

  return (
    <ol role="list" className="list-none">
      {items.map((item, index) => {
        const previousItem = items[index - 1];
        const previousRow =
          previousItem?.kind === "row"
            ? previousItem.row
            : previousItem?.kind === "group"
              ? previousItem.cards[previousItem.cards.length - 1]
              : undefined;

        if (item.kind === "row") {
          return renderRow(
            item.row,
            previousRow,
            stampFor,
            formatClock,
            now,
            locale,
            railed,
            false,
          );
        }

        // item.kind === "group"
        const needsHairline = previousRow?.kind === "card";
        const allCancelled = item.cards.every(
          (card) =>
            card.listing.confirmation === "cancelled" ||
            card.listing.liveStatus?.kind === "cancelled",
        );

        return (
          <li key={`group-${index}`}>
            {needsHairline ? <Hairline /> : null}
            <div className="relative">
              <ol role="list" className="list-none">
                {item.cards.map((card, cardIndex) => {
                  const previousInGroup = item.cards[cardIndex - 1];
                  const onRail = railed && card.listing.startsAt !== null;
                  const repeatStamp =
                    cardIndex > 0 &&
                    previousInGroup?.kind === "card" &&
                    previousInGroup.listing.startsAt !== null &&
                    card.listing.startsAt !== null &&
                    stampFor(previousInGroup.listing) === stampFor(card.listing);
                  const stampUnderOverlay = cardIndex === 0;

                  return (
                    <li key={card.key}>
                      {cardIndex > 0 ? <Hairline /> : null}
                      <MapCard id={card.listing.id} railed={onRail}>
                        <Card
                          listing={card.listing}
                          stamp={stampFor(card.listing)}
                          formatClock={formatClock}
                          now={now}
                          locale={locale}
                          railed={onRail}
                          grouped={false}
                          repeatStamp={repeatStamp}
                          stampUnderOverlay={stampUnderOverlay}
                        />
                      </MapCard>
                    </li>
                  );
                })}
              </ol>
              {/* Sticky stamp overlay */}
              <div
                aria-hidden="true"
                data-sticky-stamp=""
                className="pointer-events-none absolute inset-0 hidden gap-x-3 px-4 min-[20rem]:grid min-[20rem]:grid-cols-rail"
              >
                <div className="sticky top-8 self-start pt-3 text-right">
                  <span className={allCancelled ? "line-through" : ""}>
                    <StampedTime time={item.stamp} small={false} />
                  </span>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
