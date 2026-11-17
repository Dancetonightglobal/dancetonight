// The polite HTTP client (PLAN 6.4, D-008, D-021, D-043): the only way an adapter reaches the
// network. Every request, in this order:
//
// 1. Only http(s) URLs; anything else is refused.
// 2. The blocklist (SPEC section 8): a blocked domain or URL prefix is never requested.
// 3. robots.txt for crawling requests (RFC 9309, cached per origin for the run). Official APIs
//    skip robots, because they have their own terms, but not the limiter or the blocklist.
// 4. The per-domain limiter: one request at a time per registrable domain, spaced by at least
//    the interval (5 s for crawling, raised by Crawl-delay), measured start to start.
// 5. Conditional GET headers when the caller has an ETag or Last-Modified.
// 6. A timeout and a size cap; a body over the cap is an error, never silently truncated.
// 7. 402 and 403 stop us (D-021); 429 and 503 are retried once when Retry-After is short.
//
// The transport underneath is swappable: `fetchTransport` for real runs, `fixtureTransport` in
// tests (CI never touches the network), and `recordingTransport` to capture fixtures.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { EMPTY_BLOCKLIST, registrableDomain, type Blocklist } from "@/src/pipeline/blocklist";
import { disallowAll, policyForStatus, type RobotsPolicy } from "@/src/pipeline/robots";

export type RequestPurpose = "crawl" | "api";

export interface HttpRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  /** `crawl` checks robots.txt and never spaces below 5 s; `api` does neither. */
  purpose: RequestPurpose;
  /** Validators from the last fetch, replayed as If-None-Match and If-Modified-Since. */
  conditional?: { etag?: string | null; lastModified?: string | null };
  /** Spacing for this domain; the crawl floor still applies. */
  intervalMs?: number;
  /** A larger (or smaller) body cap for this request only; the client's cap otherwise. */
  maxBytes?: number;
}

export interface HttpResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
  /** True for a 304: the caller's copy is current and `body` is empty. */
  notModified: boolean;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: Date;
}

export type HttpErrorKind =
  | "invalid_url"
  | "blocklisted"
  | "robots_disallowed"
  | "stopped"
  | "http_status"
  | "too_large"
  | "timeout"
  | "network";

