import { describe, expect, it } from "vitest";

import {
  discoveryTransport,
  isPrivateAddress,
  MAX_HOPS,
  OffSiteRedirect,
} from "@/src/pipeline/discovery/transport";
import { failureStatus, probeSite } from "@/src/pipeline/discovery/site-probe";
import {
  createPoliteHttp,
  HttpError,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";

const req = (url: string): TransportRequest => ({
  url,
  method: "GET",
  headers: {},
  signal: new AbortController().signal,
  maxBytes: 1_000_000,
});

/** A fake web: each URL answers a page, or a redirect to another URL. */
function web(routes: Record<string, string | { to: string }>) {
  const asked: string[] = [];
  const inner = async (r: TransportRequest): Promise<TransportResponse> => {
    asked.push(r.url);
    const route = routes[r.url];
    if (route === undefined) return { url: r.url, status: 404, headers: {}, body: "" };
    if (typeof route === "string") return { url: r.url, status: 200, headers: {}, body: route };
    return { url: r.url, status: 301, headers: { location: route.to }, body: "" };
  };
  const publicDns = async () => ["93.184.216.34"];
  return { inner, asked, publicDns };
}

describe("discovery's transport", () => {
  it("follows a redirect within the site as one fetch", async () => {
    const w = web({
      "http://club.example/": { to: "https://club.example/" },
      "https://club.example/": { to: "https://www.club.example/home" },
      "https://www.club.example/home": "<h1>Club</h1>",
    });
    const t = discoveryTransport({ inner: w.inner, resolve: w.publicDns });
    const res = await t(req("http://club.example/"));
    expect(res).toMatchObject({ status: 200, url: "https://www.club.example/home" });
    expect(w.asked).toHaveLength(3);
  });

  it("never fetches a redirect to another site, Tier D or not", async () => {
    const w = web({ "https://club.example/": { to: "https://ra.co/clubs/1" } });
    const t = discoveryTransport({ inner: w.inner, resolve: w.publicDns });
    const failed = await t(req("https://club.example/")).catch((e: unknown) => e);
    expect(failed).toBeInstanceOf(OffSiteRedirect);
    expect(w.asked).toEqual(["https://club.example/"]);
    expect(failureStatus(failed)).toEqual({
      status: "moved",
      reason: "the site redirects to ra.co",
    });
  });

  it("refuses a host at a private address, before and after a redirect", async () => {
    const w = web({
      "https://club.example/": { to: "https://intranet.club.example/" },
      "https://intranet.club.example/": "secret",
    });
    const dns = async (host: string) =>
      host === "intranet.club.example" ? ["10.0.0.5"] : ["93.184.216.34"];
    const t = discoveryTransport({ inner: w.inner, resolve: dns });
    await expect(t(req("https://club.example/"))).rejects.toThrow("private address");
    expect(w.asked).toEqual(["https://club.example/"]);
    await expect(t(req("http://169.254.169.254/latest/"))).rejects.toThrow("private address");
    await expect(t(req("http://[::1]/"))).rejects.toThrow("private address");
  });

  it("stops after MAX_HOPS redirects and at a non-web address", async () => {
    const loop = web({ "https://a.example/": { to: "https://a.example/" } });
    const t = discoveryTransport({ inner: loop.inner, resolve: loop.publicDns });
    await expect(t(req("https://a.example/"))).rejects.toThrow(`more than ${MAX_HOPS} redirects`);
    const mail = web({ "https://a.example/": { to: "mailto:hi@a.example" } });
    const t2 = discoveryTransport({ inner: mail.inner, resolve: mail.publicDns });
    await expect(t2(req("https://a.example/"))).rejects.toThrow("non-web address");
  });

  it("knows the private ranges", () => {
    for (const a of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ])
      expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ["93.184.216.34", "172.32.0.1", "100.128.0.1", "2606:4700::1111"])
      expect(isPrivateAddress(a), a).toBe(false);
  });

  it("reads robots.txt redirecting off the site as moved, and a resolver hiccup as unreachable", () => {
    const robots = (why: string) => failureStatus(new HttpError("robots_disallowed", "u", why));
    expect(
      robots(
        "robots.txt could not be fetched (redirects to www.other.example), which counts as disallowing the whole site",
      ).status,
    ).toBe("moved");
    expect(
      failureStatus(
        new HttpError("network", "u", "fetch failed: EAI_AGAIN getaddrinfo EAI_AGAIN club.example"),
      ).status,
    ).toBe("unreachable");
  });
});

describe("a site that moved", () => {
  function politeOver(routes: Record<string, string | { to: string }>) {
    const w = web(routes);
    let t = Date.parse("2026-10-04T16:00:00Z");
    const http = createPoliteHttp({
      transport: discoveryTransport({ inner: w.inner, resolve: w.publicDns }),
      userAgent: "DanceTonightBot/1.0 (+https://dancetonight.vercel.app/bot)",
      now: () => t,
      sleep: async (ms) => void (t += ms),
    });
    return { http, asked: w.asked };
  }
  const allow = "User-agent: *\nDisallow:\n";

  it("is followed once to a domain that carries the place's name, and probed there from the start", async () => {
    const { http, asked } = politeOver({
      "https://lvgnewyork.example/robots.txt": {
        to: "https://www.lvgsalsasocial.example/robots.txt",
      },
      "https://www.lvgsalsasocial.example/robots.txt": allow,
      "https://www.lvgsalsasocial.example/":
        '<h1>LVG</h1><link rel="alternate" type="text/calendar" href="/cal.ics">',
    });
    const outcome = await probeSite(http, {
      url: "https://lvgnewyork.example/",
      venueNames: ["La Vieja Guardia NYC - LVG Salsa Social"],
    });
    expect(outcome).toMatchObject({
      status: "structured",
      url: "https://www.lvgsalsasocial.example/",
      feedUrl: "https://www.lvgsalsasocial.example/cal.ics",
    });
    expect(outcome.reason).toContain("(the site moved here from lvgnewyork.example)");
    expect(asked).not.toContain("https://lvgnewyork.example/");
  });

  it("is not followed to a domain that names someone else, nor to a platform", async () => {
    const marquee = politeOver({
      "https://marqueeny.example/robots.txt": allow,
      "https://marqueeny.example/": { to: "https://tickets.hospitality.example/vegas" },
    });
    expect(
      await probeSite(marquee.http, {
        url: "https://marqueeny.example/",
        venueNames: ["Marquee New York"],
      }),
    ).toMatchObject({
      status: "moved",
      reason: "the site redirects to tickets.hospitality.example",
    });
    expect(marquee.asked.some((u) => u.includes("hospitality"))).toBe(false);

    const ticketed = politeOver({
      "https://bigroom.example/robots.txt": allow,
      "https://bigroom.example/": { to: "https://bigroom.eventbrite.com/" },
    });
    expect(
      (
        await probeSite(ticketed.http, {
          url: "https://bigroom.example/",
          venueNames: ["Big Room"],
        })
      ).status,
    ).toBe("moved");
    expect(ticketed.asked.some((u) => u.includes("eventbrite"))).toBe(false);
  });
});
