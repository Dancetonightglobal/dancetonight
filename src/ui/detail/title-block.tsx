// The flyer headline (DESIGN.md section 7): the family chip with its label, the name in display
// caps, then the night it is on, the recurrence line when a source states one, and the live
// status. Reading order is the card's, so a dancer who taps through from the bill meets the same
// facts in the same order, with the date the card's day picker already told them.

import { familyLabel } from "@/config/styles";
import type { Listing } from "@/src/domain/listing";
import { FamilyChip, StatusLine } from "@/src/ui/primitives";
import { dateLine, titleTypeWord } from "@/src/ui/detail/format";
import { nightOutcome } from "@/src/ui/links";
import { venueLine } from "@/src/ui/home/format";
import { stockBarClass } from "@/src/ui/stocks";

export function TitleBlock({ listing, now }: { listing: Listing; now: Date }) {
  const [primary, ...rest] = listing.families;
  const typeWord = titleTypeWord(listing);
  // A cancelled or ended night says so on the date line, beside the date ("Thu, Oct 1 ·
  // Cancelled"); the status line would repeat the word without it (D-069).
  const status = nightOutcome(listing) === null ? listing.liveStatus : null;
  const hasTags = primary !== undefined || typeWord !== null || rest.length > 0;
  const barClass = primary !== undefined ? stockBarClass(primary) : "border-halftone";
  return (
    <header className="px-4">
      <div className={`border-s-3 ps-3.5 ${barClass}`}>
        {hasTags ? (
          <p className="type-label mb-1 flex flex-wrap items-center gap-x-1.5">
            {primary === undefined ? null : <FamilyChip family={primary} />}
            {primary !== undefined && typeWord !== null ? (
              <span aria-hidden="true" className="text-toner">
                ·
              </span>
            ) : null}
            {typeWord === null ? null : <span className="type-label text-toner">{typeWord}</span>}
            {/* Extra families are plain text: a family colour never appears without its label. */}
            {rest.map((family, index) => (
              <span key={family} className="inline-flex items-center gap-x-1.5">
                {index > 0 || primary !== undefined || typeWord !== null ? (
                  <span aria-hidden="true" className="text-toner">
                    ·
                  </span>
                ) : null}
                <span className="type-label text-toner">{familyLabel(family)}</span>
              </span>
            ))}
          </p>
        ) : null}
        {/* Wraps to two lines and never ellipses; break-words keeps a long name off the gutter at 320px. */}
        <h1 className="type-detail-title text-ink break-words">{listing.title}</h1>
        <p className="type-body text-ink mt-2">{dateLine(listing, now)}</p>
        {/* The place, when we have one; "Location not listed" is said once, under Where. */}
        {listing.venue === null ? null : (
          <p className="type-body text-toner">{venueLine(listing)}</p>
        )}
        {/* Only a stated recurrence: we hold no fact that says a night is a one-off (D-069). */}
        {listing.recurrenceText === null ? null : (
          <p className="type-secondary text-toner mt-1">{listing.recurrenceText}</p>
        )}
      </div>
      {status === null ? null : (
        <div className="mt-2">
          <StatusLine status={status} />
        </div>
      )}
    </header>
  );
}
