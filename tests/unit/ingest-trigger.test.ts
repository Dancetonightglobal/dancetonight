import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INGEST_CRONS,
  slotAt,
  dispatchInputs,
  triggerIngest,
  INGEST_DISPATCH_URL,
  isLondonMinute,
  londonDispatchInputs,
  DAILY_METROS,
  dailyMetrosAt,
  metroDispatchInputs,
} from "../../src/edge/ingest-trigger";
import { ROW_ONLY_METROS } from "@/src/db/seed/metros";

describe("slotAt", () => {
  it("returns morning for 13:27 UTC in summer (EDT)", () => {
    const date = new Date("2026-10-19T13:27:00Z");
    expect(slotAt(date)).toBe("morning");
  });
  it("returns null for 14:27 UTC in summer (EDT)", () => {
    const date = new Date("2026-10-19T14:27:00Z");
    expect(slotAt(date)).toBe(null);
  });
  it("returns morning for 14:27 UTC in winter (EST)", () => {
    const date = new Date("2026-12-01T14:27:00Z");
    expect(slotAt(date)).toBe("morning");
  });
  it("returns null for 13:27 UTC in winter (EST)", () => {
    const date = new Date("2026-12-01T13:27:00Z");
    expect(slotAt(date)).toBe(null);
  });
  it("returns afternoon for 18:27:30 UTC (EDT)", () => {
    const date = new Date("2026-10-19T18:27:30Z");
    expect(slotAt(date)).toBe("afternoon");
  });
  it("returns afternoon for 19:27 UTC in winter (EST)", () => {
    const date = new Date("2026-12-01T19:27:00Z");
    expect(slotAt(date)).toBe("afternoon");
  });
  it("returns null for 18:28 UTC", () => {
    const date = new Date("2026-10-19T18:28:00Z");
    expect(slotAt(date)).toBe(null);
  });
  it("returns null for 2026-07-15T07:27:00Z (London minute)", () => {
    const date = new Date("2026-07-15T07:27:00Z");
    expect(slotAt(date)).toBe(null);
  });
  it("returns null for 2026-12-15T07:27:00Z (London minute)", () => {
    const date = new Date("2026-12-15T07:27:00Z");
    expect(slotAt(date)).toBe(null);
  });
});

describe("dispatchInputs", () => {
  it("morning on 2026-11-01T14:27Z (Nov 1 in New York) includes seed_venues true and discover true", () => {
    const date = new Date("2026-11-01T14:27:00Z");
    const inputs = dispatchInputs("morning", date);
    expect(inputs).toEqual({
      metro: "nyc",
      full_read: "true",
      discover: "true",
      seed_venues: "true",
    });
  });
  it("morning on 2026-10-19 has seed_venues false", () => {
    const date = new Date("2026-10-19T13:27:00Z");
    const inputs = dispatchInputs("morning", date);
    expect(inputs.seed_venues).toBe("false");
    expect(inputs.discover).toBe("true");
    expect(inputs.full_read).toBe("true");
  });
  it("afternoon on 2026-11-01 has seed_venues false and discover false", () => {
    const date = new Date("2026-11-01T19:27:00Z");
    const inputs = dispatchInputs("afternoon", date);
    expect(inputs.seed_venues).toBe("false");
    expect(inputs.discover).toBe("false");
    expect(inputs.full_read).toBe("true");
  });
});

describe("isLondonMinute", () => {
  it("returns true for 2026-07-15T07:27:00Z (BST)", () => {
    const date = new Date("2026-07-15T07:27:00Z");
    expect(isLondonMinute(date)).toBe(true);
  });
  it("returns true for 2026-12-15T07:27:40Z (GMT)", () => {
    const date = new Date("2026-12-15T07:27:40Z");
    expect(isLondonMinute(date)).toBe(true);
  });
  it("returns false for 07:28Z", () => {
    const date = new Date("2026-07-15T07:28:00Z");
    expect(isLondonMinute(date)).toBe(false);
  });
  it("returns false for 08:27Z", () => {
    const date = new Date("2026-07-15T08:27:00Z");
    expect(isLondonMinute(date)).toBe(false);
  });
  it("returns false for 13:27Z", () => {
    const date = new Date("2026-07-15T13:27:00Z");
    expect(isLondonMinute(date)).toBe(false);
  });
});

