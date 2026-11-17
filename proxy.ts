// Event addresses (D-092). One indexed lookup answers what /e/{slug} and its calendar file lead to,
// before the page renders, while the HTTP status can still be set:
//
// - a listing merged into another (one night two sources listed) sends the dancer to the listing
//   that stands, page or calendar file alike, with a temporary redirect: a merge can be undone;
// - a past night the retention job archived (M1) answers 410 Gone for the calendar file and a
//   "This night has passed" page;
// - a listing that is gone, or was never ours, answers 404. The page is served from an address no
//   route matches, so Next renders the full not-found page with a real 404 (app/not-found.tsx,
//   told by a request header to say the listing is gone). A notFound() from the page itself would
//   give the 404 with an empty `__next_error__` shell in Next 16.3.5 (D-069), which is why D-069
//   answered 200 and this does not.
//
// Proxy runs on the Node.js runtime (Next 16), so the repository and its database client work here.
//
// City paths (D-567) are rewritten to the home page at the city's centre, and any other single-segment
// path passes through untouched (so /bot, /robots.txt, icons and unknown paths behave as before).

import { NextResponse, type NextRequest } from "next/server";

import { getProxyRepository } from "@/src/data";
import type { SlugAnswer } from "@/src/data/repository";
import { t } from "@/src/i18n";
import { cityRewrite } from "@/src/ui/home/city-path";

/** Set on a rewritten request: app/not-found.tsx then says the listing is gone. */
export const MISSING_LISTING_HEADER = "x-dancetonight-missing";

/** Set on a rewritten request for a passed night: the slug of the archived event. */
export const MISSING_SLUG_HEADER = "x-dancetonight-slug";

/** An address no route matches, under which the not-found page renders with its 404. */
const MISSING_PATH = "/_listing-gone";

const EVENT_PATH = /^\/e\/([^/]+)(\/calendar\.ics)?\/?$/;

export async function proxy(request: NextRequest): Promise<NextResponse> {
  // Handle city paths first (D-567)
  const city = cityRewrite(request.nextUrl.pathname, request.nextUrl.searchParams);
  if (city !== null) {
    const to = request.nextUrl.clone();
    to.pathname = "/";
    to.search = city.toString();
    return NextResponse.rewrite(to);
  }

  const match = EVENT_PATH.exec(request.nextUrl.pathname);
  if (!match) return NextResponse.next();
  const calendar = match[2] !== undefined;
  let slug: string;
  try {
    slug = decodeURIComponent(match[1]!);
  } catch {
    // A malformed escape ("%E0%A4%A") names no listing of ours.
    return gone(request, calendar);
  }
  let answer: SlugAnswer;
  try {
    answer = await getProxyRepository().resolveSlug(slug);
  } catch (error) {
    // The database is unreachable: the page's own path decides, with its own error handling.
    console.error("proxy: event address lookup failed", error);
    return NextResponse.next();
  }
  if (answer.kind === "listed") return NextResponse.next();
  if (answer.kind === "moved") {
    const to = request.nextUrl.clone();
    to.pathname = `/e/${encodeURIComponent(answer.slug)}${calendar ? "/calendar.ics" : ""}`;
    return NextResponse.redirect(to, 307);
  }
  if (answer.kind === "passed") return passed(request, calendar, slug);
  return gone(request, calendar);
}

/** A 410 for a passed night's calendar file, rewrite for the page. */
function passed(request: NextRequest, calendar: boolean, slug: string): NextResponse {
  if (calendar) {
    return new NextResponse(t("errors.nightPassed"), {
      status: 410,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const headers = new Headers(request.headers);
  headers.set(MISSING_LISTING_HEADER, "passed");
  headers.set(MISSING_SLUG_HEADER, slug);
  const to = request.nextUrl.clone();
  to.pathname = MISSING_PATH;
  return NextResponse.rewrite(to, { request: { headers } });
}

/** A 404: plain text for the calendar file, the full missing-listing page for the page. */
function gone(request: NextRequest, calendar: boolean): NextResponse {
  if (calendar) {
    return new NextResponse(t("errors.listingNotFound"), {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const headers = new Headers(request.headers);
  headers.set(MISSING_LISTING_HEADER, "listing");
  const to = request.nextUrl.clone();
  to.pathname = MISSING_PATH;
  return NextResponse.rewrite(to, { request: { headers } });
}

export const config = {
  matcher: ["/e/:slug", "/e/:slug/calendar.ics", "/:city"],
};
