// Sabaki Partner API probe (D-892): one read per metro with the repository's key, then the reader's own rules, so a
// day with no Sabaki cards is explained in one minute instead of one ingest run per guess. It writes nothing, reads
// no database, and never prints the key. Started by hand: .github/workflows/sabaki-probe.yml.
//   pnpm -s sabaki:probe            (miami and barcelona)
//   pnpm -s sabaki:probe miami
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

async function main(): Promise<number> {
  const key = process.env.SABAKI_API_KEY?.trim();
  if (!key) {
    console.log("SABAKI_API_KEY is not set");
    return 2;
  }
  const slugs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : Object.keys(METROS);
  for (const slug of slugs) await probe(slug, key);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
