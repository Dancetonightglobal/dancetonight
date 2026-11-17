// Where the map's tile worker is served from (scripts/copy-maplibre-worker.mjs puts it there at
// build time). MapLibre 6 would otherwise look for it beside its own module, which Next has
// bundled away, and the map would never draw a tile.

export const MAPLIBRE_WORKER_URL = "/maplibre/maplibre-gl-worker.mjs";
