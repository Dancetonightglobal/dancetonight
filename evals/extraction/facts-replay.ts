// D-100: replays the live rows' prices, free entry and age limit through the facts check, against
// the page each row's source served, and prints what changes. With no model call: each row's facts
// are rebuilt from what its event page printed (docs/briefs/data: the JSON-LD offers for prices,
// the cost lines for inclusions and "Free", the facts block for the age), as the cached read gave
// them, and checked as `extractionToHarvested` checks a read (`titleBlocks` with `facts`,
// `ownBlockTexts`, `checkListingFacts`). The titles bounding each part are every live row's title
// from the same source: the read's own list is not saved.
//
//   pnpm exec tsx evals/extraction/facts-replay.ts [rows.json facts.json pagesDir]
//
// Defaults: the run-33 baseline in docs/briefs/data.

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import { rawListingSchema } from "@/src/domain/listing";
import { checkListingFacts, organizerFromNeighbour } from "@/src/domain/stated-facts";
import { ownBlockTexts } from "@/src/domain/stated-times";
import { titleBlocks } from "@/src/domain/title-blocks";

const [rowsPath, factsPath, pagesDir] = [
  process.argv[2] ?? "docs/briefs/data/run33-rows.json",
  process.argv[3] ?? "docs/briefs/data/run33-facts.json",
  process.argv[4] ?? "docs/briefs/data/pages-run33",
];

/** The saved page each model-read source's rows came from. */
const PAGES: Record<string, string> = {
  "steppingoutstudios.com": "steppingoutstudios-com-social-events1.txt",
  "thisweekinswingnyc.com": "thisweekinswingnyc-com.txt",
  "cdny.org": "cdny-org.txt",
  "sobs.com": "sobs-com-calendar.txt",
  "theronda.us": "theronda-us-nyc.txt",
  "brooklyncontra.org": "brooklyncontra-org.txt",
  "nycswings.net": "nycswings-net.txt",
  "frimframjam.com": "frimframjam-com.txt",
  "rscdsnewyork.org": "rscdsnewyork-org.txt",
  "nylindy.com": "nylindy-com.txt",
  "swingremixnyc.com": "swingremixnyc-com.txt",
};

interface Row {
  slug: string;
  night: string;
  title: string;
  srcHosts: string[];
  ld: {
    offers?: Array<{ name?: string; price?: number; priceCurrency?: string }>;
    eventStatus?: string;
  } | null;
}
interface Facts {
  slug: string;
  cost: string[];
  facts: Record<string, string>;
  /** The "Who" lines: the organiser's name, then its link's host; ["Not listed"] when none. */
  who?: string[] | null;
}

const rows = JSON.parse(readFileSync(rowsPath, "utf8")) as Row[];
const baseline = JSON.parse(readFileSync("docs/briefs/data/run33-rows.json", "utf8")) as Row[];
const facts = new Map(
  (JSON.parse(readFileSync(factsPath, "utf8")) as Facts[]).map((f) => [f.slug, f]),
);

/** The inclusions the cost lines print after a tier ("DoorIncludes ($10 w/ student ID)"), in order. */
function inclusions(cost: readonly string[]): Array<string | null> {
  const out: Array<string | null> = [];
  for (const line of cost) {
    if (/^(?:\$|Free\b)/.test(line)) out.push(null);
    else {
      const inc = /Includes (.*)$/.exec(line)?.[1] ?? null;
      if (out.length > 0 && inc !== null) out[out.length - 1] = inc;
    }
  }
  return out;
}

/** The prices the cost lines print ("$25", "Door", "Free", "Cover…"), for a row with no offers. */
function costPrices(cost: readonly string[]) {
  const out: Array<{
    label: string;
    amount: number | null;
    currency: string;
    includes: string | null;
  }> = [];
  for (const line of cost) {
    const amount = /^\$(\d+(?:\.\d+)?)$/.exec(line);
    if (amount)
      out.push({ label: "price", amount: Number(amount[1]), currency: "USD", includes: null });
    else if (line === "Free")
      out.push({ label: "price", amount: 0, currency: "USD", includes: null });
    else if (out.length > 0 && !/^(?:Tickets at |Cover not listed)/.test(line)) {
      const last = out[out.length - 1]!;
      const [label, inc] = line.split("Includes ");
      if (label) last.label = label.trim();
      if (inc) last.includes = inc.trim();
    }
  }
  return out;
}

