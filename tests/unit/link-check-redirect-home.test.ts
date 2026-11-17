import { describe, expect, it } from "vitest";
import {
  createPoliteHttp,
  type TransportRequest,
  type TransportResponse,
} from "@/src/pipeline/http";
import { checkLink, isHomePagePath, redirectedToHome } from "@/src/pipeline/link-check";

// D-828: a card link that redirects to the site's home page answers 200, but the night's own
// page is gone (lindygroove.com/events -> lindygroove.la/, LA daily 2026-11-09). Treat it as no link.

const userAgent = "test";
const sleep = async () => {};

/** A transport that answers `requested` with 200 at `finalUrl` (as fetch reports after redirects). */
function http(requested: string, finalUrl: string) {
  const transport = async (req: TransportRequest): Promise<TransportResponse> => {
    if (req.url.endsWith("/robots.txt")) {
      return { url: req.url, status: 404, headers: {}, body: "" };
    }
    if (req.url === requested) {
      return { url: finalUrl, status: 200, headers: {}, body: "<html></html>" };
    }
    throw new Error(`No response for ${req.url}`);
  };
  return createPoliteHttp({ transport, userAgent, sleep });
}

describe("isHomePagePath", () => {
  it.each(["/", "", "/index.html", "/index.php", "/en", "/en/", "/en-us/", "/pt-BR"])(
    "%s is a home page",
    (path) => {
      expect(isHomePagePath(path)).toBe(true);
    },
  );

  it.each(["/events", "/events/", "/e/salsa-night", "/about", "/eng", "/2026/11/12/"])(
    "%s is not a home page",
    (path) => {
      expect(isHomePagePath(path)).toBe(false);
    },
  );
});

describe("redirectedToHome", () => {
  it("is true when an inner page lands on another host's root", () => {
    expect(redirectedToHome("https://lindygroove.com/events", "https://lindygroove.la/")).toBe(
      true,
    );
  });

  it("is true when an inner page lands on its own root, query or not", () => {
    expect(redirectedToHome("https://a.org/events/123", "https://a.org/?from=404")).toBe(true);
    expect(redirectedToHome("https://a.org/events/123", "https://www.a.org/en/")).toBe(true);
  });

  it("is false when the link was a home page to begin with", () => {
    expect(redirectedToHome("https://a.org/", "https://a.org/")).toBe(false);
    expect(redirectedToHome("https://a.org", "https://www.a.org/")).toBe(false);
    expect(redirectedToHome("https://a.org/en/", "https://a.org/")).toBe(false);
  });

  it("is false when the final page is an inner page", () => {
    expect(redirectedToHome("https://a.org/events", "https://a.org/events/")).toBe(false);
    expect(redirectedToHome("https://a.org/e/1", "https://b.org/tickets/1")).toBe(false);
  });

  it("is false for no redirect or an unreadable URL", () => {
    expect(redirectedToHome("https://a.org/events", "https://a.org/events")).toBe(false);
    expect(redirectedToHome("not a url", "https://a.org/")).toBe(false);
    expect(redirectedToHome("https://a.org/events", "")).toBe(false);
  });
});

describe("checkLink and a redirect to the home page", () => {
  it("calls a redirect to the home page missing", async () => {
    const verdict = await checkLink(
      http("https://lindygroove.com/events", "https://lindygroove.la/"),
      "https://lindygroove.com/events",
    );
    expect(verdict).toEqual({ kind: "missing", reason: "redirected to home page" });
  });

  it("keeps a home-page link that stays a home page ok", async () => {
    const verdict = await checkLink(http("https://a.org/", "https://a.org/"), "https://a.org/");
    expect(verdict).toEqual({ kind: "ok" });
  });

  it("keeps a redirect to another inner page ok", async () => {
    const verdict = await checkLink(
      http("https://a.org/events/1", "https://a.org/events/1/"),
      "https://a.org/events/1",
    );
    expect(verdict).toEqual({ kind: "ok" });
  });

  it("ignores the fragment when it compares", async () => {
    const verdict = await checkLink(
      http("https://a.org/#:~:text=Salsa", "https://a.org/"),
      "https://a.org/#:~:text=Salsa",
    );
    expect(verdict).toEqual({ kind: "ok" });
  });
});