describe("londonDispatchInputs", () => {
  it("returns seed_venues true on 2026-11-01T07:27:00Z (first of month in London)", () => {
    const date = new Date("2026-11-01T07:27:00Z");
    const inputs = londonDispatchInputs(date);
    expect(inputs).toEqual({
      metro: "london",
      full_read: "true",
      discover: "true",
      seed_venues: "true",
    });
  });
  it("returns seed_venues false on 2026-10-31T07:27:00Z (not first of month)", () => {
    const date = new Date("2026-10-31T07:27:00Z");
    const inputs = londonDispatchInputs(date);
    expect(inputs.seed_venues).toBe("false");
    expect(inputs.metro).toBe("london");
    expect(inputs.discover).toBe("true");
    expect(inputs.full_read).toBe("true");
  });
});

describe("triggerIngest", () => {
  it("does not call fetch when not an ingest minute", async () => {
    const mockFetch = vi.fn();
    const date = new Date("2026-10-19T12:00:00Z");
    const result = await triggerIngest(date, "some-token", mockFetch);
    expect(result).toBe("not an ingest minute");
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("does not call fetch when token is undefined", async () => {
    const mockFetch = vi.fn();
    const date = new Date("2026-10-19T13:27:00Z");
    const result = await triggerIngest(date, undefined, mockFetch);
    expect(result).toBe("INGEST_DISPATCH_TOKEN is not set");
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it("posts correctly and returns success message on 204", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    });
    const date = new Date("2026-12-15T14:27:00Z");
    const result = await triggerIngest(date, "some-token", mockFetch);
    expect(result).toBe("dispatched the morning ingest");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe(INGEST_DISPATCH_URL);
    expect(options.method).toBe("POST");
    expect(options.headers.authorization).toBe("Bearer some-token");
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      ref: "main",
      inputs: dispatchInputs("morning", date),
    });
  });
  it("throws on non-2xx response without exposing token", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Bad credentials"),
    });
    const date = new Date("2026-12-15T14:27:00Z");
    await expect(triggerIngest(date, "secret-token", mockFetch)).rejects.toThrow(
      /ingest dispatch failed: 401 Bad credentials/,
    );
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(options.headers.authorization).toBe("Bearer secret-token");
    // Ensure the error message does NOT contain the token
    await expect(triggerIngest(date, "secret-token", mockFetch)).rejects.not.toThrow(
      /secret-token/,
    );
  });
  it("dispatches london ingest at 07:27 UTC", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      text: () => Promise.resolve(""),
    });
    const date = new Date("2026-12-15T07:27:00Z");
    const result = await triggerIngest(date, "some-token", mockFetch);
    expect(result).toBe("dispatched the london ingest");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe(INGEST_DISPATCH_URL);
    expect(options.method).toBe("POST");
    expect(options.headers.authorization).toBe("Bearer some-token");
    const body = JSON.parse(options.body);
    expect(body).toEqual({
      ref: "main",
      inputs: londonDispatchInputs(date),
    });
    expect(body.inputs.metro).toBe("london");
  });
});

