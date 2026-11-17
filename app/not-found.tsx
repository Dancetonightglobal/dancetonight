// Any address we do not have: a mistyped link, an old bookmark, a page that has not shipped yet.
// The same paper and the same one way back as a listing that is gone (src/ui/detail/missing-page),
// so a stray 404 is still our flyer and not the framework's grey page (D-069).
//
// A listing that is gone is served here too, with its real 404 (proxy.ts, D-092): the proxy marks
// that request, and the page then says the listing is gone rather than that the page is unknown.
// A past night the retention job archived (M1) is marked "passed" with its slug; the page looks the
// night up again by slug (never trusting anything else from the header) and says it has passed.

import type { Metadata } from "next";
import { headers } from "next/headers";
import { cache } from "react";

import { getProxyRepository } from "@/src/data";
import type { SlugAnswer } from "@/src/data/repository";
import { t } from "@/src/i18n";
import { MissingPage } from "@/src/ui/detail/missing-page";
import { PassedPage } from "@/src/ui/detail/passed-page";

type Passed = Extract<SlugAnswer, { kind: "passed" }>;

/** What the proxy marked this request: a passed night (looked up again), a gone listing, or neither. */
const marked = cache(async (): Promise<{ passed: Passed | null; listing: boolean }> => {
  const request = await headers();
  const mark = request.get("x-dancetonight-missing");
  const slug = request.get("x-dancetonight-slug");
  if (mark === "passed" && slug) {
    try {
      const answer = await getProxyRepository().resolveSlug(slug);
      if (answer.kind === "passed") return { passed: answer, listing: true };
    } catch {
      // The database is unreachable: say the listing is gone, as before M1.
    }
  }
  return { passed: null, listing: mark === "listing" || mark === "passed" };
});

function message(listing: boolean): string {
  return listing ? t("errors.listingNotFound") : t("errors.notFound");
}

export async function generateMetadata(): Promise<Metadata> {
  // A 404 is kept out of search results by Next itself, which adds the noindex.
  const { passed, listing } = await marked();
  return { title: passed ? t("errors.nightPassed") : message(listing) };
}

export default async function NotFound() {
  const { passed, listing } = await marked();
  if (passed) return <PassedPage night={passed} />;
  return <MissingPage message={message(listing)} />;
}
