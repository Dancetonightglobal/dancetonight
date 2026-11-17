// The proxy when the database cannot answer (D-092): it steps aside, so the event page's own path
// and its error handling decide, rather than a bare 500 from the proxy.

import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";

vi.mock("@/src/data", () => ({
  getProxyRepository: () => ({
    resolveSlug: () => Promise.reject(new Error("connect ECONNREFUSED")),
  }),
}));

const { proxy } = await import("@/proxy");

it("lets the request through when the lookup fails", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const res = await proxy(new NextRequest(new URL("https://dancetonight.test/e/some-night")));
  expect(res.headers.get("x-middleware-next")).toBe("1");
  expect(res.status).toBe(200);
});