describe("the daily metros (D-300)", () => {
  const ok = () =>
    vi.fn().mockResolvedValue({ ok: true, status: 204, text: () => Promise.resolve("") });
  const metrosOf = (fetchFn: ReturnType<typeof vi.fn>) =>
    fetchFn.mock.calls.map(([, options]) => JSON.parse(options.body).inputs.metro);

  it("lists daily metros with staggered UTC start times", () => {
    expect(DAILY_METROS).toEqual([
      { slug: "buenos-aires", tz: "America/Argentina/Buenos_Aires", hourUtc: 10, minuteUtc: 27 },
      { slug: "rio-de-janeiro", tz: "America/Sao_Paulo", hourUtc: 10, minuteUtc: 57 },
      { slug: "philadelphia", tz: "America/New_York", hourUtc: 11, minuteUtc: 27 },
      { slug: "miami", tz: "America/New_York", hourUtc: 11, minuteUtc: 57 },
      { slug: "raleigh", tz: "America/New_York", hourUtc: 12, minuteUtc: 27 },
      { slug: "san-juan", tz: "America/Puerto_Rico", hourUtc: 12, minuteUtc: 57 },
      { slug: "medellin", tz: "America/Bogota", hourUtc: 13, minuteUtc: 57 },
      { slug: "mexico-city", tz: "America/Mexico_City", hourUtc: 15, minuteUtc: 27 },
      { slug: "new-orleans", tz: "America/Chicago", hourUtc: 15, minuteUtc: 57 },
      { slug: "istanbul", tz: "Europe/Istanbul", hourUtc: 5, minuteUtc: 57 },
      { slug: "barcelona", tz: "Europe/Madrid", hourUtc: 6, minuteUtc: 27 },
      { slug: "lisbon", tz: "Europe/Lisbon", hourUtc: 6, minuteUtc: 57 },
      { slug: "mumbai", tz: "Asia/Kolkata", hourUtc: 2, minuteUtc: 57 },
      { slug: "delhi", tz: "Asia/Kolkata", hourUtc: 2, minuteUtc: 27 },
      { slug: "hong-kong", tz: "Asia/Hong_Kong", hourUtc: 3, minuteUtc: 27 },
      { slug: "dubai", tz: "Asia/Dubai", hourUtc: 3, minuteUtc: 57 },
      { slug: "pune", tz: "Asia/Kolkata", hourUtc: 1, minuteUtc: 57 },
      { slug: "beirut", tz: "Asia/Beirut", hourUtc: 4, minuteUtc: 27 },
      { slug: "paris", tz: "Europe/Paris", hourUtc: 5, minuteUtc: 27 },
      { slug: "berlin", tz: "Europe/Berlin", hourUtc: 7, minuteUtc: 57 },
      { slug: "tulum", tz: "America/Cancun", hourUtc: 14, minuteUtc: 57 },
      { slug: "los-angeles", tz: "America/Los_Angeles", hourUtc: 17, minuteUtc: 27 },
      { slug: "nashville", tz: "America/Chicago", hourUtc: 16, minuteUtc: 57 },
      { slug: "tokyo", tz: "Asia/Tokyo", hourUtc: 22, minuteUtc: 27 },
      { slug: "austin", tz: "America/Chicago", hourUtc: 16, minuteUtc: 27 },
      { slug: "marrakesh", tz: "Africa/Casablanca", hourUtc: 8, minuteUtc: 27 },
    ]);
  });

  it("dailyMetrosAt returns metros whose hourUtc and minuteUtc match", () => {
    expect(dailyMetrosAt(new Date("2026-07-15T10:27:00Z")).map((m) => m.slug)).toEqual([
      "buenos-aires",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T10:57:00Z")).map((m) => m.slug)).toEqual([
      "rio-de-janeiro",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T11:27:00Z")).map((m) => m.slug)).toEqual([
      "philadelphia",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T11:57:00Z")).map((m) => m.slug)).toEqual(["miami"]);
    expect(dailyMetrosAt(new Date("2026-12-15T12:27:00Z")).map((m) => m.slug)).toEqual(["raleigh"]);
    expect(dailyMetrosAt(new Date("2026-12-15T16:57:00Z")).map((m) => m.slug)).toEqual([
      "nashville",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T12:57:00Z")).map((m) => m.slug)).toEqual([
      "san-juan",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T13:57:00Z")).map((m) => m.slug)).toEqual([
      "medellin",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T15:27:00Z")).map((m) => m.slug)).toEqual([
      "mexico-city",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T15:57:00Z")).map((m) => m.slug)).toEqual([
      "new-orleans",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T05:57:00Z")).map((m) => m.slug)).toEqual([
      "istanbul",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T06:27:00Z")).map((m) => m.slug)).toEqual([
      "barcelona",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T06:57:00Z")).map((m) => m.slug)).toEqual(["lisbon"]);
    expect(dailyMetrosAt(new Date("2026-12-15T02:57:00Z")).map((m) => m.slug)).toEqual(["mumbai"]);
    expect(dailyMetrosAt(new Date("2026-12-15T02:27:00Z")).map((m) => m.slug)).toEqual(["delhi"]);
    expect(dailyMetrosAt(new Date("2026-12-15T03:27:00Z")).map((m) => m.slug)).toEqual([
      "hong-kong",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T03:57:00Z")).map((m) => m.slug)).toEqual(["dubai"]);
    expect(dailyMetrosAt(new Date("2026-12-15T01:57:00Z")).map((m) => m.slug)).toEqual(["pune"]);
    expect(dailyMetrosAt(new Date("2026-12-15T04:27:00Z")).map((m) => m.slug)).toEqual(["beirut"]);
    expect(dailyMetrosAt(new Date("2026-07-15T04:27:00Z")).map((m) => m.slug)).toEqual(["beirut"]);
    expect(dailyMetrosAt(new Date("2026-11-08T22:27:00Z")).map((m) => m.slug)).toEqual(["tokyo"]);
    expect(dailyMetrosAt(new Date("2026-11-07T08:27:00Z")).map((m) => m.slug)).toEqual([
      "marrakesh",
    ]);
    expect(dailyMetrosAt(new Date("2026-11-07T07:27:00Z")).map((m) => m.slug)).toEqual([]);
    expect(dailyMetrosAt(new Date("2026-12-15T05:27:00Z")).map((m) => m.slug)).toEqual(["paris"]);
    expect(dailyMetrosAt(new Date("2026-07-15T05:27:00Z")).map((m) => m.slug)).toEqual(["paris"]);
    expect(dailyMetrosAt(new Date("2026-12-15T07:57:00Z")).map((m) => m.slug)).toEqual(["berlin"]);
    expect(dailyMetrosAt(new Date("2026-12-15T14:57:00Z")).map((m) => m.slug)).toEqual(["tulum"]);
    expect(dailyMetrosAt(new Date("2026-07-15T14:57:00Z")).map((m) => m.slug)).toEqual(["tulum"]);
    expect(dailyMetrosAt(new Date("2026-12-15T17:27:00Z")).map((m) => m.slug)).toEqual([
      "los-angeles",
    ]);
    expect(dailyMetrosAt(new Date("2026-12-15T16:27:00Z")).map((m) => m.slug)).toEqual(["austin"]);
    expect(dailyMetrosAt(new Date("2026-07-15T16:27:00Z")).map((m) => m.slug)).toEqual(["austin"]);
    expect(dailyMetrosAt(new Date("2026-12-15T13:27:00Z"))).toEqual([]);
    expect(dailyMetrosAt(new Date("2026-12-15T14:27:00Z"))).toEqual([]);
    expect(dailyMetrosAt(new Date("2026-12-15T18:27:00Z"))).toEqual([]);
    expect(dailyMetrosAt(new Date("2026-12-15T19:27:00Z"))).toEqual([]);
    expect(dailyMetrosAt(new Date("2026-12-15T07:27:00Z"))).toEqual([]);
  });

  it("no two entries share (hourUtc, minuteUtc)", () => {
    const seen = new Set<string>();
    for (const m of DAILY_METROS) {
      const key = `${m.hourUtc}:${m.minuteUtc}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("no entry is at 13:27, 14:27, 18:27, 19:27 or 07:27 UTC", () => {
    const forbidden = [
      { hour: 13, minute: 27 },
      { hour: 14, minute: 27 },
      { hour: 18, minute: 27 },
      { hour: 19, minute: 27 },
      { hour: 7, minute: 27 },
    ];
    for (const m of DAILY_METROS) {
      expect(forbidden.some((f) => f.hour === m.hourUtc && f.minute === m.minuteUtc)).toBe(false);
    }
  });

  it("every entry's minute is matched by a cron in INGEST_CRONS", () => {
    const minutes = new Set(INGEST_CRONS.map((c) => parseInt(c.split(" ")[0] ?? "", 10)));
    for (const m of DAILY_METROS) {
      expect(minutes.has(m.minuteUtc)).toBe(true);
    }
  });

  it("every daily metro is a real metro row (ROW_ONLY_METROS)", () => {
    for (const m of DAILY_METROS) expect(Object.keys(ROW_ONLY_METROS)).toContain(m.slug);
  });

  it("metroDispatchInputs: full read with discovery, re-seed on the 1st in the metro's zone", () => {
    expect(
      metroDispatchInputs("new-orleans", "America/Chicago", new Date("2026-11-01T15:57:00Z")),
    ).toEqual({ metro: "new-orleans", full_read: "true", discover: "true", seed_venues: "true" });
    expect(
      metroDispatchInputs("philadelphia", "America/New_York", new Date("2026-10-31T11:27:00Z")),
    ).toEqual({ metro: "philadelphia", full_read: "true", discover: "true", seed_venues: "false" });
    // 03:30 UTC on Nov 1 is still Oct 31 in Chicago.
    expect(
      metroDispatchInputs("new-orleans", "America/Chicago", new Date("2026-11-01T03:30:00Z"))
        .seed_venues,
    ).toBe("false");
  });

  it("londonDispatchInputs is metroDispatchInputs for london", () => {
    const date = new Date("2026-11-01T07:27:00Z");
    expect(londonDispatchInputs(date)).toEqual(
      metroDispatchInputs("london", "Europe/London", date),
    );
  });

  it("in summer, 13:27 UTC dispatches New York's morning read and no daily metro", async () => {
    const fetchFn = ok();
    const date = new Date("2026-07-15T13:27:00Z");
    const result = await triggerIngest(date, "some-token", fetchFn);
    expect(metrosOf(fetchFn)).toEqual(["nyc"]);
    expect(JSON.parse(fetchFn.mock.calls[0]![1].body).inputs).toEqual(
      dispatchInputs("morning", date),
    );
    expect(result).toBe("dispatched the morning ingest");
  });

  it("in winter, 13:27 UTC dispatches nothing for daily metros (only New York in summer)", async () => {
    const fetchFn = ok();
    const result = await triggerIngest(new Date("2026-11-01T13:27:00Z"), "some-token", fetchFn);
    expect(metrosOf(fetchFn)).toEqual([]);
    expect(result).toBe("not an ingest minute");
  });

  it("triggerIngest at 2026-11-01T10:27:00Z dispatches exactly buenos-aires", async () => {
    const fetchFn = ok();
    const result = await triggerIngest(new Date("2026-11-01T10:27:00Z"), "some-token", fetchFn);
    expect(metrosOf(fetchFn)).toEqual(["buenos-aires"]);
    expect(result).toBe("dispatched the buenos-aires ingest");
  });

  it("triggerIngest at 2026-11-01T15:57:00Z dispatches exactly new-orleans", async () => {
    const fetchFn = ok();
    const result = await triggerIngest(new Date("2026-11-01T15:57:00Z"), "some-token", fetchFn);
    expect(metrosOf(fetchFn)).toEqual(["new-orleans"]);
    expect(result).toBe("dispatched the new-orleans ingest");
  });

  it("triggerIngest at 2026-11-01T06:27:00Z dispatches exactly barcelona", async () => {
    const fetchFn = ok();
    const result = await triggerIngest(new Date("2026-11-01T06:27:00Z"), "some-token", fetchFn);
    expect(metrosOf(fetchFn)).toEqual(["barcelona"]);
    expect(result).toBe("dispatched the barcelona ingest");
  });

  it("triggerIngest at 2026-11-01T07:27:00Z dispatches exactly london", async () => {
    const fetchFn = ok();
    const result = await triggerIngest(new Date("2026-11-01T07:27:00Z"), "some-token", fetchFn);
    expect(metrosOf(fetchFn)).toEqual(["london"]);
    expect(result).toBe("dispatched the london ingest");
  });

  it("one failed dispatch does not stop the others, and the error names it", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: () => Promise.resolve("boom") });
    await expect(
      triggerIngest(new Date("2026-12-15T10:27:00Z"), "secret-token", fetchFn),
    ).rejects.toThrow(/ingest dispatch failed: 500 boom \(buenos-aires\)/);
    expect(metrosOf(fetchFn)).toEqual(["buenos-aires"]);
  });

  it("no token: nothing is dispatched", async () => {
    const fetchFn = ok();
    const result = await triggerIngest(new Date("2026-12-15T11:27:00Z"), undefined, fetchFn);
    expect(result).toBe("INGEST_DISPATCH_TOKEN is not set");
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("INGEST_CRONS", () => {
  it("has two entries", () => {
    expect(INGEST_CRONS).toHaveLength(2);
  });
  it("each entry is a 5-field cron", () => {
    INGEST_CRONS.forEach((cron) => {
      expect(cron).toMatch(/^\d+ \* \* \* \*$/);
    });
  });
});

describe("03:27 UTC cron (Asia)", () => {
  it("does not trigger NYC or London, and dailyMetrosAt returns metros at hour 3 minute 27 (hong-kong)", () => {
    const date = new Date("2026-11-02T03:27:00Z");
    expect(slotAt(date)).toBe(null);
    expect(isLondonMinute(date)).toBe(false);
    expect(dailyMetrosAt(date)).toEqual([
      { slug: "hong-kong", tz: "Asia/Hong_Kong", hourUtc: 3, minuteUtc: 27 },
    ]);
  });
  it("at 03:28 UTC returns empty", () => {
    const date = new Date("2026-11-02T03:28:00Z");
    expect(dailyMetrosAt(date)).toEqual([]);
  });
});

describe("wrangler.jsonc", () => {
  it("lists exactly INGEST_CRONS as the Worker's cron triggers", () => {
    const config = readFileSync(join(process.cwd(), "wrangler.jsonc"), "utf8");
    const crons = config.match(/"crons":\s*\[([^\]]*)\]/)?.[1] ?? "";
    expect(crons.match(/"[^"]+"/g)?.map((c) => c.slice(1, -1))).toEqual([...INGEST_CRONS]);
  });
});
