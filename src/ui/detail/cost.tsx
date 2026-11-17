// COST: every listed tier with its label, then the ticket link. A price is never invented; with
// nothing listed the row carries the spec's own phrase ("Cover not listed", src/i18n). The amount
// sits in the same rail as WHEN (grid-cols-rail-detail), and each label shares its amount's
// baseline, so the column reads as one printed line per tier (D-069).

import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { ExternalLink, SectionHead } from "@/src/ui/primitives";
import { costRows } from "@/src/ui/detail/format";
import { hostOf, outboundLinks } from "@/src/ui/links";

export function CostSection({ listing }: { listing: Listing }) {
  const rows = costRows(listing);
  // Null once the night is over, and never a listings site's event page (D-069). In the card's
  // words, from the same key, so the two cannot drift (D-073).
  const { tickets } = outboundLinks(listing);
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.cost.heading")}</SectionHead>
      </div>
      <dl className="mt-3 px-4">
        {rows.map((row, index) => (
          <div
            key={`${row.amount ?? ""}-${row.label ?? ""}-${index}`}
            className="grid-cols-rail-detail grid items-baseline gap-3 py-1.5"
          >
            {row.amount === null ? null : <dt className="type-stamp-sm text-ink">{row.amount}</dt>}
            <dd
              className={
                row.amount === null ? "type-body text-ink col-span-2" : "type-body text-ink"
              }
            >
              {row.label}
              {row.includes === null ? null : (
                <span className="type-secondary text-toner block">{row.includes}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      {tickets === null ? null : (
        <p className="mt-2 px-4">
          <ExternalLink
            className="type-body text-ink inline-flex min-h-11 items-center underline underline-offset-4 wrap-anywhere"
            href={tickets}
            label={t("links.ticketsAt", { site: hostOf(tickets) })}
          />
        </p>
      )}
    </section>
  );
}
