import { describe, it, expect } from "vitest";
import { CANONICAL_HOST, canonicalRedirect } from "../../src/edge/canonical-host";

const get = (url: string) => new Request(url);

describe("canonicalRedirect", () => {
  it("is the .com apex", () => {
    expect(CANONICAL_HOST).toBe("dancetonightglobal.com");
  });

  it.each(["www.dancetonightglobal.com", "dancetonight.app", "www.dancetonight.app"])(
    "sends %s to the .com with a 301, keeping path and query",
    (host) => {
      const res = canonicalRedirect(
        get(`https://${host}/e/salsa-2026-10-30-abc123?day=fri&style=salsa`),
      );
      expect(res?.status).toBe(301);
      expect(res?.headers.get("Location")).toBe(
        "https://dancetonightglobal.com/e/salsa-2026-10-30-abc123?day=fri&style=salsa",
      );
    },
  );

  it("sends the bare root to the .com root", () => {
    expect(canonicalRedirect(get("http://dancetonight.app/"))?.headers.get("Location")).toBe(
      "https://dancetonightglobal.com/",
    );
  });

  it("serves the canonical host, workers.dev and localhost as they are", () => {
    expect(canonicalRedirect(get("https://dancetonightglobal.com/bot"))).toBeNull();
    expect(canonicalRedirect(get("https://dancetonight.isaacsuncle.workers.dev/"))).toBeNull();
    expect(canonicalRedirect(get("http://localhost:3000/"))).toBeNull();
  });
});
