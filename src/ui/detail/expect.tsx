// WHAT TO EXPECT: a label and value list. A value we do not have says "Not listed" rather than
// disappearing, because a missing dress code or floor is itself information (DESIGN.md 9).

import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { SectionHead } from "@/src/ui/primitives";
import { expectRows } from "@/src/ui/detail/format";

export function ExpectSection({ listing }: { listing: Listing }) {
  const rows = expectRows(listing);
  const notListedRows = rows.filter((row) => row.value === t("common.notListed"));
  const knownRows = rows.filter((row) => row.value !== t("common.notListed"));
  const fields = notListedRows.map((row) => row.label.toLowerCase()).join(", ");
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.expect.heading")}</SectionHead>
      </div>
      {knownRows.length > 0 ? (
        <dl className="mt-3 grid grid-cols-[11ch_1fr] gap-x-3 gap-y-2 px-4">
          {knownRows.map((row) => (
            // items-baseline: the 14px label and the 16px value share one baseline (D-069).
            <div key={row.key} className="col-span-2 grid grid-cols-subgrid items-baseline">
              <dt className="type-label text-toner">{row.label}</dt>
              <dd className="type-body text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {notListedRows.length > 0 ? (
        <p className="type-secondary text-toner mt-3 px-4">
          {t("detail.expect.notListedFields", { fields })}
        </p>
      ) : null}
    </section>
  );
}
