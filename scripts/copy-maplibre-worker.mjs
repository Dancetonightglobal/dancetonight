// MapLibre GL JS 6 starts its tile worker from `maplibre-gl-worker.mjs`, which it looks for beside
// its own module file. Next bundles that module into its own chunks, so the worker file is not
// there: the map loads its style, never fetches a tile, never fires "load", and draws no pins.
// This copies the worker and the shared module it imports into public/maplibre/, where
// src/ui/map/worker.ts points MapLibre at them. It runs before every build and dev server, so the
// copies always match the installed version; they are build output and not committed.

import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const dist = join(dirname(require.resolve("maplibre-gl/package.json")), "dist");
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "maplibre");

mkdirSync(target, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) {
  copyFileSync(join(dist, file), join(target, file));
}
console.log(`MapLibre worker copied to ${target}`);