export class HttpError extends Error {
  constructor(
    readonly kind: HttpErrorKind,
    readonly url: string,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export interface TransportRequest {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  maxBytes: number;
  /** `manual` hands a 3xx back to the caller instead of following it (discovery, D-120). */
  redirect?: "follow" | "manual";
}

export interface TransportResponse {
  /** The final URL after redirects. */
  url: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type Transport = (request: TransportRequest) => Promise<TransportResponse>;

export interface HttpClient {
  request(request: HttpRequest): Promise<HttpResponse>;
  /** The robots policy for a URL's origin, fetched once per run. */
  robots(url: string): Promise<RobotsPolicy>;
}

export const CRAWL_INTERVAL_MS = 5_000;
/** The longest Crawl-delay a run waits out between two pages of one site (D-252). */
export const MAX_CRAWL_DELAY_WAIT_MS = 10 * 60_000;
export const DEFAULT_API_INTERVAL_MS = 250;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
/** The longest Retry-After we wait out inside one run. */
export const MAX_RETRY_AFTER_MS = 30_000;
/** The wait before retrying an API's 429 that gives no Retry-After (D-818). */
export const API_429_RETRY_MS = 2_000;

export interface PoliteHttpOptions {
  transport: Transport;
  userAgent: string;
  blocklist?: Blocklist;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxBytes?: number;
  /** D-831: hosts (lowercase, no `www.`) read despite robots.txt, by written permission. */
  robotsWaivedHosts?: ReadonlySet<string>;
}

/** `DanceTonightBot/1.0 (+https://{site}/bot; {contact})` (D-021). */
export function buildUserAgent(baseUrl: string, contactEmail: string | undefined): string {
  const botPage = `${baseUrl.replace(/\/+$/, "")}/bot`;
  return contactEmail
    ? `DanceTonightBot/1.0 (+${botPage}; ${contactEmail})`
    : `DanceTonightBot/1.0 (+${botPage})`;
}

/**
 * Node's fetch says only "fetch failed"; the reason (ENOTFOUND, ECONNREFUSED, an expired
 * certificate) is on `cause`, and it is what tells a dead domain from a passing fault.
 */
export function networkReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error || (typeof cause === "object" && cause !== null)) {
    const { code, message } = cause as { code?: unknown; message?: unknown };
    const detail = [code, message].filter((v) => typeof v === "string" && v).join(" ");
    if (detail) return `${error.message}: ${detail}`;
  }
  return error.message;
}

/**
 * The first 200 characters of an API error body on one line, control characters removed. Any
 * long query value of the request (an API key in the URL) is masked in case the body echoes it.
 */
export function apiErrorText(body: string, requestUrl: URL): string {
  let text = body
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const value of requestUrl.searchParams.values()) {
    if (value.length >= 8) text = text.split(value).join("***");
  }
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function createPoliteHttp(options: PoliteHttpOptions): HttpClient {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const blocklist = options.blocklist ?? EMPTY_BLOCKLIST;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const waivedHosts = options.robotsWaivedHosts ?? new Set<string>();

  const chains = new Map<string, Promise<void>>();
  const lastStart = new Map<string, number>();
  // D-252: domains whose last request was their robots.txt. It is spaced like any request, but it
  // does not start a Crawl-delay (RFC 9309): the first page waits only the base interval.
  const robotsLast = new Set<string>();
  const robotsCache = new Map<string, Promise<RobotsPolicy>>();

  /** Waits for this domain's turn and its spacing; returns the function that ends the turn. */
  async function takeTurn(
    domain: string,
    intervalMs: number,
    isRobots = false,
  ): Promise<() => void> {
    const previous = chains.get(domain) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    chains.set(
      domain,
      previous.then(() => mine),
    );
    await previous;
    const last = lastStart.get(domain);
    if (last !== undefined) {
      const spacing = robotsLast.has(domain) ? Math.min(intervalMs, CRAWL_INTERVAL_MS) : intervalMs;
      const wait = last + spacing - now();
      if (wait > 0) await sleep(wait);
    }
    lastStart.set(domain, now());
    if (isRobots) robotsLast.add(domain);
    else robotsLast.delete(domain);
    return release;
  }

  async function send(
    url: string,
    method: "GET" | "POST",
    headers: Record<string, string>,
    body: string | undefined,
    requestMaxBytes?: number,
  ): Promise<TransportResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await options.transport({
        url,
        method,
        headers: { "user-agent": options.userAgent, ...headers },
        body,
        signal: controller.signal,
        maxBytes: requestMaxBytes ?? maxBytes,
      });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (controller.signal.aborted) {
        throw new HttpError("timeout", url, `no answer within ${timeoutMs / 1000} s`);
      }
      throw new HttpError("network", url, networkReason(error));
    } finally {
      clearTimeout(timer);
    }
  }

  function robots(url: string): Promise<RobotsPolicy> {
    const origin = new URL(url).origin;
    let cached = robotsCache.get(origin);
    if (!cached) {
      cached = (async () => {
        const robotsUrl = `${origin}/robots.txt`;
        const release = await takeTurn(
          registrableDomain(new URL(url).hostname),
          CRAWL_INTERVAL_MS,
          true,
        );
        try {
          const response = await send(
            robotsUrl,
            "GET",
            { accept: "text/plain" },
            undefined,
            undefined,
          );
          return policyForStatus(response.status, response.body);
        } catch (error) {
          // Unreachable robots.txt means assume complete disallow (RFC 9309 2.3.1.4).
          const why = error instanceof HttpError ? error.message : "no answer";
          return disallowAll(`robots.txt could not be fetched (${why})`);
        } finally {
          release();
        }
      })();
      robotsCache.set(origin, cached);
    }
    return cached;
  }

  async function request(req: HttpRequest): Promise<HttpResponse> {
    let parsed: URL;
    try {
      parsed = new URL(req.url);
    } catch {
      throw new HttpError("invalid_url", req.url, "not a URL");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new HttpError("invalid_url", req.url, "only http and https URLs are fetched");
    }
    const blocked = blocklist.matchUrl(req.url);
    if (blocked) {
      throw new HttpError("blocklisted", req.url, `on the blocklist (${blocked.patternType})`);
    }

    let intervalMs = req.intervalMs ?? DEFAULT_API_INTERVAL_MS;
    if (req.purpose === "crawl") {
      const policy = await robots(req.url);
      const path = `${parsed.pathname}${parsed.search}`;
      // D-831: a host whose owner gave written permission skips only this check; the spacing below,
      // the blocklist above and the 402/403 stops still apply.
      const waived = waivedHosts.has(parsed.hostname.toLowerCase().replace(/^www\./, ""));
      if (!waived && !policy.isAllowed(path)) {
        const why = policy.unreadable
          ? `${policy.unreadable}, which counts as disallowing the whole site`
          : `robots.txt disallows ${path} (rule: ${policy.ruleFor(path) ?? "unknown"})`;
        throw new HttpError("robots_disallowed", req.url, why);
      }
      intervalMs = Math.max(intervalMs, CRAWL_INTERVAL_MS, (policy.crawlDelayS ?? 0) * 1000);
      // A delay over the cap is one page of the site a run, not a run that sleeps (D-252).
      const domainNow = registrableDomain(parsed.hostname);
      if (
        (policy.crawlDelayS ?? 0) * 1000 > MAX_CRAWL_DELAY_WAIT_MS &&
        lastStart.has(domainNow) &&
        !robotsLast.has(domainNow)
      ) {
        throw new HttpError(
          "stopped",
          req.url,
          `robots.txt asks for a crawl delay of ${policy.crawlDelayS} s; one page of this site is read a run`,
        );
      }
    }

    const headers: Record<string, string> = { ...req.headers };
    if (req.conditional?.etag) headers["if-none-match"] = req.conditional.etag;
    if (req.conditional?.lastModified) headers["if-modified-since"] = req.conditional.lastModified;

    const domain = registrableDomain(parsed.hostname);
    const method = req.method ?? "GET";
    let response: TransportResponse | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const release = await takeTurn(domain, intervalMs);
      try {
        response = await send(req.url, method, headers, req.body, req.maxBytes);
      } finally {
        release();
      }
      if (attempt === 0 && (response.status === 429 || response.status === 503)) {
        // An API's rate-limit 429 with no Retry-After (Ticketmaster "Spike arrest violation") waits 2 s (D-818).
        const stated = retryAfterMs(response.headers["retry-after"], now());
        const retryMs =
          stated ?? (req.purpose === "api" && response.status === 429 ? API_429_RETRY_MS : null);
        if (retryMs !== null && retryMs <= MAX_RETRY_AFTER_MS) {
          await sleep(retryMs);
          continue;
        }
      }
      break;
    }
    if (!response) throw new HttpError("network", req.url, "no response");

    const fetchedAt = new Date(now());
    const etag = response.headers["etag"] ?? null;
    const lastModified = response.headers["last-modified"] ?? null;
    if (response.status === 304) {
      return { ...response, body: "", notModified: true, etag, lastModified, fetchedAt };
    }
    if (response.status === 402 || response.status === 403) {
      // An API says which setting refused it (a key restricted to other APIs, billing off); a
      // crawled page's refusal is only HTML.
      const said = req.purpose === "api" ? apiErrorText(response.body, parsed) : "";
      throw new HttpError(
        "stopped",
        req.url,
        `the site answered ${response.status}${said ? `: ${said}` : ""}`,
        response.status,
      );
    }
    if (response.status < 200 || response.status >= 300) {
      // An API says why it refused ("ARGUMENTS_ERROR: time_filter is invalid"); a crawled page's
      // error body is only HTML, so it stays out of the report.
      const said = req.purpose === "api" ? apiErrorText(response.body, parsed) : "";
      throw new HttpError(
        "http_status",
        req.url,
        `the site answered ${response.status}${said ? `: ${said}` : ""}`,
        response.status,
      );
    }
    return { ...response, notModified: false, etag, lastModified, fetchedAt };
  }

  return { request, robots };
}

