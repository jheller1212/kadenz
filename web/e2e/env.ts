// ── Shared e2e configuration ─────────────────────────────────────────────────
// One place for the local Postgres port/URL, the app port, and the session
// secret used to mint a test session cookie — imported by playwright.config.ts,
// global-setup.ts, global-teardown.ts and seed.ts so none of them can drift
// out of sync with each other.
import path from "node:path";

// __dirname, not import.meta.url: Playwright loads config/setup files as
// CommonJS even though the rest of this app is ESM-flavoured TypeScript.
const here = __dirname;

export const E2E_PG_PORT = Number(process.env.E2E_PG_PORT ?? 54329);
export const E2E_PG_DATA_DIR = path.join(here, ".pgdata");
export const E2E_DB_NAME = "kadenz_e2e";
export const E2E_DATABASE_URL = `postgres://postgres:postgres@127.0.0.1:${E2E_PG_PORT}/${E2E_DB_NAME}`;

export const E2E_APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_APP_PORT}`;

// Only ever used to mint/verify a session cookie against the throwaway local
// Postgres above — never a real secret, never read from a production env.
export const E2E_SESSION_SECRET =
  "e2e-local-only-session-secret-do-not-use-outside-tests";

export const E2E_AUTH_STATE_PATH = path.join(here, ".auth", "state.json");
