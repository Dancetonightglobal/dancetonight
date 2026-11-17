// SOURCES: every source with when we last checked it. When two sources disagree, each row prints
// its own value beneath it, so the source name is the label and no value is silently preferred
// (DESIGN.md sections 7 and 11). The values are ink, never toner: they are the disagreement.

import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { ExternalLink, Hairline, SectionHead } from "@/src/ui/primitives";
import { formatAgo, sourceValueRows, sourcesDisagree } from "@/src/ui/detail/format";

export function SourcesSection({ listing, now }: { listing: Listing; now: Date }) {
  const disagree = sourcesDisagree(listing);
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.sources.heading")}</SectionHead>
      </div>
      {disagree ? (
        <p className="type-secondary text-ink mt-3 px-4">{t("detail.sources.conflictNote")}</p>
      ) : null}
      <ol className="mt-3 list-none">
        {listing.sources.map((source) => {
          const values = sourceValueRows(source);
          return (
            <li key={source.url}>
              <Hairline />
              {/* Only the name is the link. Its name, "Open X, opens in a new tab", replaces
                  whatever the link holds for a screen reader, so the checked time and this
                  source's own values sit beside it as text, where they are read out (WCAG 1.3.1;
                  review, 2026-09-28). */}
              <div className="px-4 py-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <ExternalLink
                    className="type-body text-ink inline-flex min-h-11 items-center underline"
                    href={source.url}
                    label={t("detail.sources.viewSource", { source: source.label })}
                  >
                    {source.label}
                  </ExternalLink>
                  <span className="type-secondary text-toner">
                    {t("detail.sources.checked", { ago: formatAgo(source.checkedAt, now) })}
                  </span>
                </div>
                {values.length === 0 ? null : (
                  <div className="pb-2">
                    {values.map((value) => (
                      <p key={value.field} className="type-secondary text-ink">
                        {value.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <Hairline />
    </section>
  );
}