/** Retry-After as milliseconds from now: delta-seconds or an HTTP date. Null when absent or unreadable. */
export function retryAfterMs(value: string | undefined, nowMs: number): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
}

/** Shift_JIS's other names; WHATWG TextDecoder knows only some of them. */
const SHIFT_JIS_ALIASES = new Set([
  "sjis",
  "x-sjis",
  "ms_kanji",
  "windows-31j",
  "cp932",
  "csshiftjis",
  "shift-jis",
]);

/**
 * Decode a response body (D-1229). Bytes that are valid UTF-8 decode exactly as before, whatever the page declares,
 * so pages that mislabel UTF-8 and every content hash stay as they were. Only bytes that are not valid UTF-8 are
 * decoded in the declared charset: the Content-Type header's charset, else a meta tag in the first 4,096 bytes
 * (Tokyo venue sites declare Shift_JIS only there). An unknown label falls back to UTF-8. Never throws.
 */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not valid UTF-8: use the declared charset below, unless only a character cut off at the end is invalid.
  }
  for (let k = 1; k <= 3 && k < bytes.length; k++) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, bytes.length - k));
      return new TextDecoder("utf-8").decode(bytes);
    } catch {
      // Still not UTF-8 without the last k bytes.
    }
  }
  let label =
    contentType
      ?.match(/charset\s*=\s*["']?([^"';]+)/i)?.[1]
      ?.trim()
      .toLowerCase() ?? null;
  if (!label) {
    const head = Buffer.from(bytes.subarray(0, 4096)).toString("latin1");
    label =
      head.match(/<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_.:-]+)/i)?.[1]?.toLowerCase() ?? null;
  }
  if (label && SHIFT_JIS_ALIASES.has(label)) label = "shift_jis";
  if (label) {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      // Unknown label: UTF-8 below.
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

/** The real network, through the runtime's fetch. Reads the body as a stream so the cap holds. */
export const fetchTransport: Transport = async (req) => {
  const response = await fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: req.signal,
    redirect: req.redirect ?? "follow",
  });
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > req.maxBytes) {
    await response.body?.cancel();
    throw new HttpError("too_large", req.url, `declared ${declared} bytes, over the cap`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > req.maxBytes) {
        await reader.cancel();
        throw new HttpError("too_large", req.url, `over ${req.maxBytes} bytes`);
      }
      chunks.push(value);
    }
  }
  const bytes = Buffer.concat(chunks);
  const body = decodeBody(bytes, response.headers.get("content-type"));
  return {
    url: response.url || req.url,
    status: response.status,
    headers: headersToRecord(response.headers),
    body,
  };
};

