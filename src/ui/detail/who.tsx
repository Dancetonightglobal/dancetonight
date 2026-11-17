// WHO: the organiser and their links. Nothing here is the organiser's own prose, only their name
// and where to find them (CLAUDE.md: facts and our own summaries, never source descriptions).

import type { Listing } from "@/src/domain/listing";
import { t } from "@/src/i18n";
import { ExternalLink, SectionHead } from "@/src/ui/primitives";
import { hostOf } from "@/src/ui/links";

const SOCIAL_LABELS: Record<string, () => string> = {
  instagram: () => t("detail.who.instagram"),
  facebook: () => t("detail.who.facebook"),
};

export function WhoSection({ listing }: { listing: Listing }) {
  const organizer = listing.organizer;
  const link = "type-body text-ink min-h-11 inline-flex items-center underline underline-offset-4";
  const socials = Object.entries(organizer?.socials ?? {});
  return (
    <section>
      <div className="px-4">
        <SectionHead>{t("detail.who.heading")}</SectionHead>
      </div>
      <div className="mt-3 px-4">
        <p className="type-body text-ink">{organizer?.name ?? t("common.notListed")}</p>
        {organizer?.websiteUrl == null ? null : (
          <p>
            <ExternalLink
              className={link}
              href={organizer.websiteUrl}
              label={hostOf(organizer.websiteUrl)}
            />
          </p>
        )}
        {socials.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-6">
            {socials.map(([network, url]) => (
              <ExternalLink
                key={network}
                className={link}
                href={url}
                label={SOCIAL_LABELS[network]?.() ?? hostOf(url)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
