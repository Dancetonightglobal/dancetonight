// Sabaki Partner API probe (D-892): one read per metro with the repository's key, then the reader's own rules, so a
// day with no Sabaki cards is explained in one minute instead of one ingest run per guess. It writes nothing (with
// DATABASE_URL set it also runs read-only SELECTs in a read-only transaction) and never prints the key. Started by
// hand: .github/workflows/sabaki-probe.yml.
//   pnpm -s sabaki:probe            (miami and barcelona)
//   pnpm -s sabaki:probe miami
import postgres from "postgres";
import { SABAKI_MAX_PAGES, sabakiToListings, sabakiUrl } from "@/src/adapters/apis/sabaki";
import type { Metro } from "@/src/adapters/types";
import { BARCELONA_METRO } from "@/src/db/seed/barcelona";
import { MIAMI_METRO } from "@/src/db/seed/miami";
import { currentNightDate } from "@/src/domain/tonight";
import { addCalendarDays } from "@/src/domain/time";

const METROS: Record<string, Metro> = {
  miami: { ...MIAMI_METRO, id: "probe-miami", languages: [...MIAMI_METRO.languages] },
  barcelona: {
    ...BARCELONA_METRO,
    id: "probe-barcelona",
    languages: [...BARCELONA_METRO.languages],
  },
};

/** The response's shape without its values: keys and types, first level and one item. */
function shape(body: unknown): string {
  if (body === null || typeof body !== "object") return typeof body;
  return Object.entries(body as Record<string, unknown>)
    .map(
      ([k, v]) =>
        `${k}: ${Array.isArray(v) ? `array(${v.length})` : v === null ? "null" : typeof v}`,
    )
    .join(", ");
}

async function probe(slug: string, key: string): Promise<void> {
  const metro = METROS[slug];
  if (!metro) {
    console.log(`${slug}: not a Sabaki metro (${Object.keys(METROS).join(", ")})`);
    return;
  }
  const tonight = currentNightDate(new Date(), metro.tz);
  const nights = Array.from({ length: 8 }, (_, i) => addCalendarDays(tonight, i));
  const items: unknown[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < SABAKI_MAX_PAGES; page++) {
    const url = sabakiUrl(metro, cursor);
    const res = await fetch(url, {
      headers: { accept: "application/json", authorization: `Bearer ${key}` },
    });
    const text = await res.text();
    console.log(
      `${slug} page ${page + 1}: HTTP ${res.status} ${url.replace(/^https:\/\/[^/]+/, "")}`,
    );
    for (const h of ["ratelimit-limit", "ratelimit-remaining", "ratelimit-reset", "retry-after"]) {
      const v = res.headers.get(h);
      if (v) console.log(`  ${h}: ${v}`);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      console.log(`  not JSON: ${text.slice(0, 300)}`);
      return;
    }
    if (!res.ok) {
      console.log(`  error body: ${text.slice(0, 300)}`);
      return;
    }
    console.log(`  shape: ${shape(body)}`);
    const b = body as { items?: unknown[]; nextCursor?: unknown };
    if (!Array.isArray(b.items)) return;
    items.push(...b.items);
    if (page === 0 && b.items[0]) console.log(`  first item: ${shape(b.items[0])}`);
    if (typeof b.nextCursor !== "string" || !b.nextCursor) break;
    cursor = b.nextCursor;
  }

  // What came back, by night and city, before the reader's rules.
  const byNight = new Map<string, number>();
  const byCity = new Map<string, number>();
  for (const raw of items) {
    const e = raw as Record<string, unknown>;
    const night = typeof e.startDateTime === "string" ? e.startDateTime.slice(0, 10) : "no start";
    byNight.set(night, (byNight.get(night) ?? 0) + 1);
    const city = String(e.locationCity ?? "no city");
    byCity.set(city, (byCity.get(city) ?? 0) + 1);
  }
  console.log(
    `${slug}: ${items.length} events returned; window ${nights[0]}..${nights[nights.length - 1]}`,
  );
  const nightsSorted = [...byNight.entries()].sort();
  console.log(
    `  start dates: ${nightsSorted
      .slice(0, 12)
      .map(([d, n]) => `${d}=${n}`)
      .join(" ")}${nightsSorted.length > 12 ? " ..." : ""}`,
  );
  console.log(
    `  cities: ${[...byCity.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([c, n]) => `${c}=${n}`)
      .join(", ")}`,
  );

  const { listings, notes, screened } = sabakiToListings(items, {
    metro,
    nights,
    fetchedAt: new Date(),
  });
  const reasons = new Map<string, number>();
  for (const s of screened) reasons.set(s.reason, (reasons.get(s.reason) ?? 0) + 1);
  console.log(
    `  reader: ${listings.length} listings kept, ${screened.length} screened, ${notes.length} notes`,
  );
  for (const [r, n] of reasons) console.log(`    screened ${n}: ${r}`);
  for (const n of notes.slice(0, 5)) console.log(`    note: ${n}`);
  for (const l of listings.slice(0, 8))
    console.log(
      `    kept: ${l.listing.local_date} ${l.listing.doors_time ?? "--:--"} ${l.listing.title} @ ${l.listing.venue.name ?? "?"}`,
    );
  for (const s of screened.slice(0, 5)) console.log(`    screened: ${s.title} (${s.reason})`);
}

