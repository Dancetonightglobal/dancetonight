// Our own two-sentence summary, written from the listed facts and never from a source's words
// (CLAUDE.md). The note under it says so, because a dancer should know whose sentence this is.

import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { SectionHead } from "@/src/ui/primitives";

export function SummarySection({ listing }: { listing: Listing }) {
  if (listing.summary === null) return null;
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.summary.heading")}</SectionHead>
      </div>
      <div className="mt-3 px-4">
        <p className="type-body text-ink">{listing.summary}</p>
        <p className="type-secondary text-toner mt-2">{t("detail.summary.note")}</p>
      </div>
    </section>
  );
}
