// WHEN: the same stamped-time rail as the home bill, with the now rule inserted between the rows
// it falls between, so a dancer can see at a glance whether they are late for the lesson
// (DESIGN.md sections 7 and 9). The rail column is the detail rail token (grid-cols-rail-detail,
// wide enough for "12:30am", whose am/pm the home rail's 5ch never has to hold) and the rule
// brings its own 8px of clear paper, so nothing ever touches it.
//
// A listing whose time is not listed (D-060) opens with a "Time not listed" row whose rail cell
// is empty, carries no now rule (there is no stamped row to place it between), strikes nothing
// when cancelled, and prints the "Times are in" line only when some row stamps a time.

import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { NowRule, SectionHead, StampedTime } from "@/src/ui/primitives";
import {
  nowTime,
  nowRuleIndex,
  showsNowRule,
  timesInZoneAt,
  whenRows,
  zoneLabel,
} from "@/src/ui/detail/format";

export function WhenSection({ listing, now }: { listing: Listing; now: Date }) {
  const rows = whenRows(listing);
  const ruleAt = showsNowRule(listing, now) ? nowRuleIndex(rows, now) : null;
  // A cancelled night keeps its slot with its times struck through; with no time listed there is
  // nothing to strike, and the title block's "Cancelled tonight" carries it (DESIGN.md section 11).
  const strike = listing.confirmation === "cancelled" && listing.startsAt !== null;
  const zoneAt = timesInZoneAt(listing, rows);
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.when.heading")}</SectionHead>
      </div>
      <ol className="mt-3 list-none">
        {rows.map((row, index) => (
          <li key={row.key}>
            {ruleAt === index ? <NowRule time={nowTime(listing, now)} /> : null}
            <div className="grid-cols-rail-detail grid min-h-11 items-center gap-3 px-4">
              <span className={strike ? "line-through" : undefined}>
                {row.time === null ? null : <StampedTime time={row.time} small />}
              </span>
              <span className="type-body text-ink">{row.label}</span>
            </div>
          </li>
        ))}
        {ruleAt === rows.length ? (
          <li>
            <NowRule time={nowTime(listing, now)} />
          </li>
        ) : null}
      </ol>
      {zoneAt === null ? null : (
        <p className="type-secondary text-toner mt-2 px-4">
          {t("detail.when.timesInZone", { zone: zoneLabel(listing.tz, zoneAt) })}
        </p>
      )}
    </section>
  );
}
