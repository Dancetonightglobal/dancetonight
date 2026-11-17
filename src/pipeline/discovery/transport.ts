// The transport discovery fetches through (D-120). Discovery aims the polite client at thousands
// of websites nobody has looked at, so a redirect is not followed blindly:
//
// - A hop within the same site (http to https, adding www., a new path) is followed, at most
//   MAX_HOPS, as one fetch.
// - A hop to another site is not fetched at all: it may be Instagram, RA or a ticket page for
//   another club, and robots.txt, the blocklist and Tier D are checked per site. The fetch fails
//   with OffSiteRedirect, which the probe reads as "moved".
// - A host that resolves to a private, loopback or link-local address is never fetched, on the
//   first request or on any hop (a venue's website field can hold anything).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import { registrableDomain } from "@/src/pipeline/blocklist";
import { fetchTransport, HttpError, type Transport } from "@/src/pipeline/http";

export const MAX_HOPS = 5;

/** A redirect to another site, refused before it was fetched. */
export class OffSiteRedirect extends HttpError {
  constructor(
    url: string,
    readonly target: string,
  ) {
    super("stopped", url, `redirects to ${new URL(target).hostname}`);
    this.name = "OffSiteRedirect";
  }
}

/** Whether an address is one no public website lives at. */
export function isPrivateAddress(address: string): boolean {
  const v4 = isIP(address) === 4 ? address : /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (v4) {
    const [a, b] = v4.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = address.toLowerCase();
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export interface DiscoveryTransportOptions {
  inner?: Transport;
  /** The resolver; the system's by default. Returns every address of a host. */
  resolve?: (host: string) => Promise<string[]>;
}

async function systemResolve(host: string): Promise<string[]> {
  const found = await lookup(host, { all: true });
  return found.map((a) => a.address);
}

export function discoveryTransport(options: DiscoveryTransportOptions = {}): Transport {
  const inner = options.inner ?? manualFetchTransport;
  const resolve = options.resolve ?? systemResolve;
  return async (req) => {
    const site = registrableDomain(new URL(req.url).hostname);
    let url = req.url;
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
      // A failed lookup is left to the fetch, which reports it (ENOTFOUND reads as dead).
      const addresses = isIP(host) ? [host] : await resolve(host).catch(() => []);
      if (addresses.some(isPrivateAddress))
        throw new HttpError("blocklisted", url, "the host resolves to a private address");
      const response = await inner({ ...req, url });
      const location =
        response.status >= 300 && response.status < 400 ? response.headers["location"] : undefined;
      if (!location) return { ...response, url };
      const next = new URL(location, url);
      if (next.protocol !== "http:" && next.protocol !== "https:")
        throw new HttpError("invalid_url", url, "redirects to a non-web address");
      if (registrableDomain(next.hostname) !== site)
        throw new OffSiteRedirect(req.url, next.toString());
      url = next.toString();
    }
    throw new HttpError("network", req.url, `more than ${MAX_HOPS} redirects`);
  };
}

/** `fetchTransport` with redirects handed back instead of followed. */
export const manualFetchTransport: Transport = (req) =>
  fetchTransport({ ...req, redirect: "manual" });
