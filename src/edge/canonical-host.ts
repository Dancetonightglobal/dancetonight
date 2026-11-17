/**
 * One address for the site: https://dancetonightglobal.com (owner, 2026-10-29). The www host and
 * both dancetonight.app hosts are custom domains on this Worker too, and answer here with a
 * permanent redirect to the same path and query on the canonical host, before Next.js runs.
 * Any other host (workers.dev, localhost) is served as before.
 */

export const CANONICAL_HOST = "dancetonightglobal.com";

const REDIRECT_HOSTS: ReadonlySet<string> = new Set([
  "www.dancetonightglobal.com",
  "dancetonight.app",
  "www.dancetonight.app",
]);

/** A 301 to the canonical host for a request to one of our other hosts, else null. */
export function canonicalRedirect(request: Request): Response | null {
  const url = new URL(request.url);
  if (!REDIRECT_HOSTS.has(url.hostname.toLowerCase())) return null;
  const target = `https://${CANONICAL_HOST}${url.pathname}${url.search}`;
  return new Response(null, { status: 301, headers: { Location: target } });
}