/** "sprung, indoor" as the Floor line prints it: the floor, and indoor or outdoor. */
function floorFacts(text: string | undefined): { floor: string | null; place: string | null } {
  if (!text || text === "Not listed") return { floor: null, place: null };
  const parts = text.split(",").map((p) => p.trim());
  const placeWord = /^(?:indoor|outdoor)$/i;
  const place = parts.find((p) => placeWord.test(p))?.toLowerCase() ?? null;
  const floor = parts.filter((p) => !placeWord.test(p)).join(", ") || null;
  return { floor, place };
}
const listed = (text: string | undefined) => (text && text !== "Not listed" ? text : null);

/** The Music line as the event page prints it: "DJ", "Live band", "DJ and live band", then "; mix". */
function musicFacts(text: string | undefined) {
  const line = listed(text);
  if (line === null) return { djs: [], bands: [], genre_mix: null };
  const [head, ...rest] = line.split("; ");
  const who = { DJ: [true, false], "Live band": [false, true], "DJ and live band": [true, true] }[
    head ?? ""
  ];
  const mix = who ? rest.join("; ") || null : line;
  return {
    djs: who?.[0] ? ["DJ"] : [],
    bands: who?.[1] ? ["live band"] : [],
    genre_mix: mix,
  };
}

function age(text: string | undefined): number | null {
  if (!text || text === "Not listed") return null;
  if (/all ages/i.test(text)) return 0;
  const n = /(\d+)\+/.exec(text);
  return n ? Number(n[1]) : null;
}

const show = (
  prices: ReadonlyArray<{ amount: number | null; label: string; includes: string | null }>,
) =>
  prices.length === 0
    ? "not listed"
    : prices
        .map(
          (p) =>
            `${p.amount === null ? "" : `$${p.amount} `}${p.label}${p.includes ? ` (includes ${p.includes})` : ""}`,
        )
        .join(" / ");

let checked = 0;
let unverified = 0;
const changed: string[] = [];
const byField = { pricesDropped: 0, relabelled: 0, ranged: 0, isFree: 0, age: 0, cancelled: 0 };
const placeDropped: Record<string, number> = {};
const placeKept: string[] = [];
const cancelledKept: string[] = [];
for (const row of rows) {
  const host = row.srcHosts.length === 1 ? row.srcHosts[0]! : null;
  const file = host ? PAGES[host] : undefined;
  if (!host || !file) continue;
  const path = join(pagesDir, file);
  if (!existsSync(path)) {
    unverified += 1;
    continue;
  }
  const page = readFileSync(path, "utf8");
  const f = facts.get(row.slug);
  const offers = row.ld?.offers ?? [];
  const inc = inclusions(f?.cost ?? []);
  const listing = rawListingSchema.parse({
    title: row.title,
    listing_type: "social",
    styles: [],
    prices:
      offers.length === 0
        ? costPrices(f?.cost ?? [])
        : offers.map((o, i) => ({
            // An offer with no tier of its own is named by its amount ("$15"): the read gave "price".
            label: o.name && !/^\$?\d/.test(o.name) ? o.name : "price",
            amount: o.price ?? null,
            currency: o.priceCurrency ?? "USD",
            includes: inc[i] ?? null,
          })),
    is_free: f?.cost.some((c) => /^Free\b/.test(c)) ? true : null,
    age_min: age(f?.facts.Age),
    cancelled: /Cancel|Postpon/.test(row.ld?.eventStatus ?? "") ? true : null,
    floor: floorFacts(f?.facts.Floor).floor,
    indoor_outdoor: floorFacts(f?.facts.Floor).place,
    dress_code: listed(f?.facts["Dress code"]),
    crowd_size_hint: listed(f?.facts.Crowd),
    level: listed(f?.facts.Level),
    music: musicFacts(f?.facts.Music),
    partner_required:
      f?.facts.Partner === "Bring a partner"
        ? true
        : /^Not needed/.test(f?.facts.Partner ?? "")
          ? false
          : null,
  });
  if (
    listing.prices.length === 0 &&
    listing.is_free === null &&
    listing.age_min === null &&
    listing.cancelled === null &&
    listing.floor === null &&
    listing.indoor_outdoor === null &&
    listing.dress_code === null &&
    listing.crowd_size_hint === null &&
    listing.level === null &&
    listing.music.djs.length + listing.music.bands.length === 0 &&
    listing.music.genre_mix === null &&
    listing.partner_required === null
  )
    continue;
  checked += 1;
  // A read lists the page's items beyond the window too (a monthly night's rule), which bound a
  // part; the rows on the site hold only the window's, so the run-33 titles of the source are added.
  const titles = [
    ...new Set([...rows, ...baseline].filter((r) => r.srcHosts.includes(host)).map((r) => r.title)),
  ];
  const blocks = titleBlocks(page, row.title, titles, "en", undefined, { facts: true });
  const result = checkListingFacts(
    listing,
    ownBlockTexts(blocks, row.night, "en", { lead: false }),
    {
      others: titles,
      currency: "USD",
    },
  );
  for (const field of [
    "indoor_outdoor",
    "floor",
    "dress_code",
    "crowd_size_hint",
    "level",
    "partner_required",
  ] as const) {
    const kept = result.listing[field];
    if (kept !== null)
      placeKept.push(`${row.title} ${field} "${kept}": "${result.listing.evidence[field]}"`);
  }
  if (result.listing.cancelled === true) {
    cancelledKept.push(`${row.title} (${row.night}): "${result.listing.evidence.cancelled}"`);
  }
  if (result.changes.length === 0) continue;
  for (const c of result.changes) {
    if (c.field === "prices") {
      if (c.kind === "dropped") byField.pricesDropped += 1;
      if (c.kind === "relabelled") byField.relabelled += 1;
      if (c.kind === "ranged") byField.ranged += 1;
    }
    if (c.field === "is_free") byField.isFree += 1;
    if (c.field === "age_min") byField.age += 1;
    if (c.field === "cancelled") byField.cancelled += 1;
    if (
      [
        "indoor_outdoor",
        "floor",
        "dress_code",
        "crowd_size_hint",
        "level",
        "partner_required",
        "music",
      ].includes(c.field)
    ) {
      placeDropped[c.field] = (placeDropped[c.field] ?? 0) + 1;
    }
  }
  const after = result.listing;
  const ageText = (n: number | null) =>
    n === null ? "not listed" : n === 0 ? "all ages" : `${n}+`;
  changed.push(
    [
      `${row.title} (${row.night}, ${host}) /e/${row.slug}`,
      `  cost: ${show(listing.prices)}${listing.is_free ? " [free]" : ""}  ->  ${show(after.prices)}${after.is_free ? " [free]" : ""}`,
      ...(listing.age_min !== after.age_min
        ? [`  age: ${ageText(listing.age_min)}  ->  ${ageText(after.age_min)}`]
        : []),
      `  ${result.changes.map((c) => `${c.kind} ${c.field}: ${c.detail}`).join("; ")}`,
    ].join("\n"),
  );
}

