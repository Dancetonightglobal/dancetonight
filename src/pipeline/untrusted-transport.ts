// Fetching a URL a visitor gave us (PLAN 8.3 submissions; Q4 option A, D-134).
//
// Every other fetch goes to an address we chose. A submitted URL is chosen by a stranger, and our
// server fetches it, so it must never reach our own network: loopback, private and link-local
// ranges, the cloud metadata address (169.254.169.254), or a name that resolves to one. This is
// the transport a submission's polite client is built on (`createPoliteHttp({ transport:
// untrustedTransport() })`), so every request that client makes goes through it, robots.txt
// included. Nothing else changes in src/pipeline/http.ts.
//
// - Only http and https, on their default ports, with no user name or password in the URL.
// - A literal IP must be a public address; a name must not be "localhost" or a local suffix.
// - The address the socket connects to is checked at connect time (`lookup`), so a name that
//   resolves to a public address when checked and a private one when fetched (DNS rebinding)
//   is refused too: there is no second lookup.
// - Redirects are followed here, by hand, at most five, and every hop is checked again.

import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

import {
  HttpError,
  type Transport,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";

export const UNTRUSTED_MAX_REDIRECTS = 5;

function ipv4Number(address: string): number {
  return address.split(".").reduce((n, part) => n * 256 + Number(part), 0);
}

function inV4(address: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) >>> 0 === (ipv4Number(base) & mask) >>> 0;
}

const V4_BLOCKED: ReadonlyArray<readonly [string, number]> = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, the cloud metadata address among them
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, broadcast
];

/** Expands an IPv6 address to its eight 16-bit groups; null when it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase().replace(/%.*$/, "");
  // An embedded IPv4 tail (::ffff:10.0.0.1) becomes two groups.
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text)?.[1];
  if (v4) {
    if (!net.isIPv4(v4)) return null;
    const n = ipv4Number(v4);
    text = text.slice(0, -v4.length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill("0"), ...tail];
  if (groups.length !== 8) return null;
  const values = groups.map((g) => parseInt(g, 16));
  return values.every((v) => Number.isInteger(v) && v >= 0 && v <= 0xffff) ? values : null;
}

/** True only for an address on the public internet. */
export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return !V4_BLOCKED.some(([base, bits]) => inV4(address, base, bits));
  if (!net.isIPv6(address)) return false;
  const g = ipv6Groups(address);
  if (!g) return false;
  const v4Of = (a: number, b: number) => `${a >>> 8}.${a & 0xff}.${b >>> 8}.${b & 0xff}`;
  // ::ffff:a.b.c.d (mapped), ::a.b.c.d (compatible), 64:ff9b::a.b.c.d (NAT64): the IPv4 inside.
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
    if (g[5] === 0 && g[6] === 0 && (g[7] === 0 || g[7] === 1)) return false; // :: and ::1
    return isPublicAddress(v4Of(g[6]!, g[7]!));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) {
    return isPublicAddress(v4Of(g[6]!, g[7]!));
  }
  const first = g[0]!;
  // Global unicast only (2000::/3), then the special ranges inside it.
  if ((first & 0xe000) !== 0x2000) return false;
  if (first === 0x2001 && g[1]! < 0x0200) return false; // 2001::/23: Teredo, benchmarking, ORCHID
  if (first === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (first === 0x2002) {
    // 6to4 carries an IPv4 address in its second and third groups.
    return isPublicAddress(v4Of(g[1]!, g[2]!));
  }
  return true;
}

const LOCAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)\.?$/i;

/** What a visitor's URL may reach. Real runs use the default; tests widen it to a local server. */
export interface UntrustedPolicy {
  /** Which addresses may be connected to: public ones only by default. */
  allowed: (address: string) => boolean;
  /** Which ports a URL may name: the default ports only by default. */
  ports: readonly string[];
}

export const DEFAULT_UNTRUSTED_POLICY: UntrustedPolicy = {
  allowed: isPublicAddress,
  ports: ["", "80", "443"],
};

/** Why a URL may not be fetched for a visitor, or null when it may. */
export function untrustedUrlProblem(
  value: string,
  policy: UntrustedPolicy = DEFAULT_UNTRUSTED_POLICY,
): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "not a URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "only http and https";
  if (url.username || url.password) return "a user name or password in the URL";
  if (!policy.ports.includes(url.port)) return `port ${url.port}`;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!host) return "no host";
  if (net.isIP(host)) return policy.allowed(host) ? null : "a private or local address";
  if (!host.includes(".") || LOCAL_NAME.test(host)) return "a local name";
  return null;
}

