import { defineConfig, devices } from "@playwright/test";

import { MOCK_NOW_VAR, e2ePinnedInstant } from "./src/config/clock";

// D-823: one fixed afternoon in New York for the whole run, whatever hour CI starts. Set once in
// the main process (workers inherit it) and passed to the web server below. A dev server already
// running locally without it reads the real clock.
process.env[MOCK_NOW_VAR] ??= e2ePinnedInstant(new Date());

// End-to-end tests run against mock mode (no API keys) on a phone viewport.
//
// This suite is the Phase 1 proof (SPEC section 11): "done when I can open it on my phone, filter
// by style, open a detail page, use the map, and change location". Mock mode serves the New York
// seed from memory (D-011), so nothing here needs a database or the network.
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  // On CI: annotations inline on the diff, and an HTML report kept as an artifact so a failure
  // that only happens there can be read afterwards rather than guessed at.
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // A cold `next dev` compiles each route on its first request, which is slower than the default.
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    // Both are pinned because the page reads the clock. The seed is New York and every time on the
    // page goes through src/domain/time.ts formatTime for the visitor's locale, so without these a
    // runner in UTC and a runner in New York would read two different rails.
    locale: "en-US",
    timezoneId: "America/New_York",
    // A runner with no route to the Playwright browser CDN can point at a browser it already has;
    // CI downloads the pinned build and leaves this unset.
    launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH || undefined },
  },
  projects: [{ name: "phone", use: { ...devices["Pixel 7"] } }],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    // The first request compiles the route; the default 60s is not enough on a cold .next.
    timeout: 180_000,
    env: { DANCETONIGHT_MODE: "mock", [MOCK_NOW_VAR]: process.env[MOCK_NOW_VAR] ?? "" },
  },
});
