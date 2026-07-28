import { defineConfig } from "vitest/config";
import path from "node:path";

// Vitest's default test glob would otherwise also pick up e2e/specs/*.spec.ts
// — those are Playwright specs (browser + real DB), not unit tests, and
// Playwright's own test() throws if it's imported outside its own runner.
export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" so unit tests can import
    // modules the same way the app does (needed to vi.mock("@/db") — the
    // module graph has to resolve before a mock can intercept it).
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    exclude: ["**/node_modules/**", "**/e2e/**"],
  },
});
