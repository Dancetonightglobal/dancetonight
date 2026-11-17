// D-834: the daily site check's day pages retry a 429 (our own per-IP render limit, D-153). On
// 2026-11-10 63 of 196 day pages came back 429 and were reported as findings.
import { describe, expect, it } from "vitest";
import { fetchWithRetry, rateLimitWaitMs } from "@/src/jobs/site-scan";

function scripted(statuses: Array<number | Error>, headers: Record<string, string> = {}) {
  const calls: string[] = [];
  const fake = (async (url: string) => {
    calls.push(String(url));
    const next = statuses.shift();
    if (next === undefined) throw new Error("no more answers");
    if (next instanceof Error) throw next;
    return new Response(next === 200 ? "<html>ok</html>" : "Too Many Requests", {
      status: next,
      headers,
    });
  }) as unknown as typeof fetch;
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  return { fake, calls, sleeps, sleep };
}

describe("fetchWithRetry (D-834)", () => {
  it("retries a 429 and returns the page", async () => {
    const s = scripted([429, 429, 200]);
    const response = await fetchWithRetry("https://x.example/nyc?day=2026-11-10", 1000, {
      fetch: s.fake,
      sleep: s.sleep,
    });
    expect(response.status).toBe(200);
    expect(s.calls).toHaveLength(3);
    expect(s.sleeps).toEqual([2000, 4000]);
  });

  it("gives up after four 429 retries and returns the 429", async () => {
    const s = scripted([429, 429, 429, 429, 429]);
    const response = await fetchWithRetry("https://x.example/a", 1000, {
      fetch: s.fake,
      sleep: s.sleep,
    });
    expect(response.status).toBe(429);
    expect(s.calls).toHaveLength(5);
  });

  it("honours Retry-After", async () => {
    const s = scripted([429, 200], { "retry-after": "7" });
    await fetchWithRetry("https://x.example/a", 1000, { fetch: s.fake, sleep: s.sleep });
    expect(s.sleeps).toEqual([7000]);
  });

  it("still retries a 5xx once and a network error once", async () => {
    const a = scripted([503, 200]);
    expect(
      (await fetchWithRetry("https://x.example/a", 1000, { fetch: a.fake, sleep: a.sleep })).status,
    ).toBe(200);
    const b = scripted([new Error("reset"), 200]);
    expect(
      (await fetchWithRetry("https://x.example/a", 1000, { fetch: b.fake, sleep: b.sleep })).status,
    ).toBe(200);
    const c = scripted([new Error("reset"), new Error("reset")]);
    await expect(
      fetchWithRetry("https://x.example/a", 1000, { fetch: c.fake, sleep: c.sleep }),
    ).rejects.toThrow("reset");
  });
});

describe("rateLimitWaitMs", () => {
  it("caps Retry-After at 60 s and backs off without it", () => {
    expect(rateLimitWaitMs("120", 0)).toBe(60_000);
    expect(rateLimitWaitMs(null, 3)).toBe(16_000);
    expect(rateLimitWaitMs("soon", 1)).toBe(4000);
  });
});
