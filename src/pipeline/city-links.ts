/**
 * The link that marks a listing as another city's night on a page that lists several cities'
 * events (`SeedSource.cityLinkPrefix`), or null. A link counts only when it is on the prefix's own
 * host and under the prefix's parent path (for "https://www.daybreaker.com/event/new-york-": host
 * www.daybreaker.com, path starting "/event/") and does not start with the prefix. A listing with
 * no such link is never left out by this rule.
 */
export function otherCityLink(
  links: readonly (string | null | undefined)[],
  prefix: string | undefined,
): string | null {
  if (!prefix?.trim()) return null;
  let parsedPrefix: URL;
  try {
    parsedPrefix = new URL(prefix);
  } catch {
    return null;
  }
  const prefixHost = normalizeHost(parsedPrefix.host);
  const prefixPath = parsedPrefix.pathname;
  const parentPath = prefixPath.substring(0, prefixPath.lastIndexOf("/") + 1);
  const normalizedPrefix = normalizeForPrefixMatch(prefix);

  let foundOtherCityLink: string | null = null;
  let hasThisCity = false;
  for (const link of links) {
    if (!link) continue;
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      continue;
    }
    const host = normalizeHost(url.host);
    if (host !== prefixHost) continue;
    if (!url.pathname.startsWith(parentPath)) continue;
    const normalizedLink = normalizeForPrefixMatch(url.href);
    if (normalizedLink.startsWith(normalizedPrefix)) {
      hasThisCity = true;
    } else {
      // This link is on the same host and under the parent path, but not for this city.
      // Remember the first such link, but we can't return yet because we need to check all links.
      if (foundOtherCityLink === null) {
        foundOtherCityLink = link;
      }
    }
  }
  // If any link was for this city, the listing is not another city's.
  if (hasThisCity) return null;
  // Otherwise, return the first other-city link we found (could be null).
  return foundOtherCityLink;
}

function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function normalizeForPrefixMatch(url: string): string {
  // Parse, normalize host, and reconstruct with https protocol.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Should not happen because we already validated, but fallback.
    return url.toLowerCase().replace(/^http:/, "https:");
  }
  const host = normalizeHost(parsed.host);
  // Reconstruct with https, normalized host, and the rest as is.
  return `https://${host}${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
}
