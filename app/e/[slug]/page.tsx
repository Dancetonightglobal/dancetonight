// The event detail page (DESIGN.md section 7). A server component: nothing here needs the
// browser, so only the back link, "Share" and the map ship JavaScript, and each works as a plain
// link or sheet without it. `connection()` pins the render to request time, because every status
// sentence, the date line and the now rule are read off the clock.
//
// What an address leads to is settled before this renders, in proxy.ts (D-092): a merged
// listing's address redirects to the listing that stands, and a slug we do not have answers 404
// with the full missing-listing page. A listing that goes in the moment between the two still
// renders the missing-listing message here, with a noindex, rather than calling notFound(), which
// in a request-time render Next 16 answers with an empty `__next_error__` shell (D-069).

import type { Metadata } from "next";
import { cache } from "react";
import { connection } from "next/server";

import { appNow } from "@/src/config/clock";
import { env } from "@/src/config/env";
import { getRepository } from "@/src/data";
import { t } from "@/src/i18n";
import { Actions } from "@/src/ui/detail/actions";
import { BackLink } from "@/src/ui/detail/back-link";
import { CostSection } from "@/src/ui/detail/cost";
import { ExpectSection } from "@/src/ui/detail/expect";
import { backLink, pageTitle } from "@/src/ui/detail/format";
import { EventJsonLd } from "@/src/ui/detail/jsonld";
import { MissingPage } from "@/src/ui/detail/missing-page";
import { pageUrl } from "@/src/ui/detail/page-url";
import { ShareButton } from "@/src/ui/detail/share-button";
import { SourcesSection } from "@/src/ui/detail/sources";
import { SummarySection } from "@/src/ui/detail/summary";
import { TitleBlock } from "@/src/ui/detail/title-block";
import { WhenSection } from "@/src/ui/detail/when";
import { WhereSection } from "@/src/ui/detail/where";
import { WhoSection } from "@/src/ui/detail/who";
import { fallbackTileStyles } from "@/src/ui/map";

const listingFor = cache((slug: string) => getRepository().getBySlug(slug, appNow()));

export async function generateMetadata({ params }: PageProps<"/e/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const listing = await listingFor(slug);
  if (listing === null) return { title: t("errors.listingNotFound"), robots: { index: false } };
  return {
    // "Tango Cafe · Wed, Sep 30"; the layout's template adds " · DanceTonight" (D-069, D-072).
    title: pageTitle(listing),
    ...(listing.summary === null ? {} : { description: listing.summary }),
    alternates: { canonical: await pageUrl(slug) },
  };
}

export default async function EventPage({ params }: PageProps<"/e/[slug]">) {
  await connection();
  const { slug } = await params;
  const now = appNow();
  const listing = await listingFor(slug);
  if (listing === null) return <MissingPage message={t("errors.listingNotFound")} />;

  const url = await pageUrl(slug);
  const back = backLink(listing, now);

  // "Report a problem" and "Suggest a correction" come back when their pages exist (open task
  // #13); a link to a 404 on every event page was worse than no link (D-069).
  return (
    <main className="max-w-list mx-auto pb-16">
      <nav className="flex items-center justify-between gap-3 px-4 pt-4">
        <BackLink href={back.href} label={back.label} />
        <ShareButton url={url} title={pageTitle(listing)} />
      </nav>

      <TitleBlock listing={listing} now={now} />
      <Actions listing={listing} />
      <WhenSection listing={listing} now={now} />
      <CostSection listing={listing} />
      <WhereSection listing={listing} fallbackStyles={fallbackTileStyles(env)} />
      <ExpectSection listing={listing} />
      <WhoSection listing={listing} />
      <SummarySection listing={listing} />
      <SourcesSection listing={listing} now={now} />

      <EventJsonLd listing={listing} url={url} />
    </main>
  );
}
