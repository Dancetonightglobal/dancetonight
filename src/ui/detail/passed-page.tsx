// The page for a past night the retention job archived (maintenance M1). Shows the night's title,
// date and venue, and a link to tonight in its city. A server component, so the message, the
// button and the title are in the HTML itself.

import Link from "next/link";

import type { SlugAnswer } from "@/src/data/repository";
import { t } from "@/src/i18n";
import { SECONDARY_BUTTON } from "@/src/ui/detail/buttons";

export function PassedPage({ night }: { night: Extract<SlugAnswer, { kind: "passed" }> }) {
  const date = new Date(`${night.nightDate}T12:00:00Z`);
  const formattedDate = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);

  return (
    <main className="max-w-list mx-auto px-4 py-6">
      <h1 className="type-card-name text-ink">{t("errors.nightPassed")}</h1>
      <p className="mt-3 text-ink">
        {night.title} · {formattedDate}
        {night.venueName !== null && ` · ${night.venueName}`}
      </p>
      <p className="mt-6">
        <Link className={SECONDARY_BUTTON} href={`/${encodeURIComponent(night.metroSlug)}`}>
          {t("errors.seeTonight")}
        </Link>
      </p>
    </main>
  );
}
