import { defineConfig } from "vitest/config";

// Vitest's default test glob would otherwise also pick up e2e/specs/*.spec.ts
// — those are Playwright specs (browser + real DB), not unit tests, and
// Playwright's own test() throws if it's imported outside its own runner.
export default defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