// ---------------------------------------------------------------------------------------------
// Fixtures: recorded request/response pairs. CI replays them and fails on anything unrecorded.

export interface Fixture {
  request: { method: "GET" | "POST"; url: string; body?: string };
  response: TransportResponse;
  /** Where the fixture came from: `recorded 2026-09-23` or `built from the documented shape`. */
  note?: string;
}

export function fixtureKey(method: string, url: string, body?: string): string {
  return `${method.toUpperCase()} ${url}${body ? ` ${createHash("sha1").update(body).digest("hex")}` : ""}`;
}

export class UnrecordedRequestError extends Error {
  constructor(readonly key: string) {
    super(`no fixture for ${key}; record one or add it by hand`);
    this.name = "UnrecordedRequestError";
  }
}

/** Replays fixtures by method, URL and body. An unrecorded request throws, which fails the test. */
export function fixtureTransport(fixtures: readonly Fixture[]): Transport & { requests: string[] } {
  const byKey = new Map(
    fixtures.map((f) => [fixtureKey(f.request.method, f.request.url, f.request.body), f]),
  );
  const requests: string[] = [];
  const transport = async (req: TransportRequest): Promise<TransportResponse> => {
    const key = fixtureKey(req.method, req.url, req.body);
    requests.push(key);
    const fixture = byKey.get(key);
    if (!fixture) throw new UnrecordedRequestError(key);
    const headers = Object.fromEntries(
      Object.entries(fixture.response.headers).map(([k, v]) => [k.toLowerCase(), v]),
    );
    return { ...fixture.response, headers, url: fixture.response.url || req.url };
  };
  return Object.assign(transport, { requests });
}

/** A readable, collision-free file name for a fixture. */
export function fixtureFileName(method: string, url: string, body?: string): string {
  const parsed = new URL(url);
  const slug = `${parsed.hostname}${parsed.pathname}`
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const hash = createHash("sha1")
    .update(fixtureKey(method, url, body))
    .digest("hex")
    .slice(0, 10);
  return `${slug}-${hash}.json`;
}

/** Wraps a transport and writes every exchange to `dir` as a fixture. Secrets in URLs are masked. */
export function recordingTransport(
  inner: Transport,
  dir: string,
  mask: readonly string[] = [],
): Transport {
  return async (req) => {
    const response = await inner(req);
    const scrub = (text: string) =>
      mask.reduce((out, secret) => out.split(secret).join("REDACTED"), text);
    const fixture: Fixture = {
      request: {
        method: req.method,
        url: scrub(req.url),
        ...(req.body ? { body: scrub(req.body) } : {}),
      },
      response: { ...response, url: scrub(response.url) },
      note: `recorded ${new Date().toISOString().slice(0, 10)}`,
    };
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, fixtureFileName(req.method, fixture.request.url, fixture.request.body)),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
    return response;
  };
}

/** Every `*.json` fixture in a directory. */
export async function loadFixtures(dir: string): Promise<Fixture[]> {
  const names = (await readdir(dir)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8")) as Fixture),
  );
}
