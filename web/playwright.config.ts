import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_STATE_PATH, E2E_BASE_URL } from "./e2e/env";

// Chromium only, mobile viewport by default — Kadenz is a phone-first PWA and
// nobody but the owner has ever loaded it in a desktop browser. See
// e2e/README.md for how the local database and dev server get started.
export default defineConfig({
  testDir: "./e2e/specs",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // specs share one seeded DB/dev server — avoid cross-test races
  workers: 1, // same reason — Playwright parallelizes across spec FILES by worker unless pinned
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: E2E_BASE_URL,
    storageState: E2E_AUTH_STATE_PATH,
    viewport: { width: 390, height: 844 },
    trace: "retain-on-failure",
  },
  projects: [
    // Deliberately NOT hasTouch/isMobile: Chromium's touch-input emulation
    // makes ordinary .click() retries (while a motion/spring animation is
    // still settling) register as small drags, which the app's own PWA
    // pull-to-refresh gesture picks up as a real page reload mid-test. The
    // one spec that actually needs a touch gesture (sheet-scroll.spec.ts)
    // dispatches raw TouchEvents itself via page.evaluate, which doesn't
    // require this context flag.
    {
      name: "mobile-chrome",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
});