// The organiser (D-105): withdrawn where the page writes it only in other listings' parts.
const organizersWithdrawn: string[] = [];
let organizersChecked = 0;
for (const row of rows) {
  const host = row.srcHosts.length === 1 ? row.srcHosts[0]! : null;
  const file = host ? PAGES[host] : undefined;
  const who = facts.get(row.slug)?.who;
  if (!host || !file || !who || who[0] === "Not listed") continue;
  const path = join(pagesDir, file);
  if (!existsSync(path)) continue;
  organizersChecked += 1;
  const page = readFileSync(path, "utf8");
  const titles = [
    ...new Set([...rows, ...baseline].filter((r) => r.srcHosts.includes(host)).map((r) => r.title)),
  ];
  const partsOf = (t: string) =>
    titleBlocks(page, t, titles, "en", undefined, { facts: true }).map((b) => ({
      start: b.start,
      end: b.end,
      own: t === row.title,
    }));
  const own = titleBlocks(page, row.title, titles, "en", undefined, { facts: true });
  const organizer = { name: who[0]!, url: who[1] ? `https://${who[1]}` : null };
  const out = organizerFromNeighbour(organizer, {
    pageUrl: `https://${host}/`,
    pageText: page,
    own: ownBlockTexts(own, row.night, "en", { lead: false }),
    parts: () => titles.flatMap(partsOf),
  });
  if (out) organizersWithdrawn.push(`${row.title} (${row.night}): ${organizer.name}`);
}

console.log(changed.join("\n\n"));
console.log(
  `\n${changed.length} of ${checked} model-read rows with a price, free entry or age change` +
    ` (${unverified} rows' pages not saved: unverified).` +
    `\nprice rows dropped ${byField.pricesDropped}, relabelled ${byField.relabelled}, ranged ${byField.ranged};` +
    ` free dropped ${byField.isFree}; ages dropped ${byField.age}; cancellations dropped ${byField.cancelled}` +
    `\ncancellations kept: ${cancelledKept.join("; ") || "none"}` +
    `\nplace, crowd, level, partner and music dropped: ${JSON.stringify(placeDropped)}` +
    `\nplace, crowd, level, partner and music kept: ${placeKept.join("; ") || "none"}` +
    `\norganisers withdrawn: ${organizersWithdrawn.length} of ${organizersChecked}: ${organizersWithdrawn.join("; ") || "none"}`,
);
