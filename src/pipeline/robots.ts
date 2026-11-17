// robots.txt to RFC 9309 (D-021). Pure parsing and matching; fetching and caching live in
// src/pipeline/http.ts.
//
// - Groups are chosen by product token: the most specific group naming `dancetonightbot` wins,
//   else the `*` group, else everything is allowed.
// - Within a group the longest matching rule wins; on a tie `allow` beats `disallow`.
// - `*` matches any run of characters and a trailing `$` anchors the end of the path.
// - `Crawl-delay` is not in the RFC but is honoured when present: it raises our interval.
// - Content Signals (`Content-Signal: ai-input=no`) and AIPREF (`Content-Usage: ai=n`) are
//   read so a source that refuses AI input is harvested from structured data only (D-021).

export const ROBOTS_PRODUCT_TOKEN = "dancetonightbot";

interface Rule {
  allow: boolean;
  pattern: string;
}

interface Group {
  agents: string[];
  rules: Rule[];
  crawlDelayS: number | null;
}

export interface RobotsPolicy {
  /** Whether the path (with its query) may be fetched. */
  isAllowed(pathWithQuery: string): boolean;
  /** Seconds, when the group we follow sets one. */
  crawlDelayS: number | null;
  /** False when the site says its content must not be used as AI input. */
  aiInputAllowed: boolean;
  /** The rule that decides a path, for the report ("disallow /*?format=json"); null when none does. */
  ruleFor(pathWithQuery: string): string | null;
  /** Set when robots.txt could not be read, which RFC 9309 treats as "disallow everything". */
  unreadable: string | null;
}

export const ALLOW_ALL: RobotsPolicy = {
  isAllowed: () => true,
  crawlDelayS: null,
  aiInputAllowed: true,
  ruleFor: () => null,
  unreadable: null,
};

/** RFC 9309 2.3.1.4: an unreachable robots.txt means assume complete disallow. */
export function disallowAll(unreadable: string): RobotsPolicy {
  return {
    isAllowed: () => false,
    crawlDelayS: null,
    aiInputAllowed: false,
    ruleFor: () => null,
    unreadable,
  };
}

/** The policy for a robots.txt fetch outcome (RFC 9309 section 2.3.1). */
export function policyForStatus(status: number, body: string): RobotsPolicy {
  if (status >= 200 && status < 300) return parseRobots(body);
  // 4xx, including 401 and 403: the file is "unavailable", which means no restrictions.
  if (status >= 400 && status < 500) return ALLOW_ALL;
  // 5xx and anything else: "unreachable", which means assume complete disallow.
  return disallowAll(`robots.txt answered ${status}`);
}

export function parseRobots(text: string): RobotsPolicy {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  let aiInputAllowed = true;

  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [], crawlDelayS: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;

    if (key === "content-signal" && refusesAiInput(value)) aiInputAllowed = false;
    if (key === "content-usage" && /(^|[\s,;])ai\s*=\s*n\b/i.test(value)) aiInputAllowed = false;

    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      // An empty disallow means "allow everything"; an empty allow means nothing.
      if (value === "") continue;
      current.rules.push({ allow: key === "allow", pattern: value });
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelayS = seconds;
    }
  }

  const group = pickGroup(groups);
  if (!group) return { ...ALLOW_ALL, aiInputAllowed };
  return {
    isAllowed: (path) => decide(group.rules, path),
    crawlDelayS: group.crawlDelayS,
    aiInputAllowed,
    ruleFor: (path) => {
      const rule = deciding(group.rules, path);
      return rule ? `${rule.allow ? "allow" : "disallow"} ${rule.pattern}` : null;
    },
    unreadable: null,
  };
}

function refusesAiInput(value: string): boolean {
  return value
    .split(",")
    .map((part) => part.trim().toLowerCase().replace(/\s+/g, ""))
    .some((part) => part === "ai-input=no");
}

function pickGroup(groups: Group[]): Group | null {
  const named = groups.filter((g) =>
    g.agents.some((agent) => agent !== "*" && ROBOTS_PRODUCT_TOKEN.startsWith(agent)),
  );
  if (named.length > 0) return mergeGroups(named);
  const star = groups.filter((g) => g.agents.includes("*"));
  return star.length > 0 ? mergeGroups(star) : null;
}

/** RFC 9309 2.2.1: groups that name the same agent are combined. */
function mergeGroups(groups: Group[]): Group {
  const delays = groups.map((g) => g.crawlDelayS).filter((d): d is number => d !== null);
  return {
    agents: groups.flatMap((g) => g.agents),
    rules: groups.flatMap((g) => g.rules),
    crawlDelayS: delays.length > 0 ? Math.max(...delays) : null,
  };
}

function decide(rules: Rule[], path: string): boolean {
  if (path === "/robots.txt") return true;
  return deciding(rules, path)?.allow ?? true;
}

/** Within a group the longest matching rule wins; on a tie `allow` beats `disallow`. */
function deciding(rules: Rule[], path: string): Rule | null {
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matches(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const regex = body
    .split("*")
    .map((part) => normalizePercent(part).replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${regex}${anchored ? "$" : ""}`).test(normalizePercent(path));
}

/** Compare paths with percent-encodings in one case, so `%2f` and `%2F` match (RFC 9309 2.2.2). */
function normalizePercent(value: string): string {
  return value.replace(/%[0-9a-f]{2}/gi, (escape) => escape.toUpperCase());
}