type Lookup = (
  hostname: string,
  options: { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * A socket `lookup` that resolves a name and refuses it when any of its addresses is not
 * public: the socket connects only to an address this function has checked.
 */
export function guardedLookup(
  resolve: Lookup = dnsLookup as unknown as Lookup,
  allowed: (address: string) => boolean = isPublicAddress,
) {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) return callback(error, "");
      const refused = addresses.find((a) => !allowed(a.address));
      if (refused || addresses.length === 0) {
        const failure: NodeJS.ErrnoException = new Error(
          `${hostname} resolves to an address that may not be fetched`,
        );
        failure.code = "EADDRNOTALLOWED";
        return callback(failure, "");
      }
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

export interface UntrustedTransportOptions {
  /** The resolver behind the guard; DNS by default. */
  resolve?: Lookup;
  /** What may be reached; `DEFAULT_UNTRUSTED_POLICY` unless a test widens it. */
  policy?: UntrustedPolicy;
  maxRedirects?: number;
  /**
   * Run before each redirect hop is fetched, after its address is checked: the polite client's
   * blocklist and robots.txt see only the first URL, so a submission's client checks every hop
   * here (D-135). Throws to refuse the hop.
   */
  checkHop?: (url: string, firstUrl: string) => Promise<void>;
}

/** A transport for URLs a visitor gave us: every hop checked, redirects followed by hand. */
export function untrustedTransport(options: UntrustedTransportOptions = {}): Transport {
  const policy = options.policy ?? DEFAULT_UNTRUSTED_POLICY;
  const lookup = guardedLookup(options.resolve, policy.allowed);
  const maxRedirects = options.maxRedirects ?? UNTRUSTED_MAX_REDIRECTS;

  const once = (
    req: TransportRequest,
    url: URL,
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> =>
    new Promise((resolve, reject) => {
      const client = url.protocol === "https:" ? https : http;
      const request = client.request(
        url,
        {
          method: req.method,
          headers: req.headers,
          signal: req.signal,
          lookup: lookup as unknown as typeof dnsLookup,
          // No shared keep-alive pool: every socket is one this transport opened and checked.
          agent: false,
        },
        (response) => {
          const headers: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (typeof value === "string") headers[key.toLowerCase()] = value;
            else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join(", ");
          }
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            // Never drain a redirect's body: it could be endless, and nothing reads it.
            response.destroy();
            return resolve({ status, headers, body: "" });
          }
          const declared = Number(headers["content-length"] ?? "0");
          if (declared > req.maxBytes) {
            response.destroy();
            return reject(
              new HttpError("too_large", url.href, `declared ${declared} bytes, over the cap`),
            );
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.length;
            if (total > req.maxBytes) {
              response.destroy();
              reject(new HttpError("too_large", url.href, "the body is over the cap"));
              return;
            }
            chunks.push(chunk);
          });
          response.on("end", () =>
            resolve({ status, headers, body: Buffer.concat(chunks).toString("utf8") }),
          );
          response.on("error", reject);
        },
      );
      request.on("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRNOTALLOWED") {
          reject(new HttpError("blocklisted", url.href, error.message));
        } else reject(new HttpError("network", url.href, error.message));
      });
      if (req.body) request.write(req.body);
      request.end();
    });

  return async (req: TransportRequest): Promise<TransportResponse> => {
    let current = req.url;
    let method = req.method;
    let body = req.body;
    let headers = req.headers;
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const problem = untrustedUrlProblem(current, policy);
      if (problem) throw new HttpError("blocklisted", current, `may not be fetched: ${problem}`);
      if (hop > 0 && options.checkHop) await options.checkHop(current, req.url);
      const answer = await once({ ...req, url: current, method, body, headers }, new URL(current));
      const location = answer.headers.location;
      if (answer.status >= 300 && answer.status < 400 && location) {
        const next = new URL(location, current);
        if (next.origin !== new URL(current).origin) {
          // Another host gets none of this one's credentials or validators, and no replayed body.
          if ((answer.status === 307 || answer.status === 308) && method === "POST") {
            throw new HttpError("network", current, "a POST redirected to another host");
          }
          headers = Object.fromEntries(
            Object.entries(headers).filter(
              ([key]) =>
                !/^(authorization|cookie|proxy-authorization|if-none-match|if-modified-since)$/i.test(
                  key,
                ),
            ),
          );
        }
        current = next.href;
        if (
          answer.status === 303 ||
          ((answer.status === 301 || answer.status === 302) && method === "POST")
        ) {
          method = "GET";
          body = undefined;
        }
        continue;
      }
      return { url: current, status: answer.status, headers: answer.headers, body: answer.body };
    }
    throw new HttpError("network", req.url, `more than ${maxRedirects} redirects`);
  };
}
