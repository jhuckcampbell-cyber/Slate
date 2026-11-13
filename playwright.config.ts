import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

// Same env resolution as Next (.env.local etc.) so specs can use the local Supabase keys.
loadEnvConfig(process.cwd());

export default defineConfig({
  testDir: "./e2e",
  // Specs share live odds state (syncs triggered by one test move prices in another): run serially.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  // WebKit is the target (iMessage/Safari users). On Windows dev boxes WebKit lacks system DLLs, so
  // E2E_BROWSER=chromium runs the same specs in a mobile Chromium (needs `npx playwright install chromium`).
  projects:
    process.env.E2E_BROWSER === "chromium"
      ? [{ name: "mobile-chromium", use: { ...devices["Pixel 7"] } }]
      : [{ name: "mobile-safari", use: { ...devices["iPhone 15"] } }],
  timeout: 60_000,
  // Production build so timings (e.g. "<15s to join") reflect real users, not dev compiles.
  webServer: {
    command: "npm run build && npm run start",
    url: "http://localhost:3000",
    // Never reuse: a `next start` left running across a rebuild serves stale chunk names (500s).
    // If the port is busy, Playwright fails fast instead. Stop any local `next start` first.
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
