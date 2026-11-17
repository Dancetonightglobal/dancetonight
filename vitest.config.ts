import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "src/**/*.test.ts", "config/**/*.test.ts"],
    exclude: ["tests/e2e/**", "node_modules/**", ".next/**"],
    passWithNoTests: true, // until the first domain tests land in this phase
    // DB-backed ingest tests take ~2 s alone and more when CI runs files in parallel; the 5 s
    // default timed them out (mixed-calendar, pipeline-listings). A real hang still fails at 30 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
