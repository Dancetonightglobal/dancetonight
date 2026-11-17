import { describe, expect, it } from "vitest";
import {
  googleRedirectCount,
  isGoogleRedirect,
  organicLeads,
} from "@/src/pipeline/discovery/serp-gap";

// Since 2026-10-30 Serper returns organic results after the top 3 as google.com/goto links instead of
// the real URL. Such a link names no site, so it is dropped and counted, never treated as a host.
const GOTO = "https://www.google.com/goto?url=CAESABC123&ved=2ahUKE";

describe("serper google redirect links", () => {
  it("knows a Google redirect link", () => {
    expect(isGoogleRedirect(GOTO)).toBe(true);
    expect(isGoogleRedirect("https://google.com/goto?url=x")).toBe(true);
    expect(isGoogleRedirect("https://www.google.com/url?q=https://clubx.example/")).toBe(true);
    expect(isGoogleRedirect("https://www.google.co.uk/goto?url=x")).toBe(true);
    expect(isGoogleRedirect("https://www.clubx.example/goto")).toBe(false);
    expect(isGoogleRedirect("https://www.google.com/maps/place/Club+X")).toBe(false);
    expect(isGoogleRedirect("not a url")).toBe(false);
  });

  it("drops redirect links from the leads and counts them", () => {
    const body = JSON.stringify({
      organic: [
        { title: "Salsa at Club X", link: "https://www.clubx.example/events", position: 1 },
        { title: "Hidden", link: GOTO, position: 4 },
        { title: "Hidden 2", link: "https://www.google.com/goto?url=CAESDEF", position: 5 },
        { title: "Tango Y", link: "https://tangoy.example/", position: 6 },
      ],
    });
    const leads = organicLeads(body, { family: "salsa", q: "salsa social New York", page: 1 });
    expect(leads.map((l) => l.host)).toEqual(["clubx.example", "tangoy.example"]);
    expect(leads.map((l) => l.position)).toEqual([1, 6]);
    expect(googleRedirectCount(body)).toBe(2);
  });

  it("counts zero on a body with no redirects or that is not JSON", () => {
    expect(googleRedirectCount(JSON.stringify({ organic: [{ link: "https://a.example/" }] }))).toBe(
      0,
    );
    expect(googleRedirectCount(JSON.stringify({}))).toBe(0);
    expect(googleRedirectCount("not json")).toBe(0);
  });
});
