import { HttpError, type HttpClient } from "@/src/pipeline/http";

export type LinkVerdict =
  | { kind: "ok" }
  | { kind: "missing"; reason: string }
  | { kind: "unreachable"; reason: string }
  | { kind: "unknown"; reason: string };

export interface LinkCheckState {
  checkedAt: Date;
  broken: boolean;
  failures: number;
  reason: string | null;
}

/** Bytes read per link: enough to see the answer, not the whole page. */
export const LINK_CHECK_MAX_BYTES = 65_536;

export function linkKey(href: string): string {
  const hashIndex = href.indexOf("#");
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}

export function isHomePagePath(path: string): boolean {
  // Remove trailing slash if present
  const normalized = path.endsWith("/") ? path.slice(0, -1) : path;

  // Empty or root
  if (normalized === "" || normalized === "/") {
    return true;
  }

  // Check for index files (case-insensitive)
  const lowerPath = normalized.toLowerCase();
  if (lowerPath === "/index.html" || lowerPath === "/index.htm" || lowerPath === "/index.php") {
    return true;
  }

  // Check for locale segment: /xx or /xx-yy or /xx_yy
  // Remove leading slash
  const withoutSlash = normalized.startsWith("/") ? normalized.slice(1) : normalized;
  // Should be exactly one segment (no further slashes)
  if (withoutSlash.includes("/")) {
    return false;
  }

  // Match exactly two letters, optionally followed by - or _ and exactly two more letters
  const localePattern = /^[a-z]{2}(?:[-_][a-z]{2})?$/i;
  return localePattern.test(withoutSlash);
}

export function redirectedToHome(requested: string, finalUrl: string): boolean {
  try {
    const requestedUrl = new URL(requested);
    const finalUrlObj = new URL(finalUrl);

    // Drop fragments
    requestedUrl.hash = "";
    finalUrlObj.hash = "";

    const requestedPath = requestedUrl.pathname;
    const finalPath = finalUrlObj.pathname;

    // Return true only when requested path is NOT a home page AND final path IS a home page
    return !isHomePagePath(requestedPath) && isHomePagePath(finalPath);
  } catch {
    // If either URL fails to parse (including empty finalUrl), return false
    return false;
  }
}

export async function checkLink(http: HttpClient, url: string): Promise<LinkVerdict> {
  try {
    const response = await http.request({
      url,
      purpose: "crawl",
      maxBytes: LINK_CHECK_MAX_BYTES,
    });

    // Check if the successful response redirected to a home page
    if (redirectedToHome(url, response.url)) {
      return { kind: "missing", reason: "redirected to home page" };
    }
    return { kind: "ok" };
  } catch (error) {
    if (error instanceof HttpError) {
      switch (error.kind) {
        case "http_status": {
          if (error.status === 404) {
            return { kind: "missing", reason: "http 404" };
          }
          if (error.status === 410) {
            return { kind: "missing", reason: "http 410" };
          }
          return { kind: "unknown", reason: `http ${error.status}` };
        }
        case "too_large":
          return { kind: "ok" };
        case "timeout":
          return { kind: "unreachable", reason: "timeout" };
        case "network":
          return { kind: "unreachable", reason: `network: ${error.message}` };
        case "stopped":
        case "robots_disallowed":
        case "blocklisted":
        case "invalid_url":
          return { kind: "unknown", reason: error.kind };
        default:
          return { kind: "unknown", reason: error.kind };
      }
    }
    // Any other error
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "unknown", reason: `error: ${message}` };
  }
}

export function nextLinkState(
  prev: LinkCheckState | null,
  verdict: LinkVerdict,
  now: Date,
): LinkCheckState | null {
  if (verdict.kind === "unknown") {
    return null;
  }

  if (verdict.kind === "ok") {
    return {
      checkedAt: now,
      broken: false,
      failures: 0,
      reason: null,
    };
  }

  // missing or unreachable
  const prevFailures = prev?.failures ?? 0;
  const failures = prevFailures + 1;

  if (verdict.kind === "missing") {
    return {
      checkedAt: now,
      broken: true,
      failures,
      reason: verdict.reason,
    };
  }

  // unreachable
  const broken = failures >= 2;
  return {
    checkedAt: now,
    broken,
    failures,
    reason: verdict.reason,
  };
}
