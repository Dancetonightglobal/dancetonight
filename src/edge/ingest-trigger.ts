/**
 * Trigger the ingest workflow from a Cloudflare cron.
 *
 * GitHub's scheduled runs start 3-6 hours late (or not at all). This Worker uses Cloudflare Cron
 * Triggers (punctual, free) to dispatch the ingest.yml workflow via GitHub's workflow_dispatch API,
 * which starts at once. The GitHub schedule remains as a backup that skips when a dispatched run
 * already covered its slot.
 */

/** UTC crons for the two New York slots (morning 09:27, afternoon 14:27), London's daily run,
 * and the daily metros (DAILY_METROS) each have their own start minute, 30 minutes apart,
 * never on New York's or London's minutes (D-566, 2026-11-01 outage).
 *
 * New York is UTC-4 in summer (EDT) and UTC-5 in winter (EST). Each slot has two UTC crons;
 * only the one that lands on the New York time dispatches.
 * London's one run at 07:27 UTC (D-201).
 * The daily metros (DAILY_METROS) ride the :27 and :57 minutes of each hour, staggered so no two
 * full reads start together.
 */
export const INGEST_CRONS = ["27 * * * *", "57 * * * *"] as const;

export type IngestSlot = "morning" | "afternoon";

type DailyMetro = { slug: string; tz: string; hourUtc: number; minuteUtc: 27 | 57 };

/**
 * Metros read once a day from an existing cron (D-300): each has its own start minute,
 * 30 minutes apart, never on New York's or London's minutes (D-566, 2026-11-01 outage).
 * Order is dispatch order.
 */
export const DAILY_METROS: readonly DailyMetro[] = [
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
  { slug: "delhi", tz: "Asia/Kolkata", hourUtc: 2, minuteUtc: 27 }, // 7:57am IST (D-1140)
  { slug: "hong-kong", tz: "Asia/Hong_Kong", hourUtc: 3, minuteUtc: 27 },
  { slug: "dubai", tz: "Asia/Dubai", hourUtc: 3, minuteUtc: 57 }, // 7:57am Dubai (D-1060)
  { slug: "pune", tz: "Asia/Kolkata", hourUtc: 1, minuteUtc: 57 }, // 7:27am IST (D-1120)
  { slug: "beirut", tz: "Asia/Beirut", hourUtc: 4, minuteUtc: 27 }, // 6:27am EET, 7:27am EEST (D-1000)
  { slug: "paris", tz: "Europe/Paris", hourUtc: 5, minuteUtc: 27 }, // 6:27am CET, 7:27am CEST (D-1040)
  { slug: "berlin", tz: "Europe/Berlin", hourUtc: 7, minuteUtc: 57 }, // 8:57am CET, 9:57am CEST (D-1020)
  { slug: "tulum", tz: "America/Cancun", hourUtc: 14, minuteUtc: 57 }, // 8:57am Tulum, no DST (D-1080)
  { slug: "los-angeles", tz: "America/Los_Angeles", hourUtc: 17, minuteUtc: 27 }, // 9:27am PST, 10:27am PDT (D-1160)
  { slug: "nashville", tz: "America/Chicago", hourUtc: 16, minuteUtc: 57 }, // 10:57am CST, 11:57am CDT (D-1200)
  { slug: "tokyo", tz: "Asia/Tokyo", hourUtc: 22, minuteUtc: 27 }, // 7:27am JST, no DST (D-1221)
  { slug: "austin", tz: "America/Chicago", hourUtc: 16, minuteUtc: 27 }, // 10:27am CST, 11:27am CDT (D-1180)
  { slug: "marrakesh", tz: "Africa/Casablanca", hourUtc: 8, minuteUtc: 27 }, // 9:27am (UTC+1), 8:27am in Ramadan (D-1100)
];

/**
 * Whether the cron still reads London and the daily metros on their own schedule. False since
 * D-899 (the owner, 2026-11-27): only New York is read on a schedule; every other city is read
 * when someone opens it. Set true to go back to one read a day for every city.
 */
export const SCHEDULED_ALL_METROS = false;

/** Every city read on demand (D-899): London and the daily metros, with their zones. */
export const ON_DEMAND_METROS: readonly { slug: string; tz: string }[] = [
  { slug: "london", tz: "Europe/London" },
  ...DAILY_METROS.map(({ slug, tz }) => ({ slug, tz })),
];

/** The on-demand city with this slug, or null (New York and unknown slugs). */
export function onDemandMetro(slug: string): { slug: string; tz: string } | null {
  return ON_DEMAND_METROS.find((m) => m.slug === slug) ?? null;
}

/**
 * Read the New York wall clock of `when` and return the ingest slot if it matches 09:27 or 14:27.
 * Seconds are ignored (a cron fires within the minute).
 */
