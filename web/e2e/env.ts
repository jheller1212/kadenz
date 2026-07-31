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

// ── Phase 3 cross-user fixtures ──────────────────────────────────────────────
// Two files, written once by global-setup (via seed.ts / mint-cookie.ts) and
// read by cross-user-isolation.spec.ts. Kept as on-disk artifacts rather than
// re-derived in the spec: the spec has no DB access of its own (it only ever
// talks to the app over HTTP, same as every other spec — see e2e/README.md
// "Auth: there is no bypass"), and re-deriving ids by guessing would be
// exactly the kind of fragile coupling this suite exists to avoid.
export const E2E_ARTIFACTS_DIR = path.join(here, ".artifacts");
// The two seeded users' row ids, keyed by table — see e2e/seed.ts writeSeedIdsArtifact().
export const E2E_SEED_IDS_PATH = path.join(E2E_ARTIFACTS_DIR, "seed-ids.json");
// Raw `name=value` session cookies for both seeded users — see e2e/mint-cookie.ts.
export const E2E_COOKIES_PATH = path.join(E2E_ARTIFACTS_DIR, "cookies.json");

// The second seeded user's fixed id, for the cross-user-isolation spec. Kept
// here rather than in e2e/seed.ts (which is spawned as its own ESM `tsx`
// process — see that file's header comment) so global-setup.ts, which runs
// in Playwright's CJS-compiled process, can reference it with no import-cycle
// risk. src/db/schema.ts's OWNER_USER_ID (the first/primary seeded user,
// unchanged by this work) is the production owner's real id; this one only
// ever exists in the throwaway local e2e database.
export const USER_B_ID = "00000000-0000-0000-0000-000000000002";
