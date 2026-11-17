// Any address we do not have: a mistyped link, an old bookmark, a page that has not shipped yet.
// The same paper and the same one way back as a listing that is gone (src/ui/detail/missing-page),
// so a stray 404 is still our flyer and not the framework's grey page (D-069).
//
// A listing that is gone is served here too, with its real 404 (proxy.ts, D-092): the proxy marks
// that request, and the page then says the listing is gone rather than that the page is unknown.

import type { Metadata } from "next";
import { headers } from "next/headers";

import { t } from "@/src/i18n";
import { MissingPage } from "@/src/ui/detail/missing-page";

async function message(): Promise<string> {
  const listing = (await headers()).get("x-dancetonight-missing") === "listing";
  return listing ? t("errors.listingNotFound") : t("errors.notFound");
}

export async function generateMetadata(): Promise<Metadata> {
  // A 404 is kept out of search results by Next itself, which adds the noindex.
  return { title: await message() };
}

export default async function NotFound() {
  return <MissingPage message={await message()} />;
}