export function slotAt(when: Date): IngestSlot | null {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(when);
  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  if (!hour || !minute) return null;
  const h = parseInt(hour, 10);
  const m = parseInt(minute, 10);
  if (h === 9 && m === 27) return "morning";
  if (h === 14 && m === 27) return "afternoon";
  return null;
}

/**
 * Build the inputs object for a workflow_dispatch call.
 *
 * Values are strings because GitHub's dispatch API expects string inputs.
 */
export function dispatchInputs(slot: IngestSlot, when: Date): Record<string, string> {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", day: "2-digit" })
    .formatToParts(when)
    .find((p) => p.type === "day")?.value;
  const isFirstOfMonth = day === "01";
  return {
    metro: "nyc",
    full_read: "true",
    discover: slot === "morning" ? "true" : "false",
    seed_venues: slot === "morning" && isFirstOfMonth ? "true" : "false",
  };
}

/** Whether `when` is London's daily ingest minute: 07:27 UTC, seconds ignored (D-201). */
export function isLondonMinute(when: Date): boolean {
  return when.getUTCHours() === 7 && when.getUTCMinutes() === 27;
}

/** The daily metros due at `when`: minute matches minuteUtc, hour matches hourUtc, seconds ignored (D-300). */
export function dailyMetrosAt(when: Date): readonly DailyMetro[] {
  const hour = when.getUTCHours();
  const minute = when.getUTCMinutes();
  return DAILY_METROS.filter((m) => m.hourUtc === hour && m.minuteUtc === minute);
}

/** Build inputs for any metro with timezone-based seed_venues logic. */
export function metroDispatchInputs(metro: string, tz: string, when: Date): Record<string, string> {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: tz, day: "2-digit" })
    .formatToParts(when)
    .find((p) => p.type === "day")?.value;
  const isFirstOfMonth = day === "01";
  return {
    metro,
    full_read: "true",
    discover: "true",
    seed_venues: isFirstOfMonth ? "true" : "false",
  };
}

/** London's dispatch inputs: a full read, discovery, and the venue re-seed on the 1st (London date). */
export function londonDispatchInputs(when: Date): Record<string, string> {
  return metroDispatchInputs("london", "Europe/London", when);
}

export const INGEST_DISPATCH_URL =
  "https://api.github.com/repos/dancetonightglobal/dancetonight/actions/workflows/ingest.yml/dispatches";

/**
 * Trigger the ingest workflow dispatch.
 *
 * @param when The scheduled time (from controller.scheduledTime).
 * @param token fine-grained GitHub token with Actions read and write on this repository.
 * @param fetchFn Fetch implementation (defaults to global fetch).
 * @returns A success message or a reason why no dispatch was attempted.
 * @throws {Error} When any HTTP request fails with a non-2xx status.
 */
export async function triggerIngest(
  when: Date,
  token: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<string> {
  // Build the list of dispatches in order
  const dispatches: Array<{
    inputs: Record<string, string>;
    label: string;
    metro: string;
  }> = [];

  const slot = slotAt(when);
  if (slot) {
    dispatches.push({
      inputs: dispatchInputs(slot, when),
      label: `the ${slot} ingest`,
      metro: "nyc",
    });
  }

  // London and the daily metros are read on demand only (D-899): when someone opens the city,
  // src/edge/on-demand.ts starts its read. Their slots above stay as data (each city's zone).
  if (SCHEDULED_ALL_METROS) {
    if (isLondonMinute(when)) {
      dispatches.push({
        inputs: londonDispatchInputs(when),
        label: "the london ingest",
        metro: "london",
      });
    }

    for (const { slug, tz } of dailyMetrosAt(when)) {
      dispatches.push({
        inputs: metroDispatchInputs(slug, tz, when),
        label: `the ${slug} ingest`,
        metro: slug,
      });
    }
  }

  if (dispatches.length === 0) {
    return "not an ingest minute";
  }

  if (!token) {
    console.warn("INGEST_DISPATCH_TOKEN is not set");
    return "INGEST_DISPATCH_TOKEN is not set";
  }

  const url = INGEST_DISPATCH_URL;
  const headers = {
    authorization: `Bearer ${token}`,
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "dancetonight-cron",
    "content-type": "application/json",
  };

  const failures: string[] = [];
  const labels: string[] = [];

  for (const { inputs, label, metro } of dispatches) {
    const body = JSON.stringify({
      ref: "main",
      inputs,
    });

    try {
      const response = await fetchFn(url, {
        method: "POST",
        headers,
        body,
      });

      if (response.ok) {
        labels.push(label);
      } else {
        const text = await response.text();
        const truncated = text.slice(0, 200);
        failures.push(`${response.status} ${truncated} (${metro})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const truncated = message.slice(0, 200);
      failures.push(`error ${truncated} (${metro})`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`ingest dispatch failed: ${failures.join("; ")}`);
  }

  return `dispatched ${labels.join(", ")}`;
}
