// Weekly review helper (ops/weekly-review.md, D-890): which live cards a change to the title screens would hide.
// Reads the daily check's scan.json files (no database, no network) and prints every card `screenTitle` hides, one
// tab-separated line per city and title with the reason, sorted and de-duplicated. Run it before and after a screen
// change (`git stash` the change for "before") and diff the two: every new line must be a card that is not a dance.
//   pnpm -s review:screen /tmp/dc-2026-11-22/scan.json [more scan.json ...] > after.txt
import { readFileSync } from "node:fs";
import { screenTitle } from "@/src/domain/listing-screen";

interface Card {
  city: string;
  title: string;
}

const lines = new Set<string>();
for (const path of process.argv.slice(2)) {
  const scan = JSON.parse(readFileSync(path, "utf8")) as { cards?: Card[] };
  for (const card of scan.cards ?? []) {
    const hit = screenTitle(card.title);
    if (hit) lines.add(`${card.city}\t${card.title}\t${hit.reason}`);
  }
}
process.stdout.write([...lines].sort().join("\n") + (lines.size > 0 ? "\n" : ""));
