// The event page's own address, shared by the page (JSON-LD, share link, canonical) and its
// calendar.ics route (the .ics file's URL), so the two can never name different pages.

import { headers } from "next/headers";

import { env } from "@/src/config/env";

/** Our site's origin: the configured base, else the request's own host. Null when neither. */
export async function siteOrigin(): Promise<string | null> {
  const configured = env.PUBLIC_BASE_URL;
  if (configured !== undefined) return new URL(configured).origin;
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (host === null) return null;
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${protocol}://${host}`;
}

/**
 * The page's own address, absolute so the .ics file and the JSON-LD carry a link that works away
 * from this tab. The configured base wins; otherwise the request's own host answers for it.
 */
export async function pageUrl(slug: string): Promise<string> {
  const path = `/e/${encodeURIComponent(slug)}`;
  const configured = env.PUBLIC_BASE_URL;
  if (configured !== undefined) return new URL(path, configured).toString();
  const origin = await siteOrigin();
  return origin === null ? path : new URL(path, origin).toString();
}