/**
 * What the live database says about Sabaki (read-only SELECTs, D-892): its flag rows, its source rows per metro
 * (enabled, next harvest, health), how many stored events it gave, and what each metro's latest runs wrote from it.
 */
async function database(url: string): Promise<void> {
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    await sql.begin("read only", async (tx) => {
      const flags = await tx`
        select f.key, f.scope, m.slug, f.enabled from feature_flags f left join metros m on m.id = f.metro_id
        where f.key ilike '%sabaki%'`;
      console.log(`database: ${flags.length} sabaki flag rows`);
      for (const f of flags)
        console.log(`  flag ${f.key} ${f.scope} ${f.slug ?? "-"} enabled=${f.enabled}`);
      const srcs = await tx`
        select s.url, m.slug, s.enabled, s.next_harvest_at, s.health from sources s
        left join metros m on m.id = s.metro_id
        where s.platform = 'sabaki' or s.url ilike '%sabaki%'`;
      console.log(`database: ${srcs.length} sabaki source rows`);
      for (const r of srcs)
        console.log(
          `  source ${r.url} metro=${r.slug ?? "-"} enabled=${r.enabled} next=${r.next_harvest_at?.toISOString?.() ?? r.next_harvest_at} health=${JSON.stringify(r.health)}`,
        );
      const evs = await tx`
        select m.slug, count(distinct e.id)::int as n, min(e.night_date)::text as first, max(e.night_date)::text as last,
               count(distinct e.id) filter (where e.night_date >= current_date)::int as upcoming
        from event_sources es join sources s on s.id = es.source_id join events e on e.id = es.event_id
        join metros m on m.id = e.metro_id
        where s.platform = 'sabaki' or s.url ilike '%sabaki%' group by m.slug`;
      console.log(`database: events with a Sabaki source: ${evs.length === 0 ? "none" : ""}`);
      for (const r of evs)
        console.log(
          `  ${r.slug}: ${r.n} events (${r.upcoming} upcoming), nights ${r.first}..${r.last}`,
        );
      const runs = await tx`
        select m.slug, j.started_at, j.status, j.error,
               j.stats -> 'listingsBySource' ->> 'https://www.sabaki.com/' as sabaki_written,
               jsonb_typeof(j.stats -> 'listingsBySource') as has_sources
        from job_runs j join metros m on m.id = j.metro_id
        where j.job = 'ingest' and m.slug in ('miami', 'barcelona')
        order by j.started_at desc limit 8`;
      console.log("database: latest ingest runs (miami, barcelona)");
      for (const r of runs)
        console.log(
          `  ${r.slug} ${r.started_at?.toISOString?.() ?? r.started_at} ${r.status} sabaki_written=${r.sabaki_written ?? "absent"}${r.error ? ` error=${String(r.error).slice(0, 120)}` : ""}`,
        );
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<number> {
  const key = process.env.SABAKI_API_KEY?.trim();
  if (!key) {
    console.log("SABAKI_API_KEY is not set");
    return 2;
  }
  const slugs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(METROS);
  for (const slug of slugs) await probe(slug, key);
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    try {
      await database(url);
    } catch (err) {
      console.log(`database: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else console.log("database: DATABASE_URL not set, skipped");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
