// ── Playwright global setup ──────────────────────────────────────────────────
// Boots a disposable, local-only Postgres (no Docker required — the
// `embedded-postgres` package downloads real Postgres binaries once and runs
// them as a plain child process), pushes the current Drizzle schema onto it,
// seeds it with one owner's worth of realistic data, makes a production build
// of the app and serves it against that database, and mints a valid session
// cookie for the tests to reuse — all local, all disposable. Production code,
// never production data: see the guard below and step 4.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import EmbeddedPostgres from "embedded-postgres";
import {
  E2E_APP_PORT,
  E2E_ARTIFACTS_DIR,
  E2E_AUTH_STATE_PATH,
  E2E_BASE_URL,
  E2E_COOKIES_PATH,
  E2E_DATABASE_URL,
  E2E_DB_NAME,
  E2E_PG_DATA_DIR,
  E2E_PG_PORT,
  E2E_SESSION_SECRET,
  USER_B_ID,
} from "./env";

// Mirrors src/db/schema.ts's OWNER_USER_ID. Not imported from there: every
// other src/ import in this file is spawned as its own `tsx` process (see the
// comment on run()/runCapture() below) specifically to avoid pulling that
// ESM module tree into Playwright's CJS-compiled global-setup process, and a
// static import of schema.ts here would reintroduce exactly that risk for
// the sake of one constant.
const OWNER_USER_ID = "00000000-0000-0000-0000-000000000001";
import { state } from "./server-state";

// ── Guard: this whole harness must be structurally incapable of touching
// production. Two independent checks, both required, fail closed. ─────────────
function assertSafeToRunLocally() {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[e2e] NODE_ENV=production in the environment — refusing to boot the e2e " +
        "harness. This suite builds and serves production *code* on purpose " +
        "(see step 4), but only ever against its own throwaway local Postgres. " +
        "An inherited production environment is the case this refuses, because " +
        "that is the one where the credentials in scope might not be local."
    );
  }
  // Belt and braces: the DB URL this harness will use (see env.ts) is
  // hardcoded to 127.0.0.1 and never derived from an inherited env var, so
  // there is no code path from a real DATABASE_URL into this harness. This
  // check exists purely so a future edit that starts reading DATABASE_URL
  // from the environment can't silently point the harness at a real database.
  if (process.env.DATABASE_URL && process.env.DATABASE_URL !== E2E_DATABASE_URL) {
    throw new Error(
      "[e2e] DATABASE_URL is already set in the environment to something other " +
        "than the e2e harness's own local database. Unset it before running " +
        "`npm run test:e2e` — this suite must only ever talk to its own local Postgres."
    );
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit", env, cwd: dirname(dirname(__filename)) });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[e2e] ${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

// Captures stdout instead of inheriting it — used for mint-cookie.ts, which
// prints exactly one line the caller needs to parse.
function runCapture(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  opts: { inheritStderr?: boolean } = {}
): Promise<string> {
  // stderr is inherited by default because mint-cookie.ts's caller wants its
  // errors on the console and parses only stdout. Capturing it instead is for
  // callers that need to INSPECT what the command said, not just what it
  // returned: drizzle-kit reports an unanswerable prompt on stderr and then
  // exits zero, so the text is the only evidence there is.
  const inheritStderr = opts.inheritStderr !== false;
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", inheritStderr ? "inherit" : "pipe"],
      env,
      cwd: dirname(dirname(__filename)),
    });
    let out = "";
    child.stdout?.on("data", (chunk) => {
      out += chunk.toString();
    });
    if (!inheritStderr && child.stderr) {
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        out += text;
        // Still echoed, so capturing does not make the run quieter than before.
        process.stderr.write(text);
      });
    }
    child.on("exit", (code) => {
      if (code === 0) resolve(out.trim());
      else reject(new Error(`[e2e] ${cmd} ${args.join(" ")} exited with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[e2e] app server never became ready at ${url}`);
}

export default async function globalSetup() {
  assertSafeToRunLocally();

  // ── 1. Local Postgres, no Docker ─────────────────────────────────────────
  const pg = new EmbeddedPostgres({
    databaseDir: E2E_PG_DATA_DIR,
    user: "postgres",
    password: "postgres",
    port: E2E_PG_PORT,
    persistent: true, // reuse across runs; the idempotent seed makes re-runs safe
  });
  state.pg = pg;

  const alreadyInitialised = existsSync(E2E_PG_DATA_DIR);
  if (!alreadyInitialised) {
    console.log("[e2e] initialising local Postgres data directory…");
    await pg.initialise();
  }
  await pg.start();

  // ── A FRESH database every run, on a persisted data directory ─────────────
  //
  // The Postgres data dir is kept between runs because initdb is the slow part.
  // The database inside it is not, and that distinction matters more than it
  // looks.
  //
  // `drizzle-kit push` compares schema.ts against whatever is already there. On
  // a populated database that comparison can need an answer ("about to add a
  // unique constraint to a table that contains 8 rows, truncate it?"), and with
  // no TTY drizzle-kit prints an error and exits ZERO. The schema silently does
  // not get applied, and every later step runs against the previous run's
  // database. The symptom is a seed failing on a column that plainly exists in
  // schema.ts, which sends you looking in entirely the wrong place.
  //
  // Dropping first means push always runs against an empty database, where
  // there is nothing to ask about. It also removes any state a previous run
  // left behind, so a spec cannot pass or fail because of what ran before it.
  // The seed is idempotent and takes seconds; correctness is worth those.
  try {
    await pg.dropDatabase(E2E_DB_NAME);
  } catch (err) {
    // First run on a new data dir: nothing to drop.
    const msg = err instanceof Error ? err.message : String(err);
    if (!/does not exist/i.test(msg)) throw err;
  }
  await pg.createDatabase(E2E_DB_NAME);

  const dbEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };

  // ── 2. Push the current Drizzle schema (dashboard-driven schema changes
  // are the source of truth per project convention — same reasoning applies
  // here: push straight from src/db/schema.ts rather than replaying the
  // hand-authored migration chain, which assumes a pre-existing baseline). ──
  // `--force` auto-accepts drizzle-kit's data-loss warnings, but NOT its
  // "is this column added or renamed?" question. Against the persisted data dir
  // that question can appear, and with no TTY drizzle-kit prints
  // "Interactive prompts require a TTY terminal" and exits ZERO. The schema is
  // then silently not updated, and the suite runs against an old database:
  // symptoms are a seed that fails on a column that plainly exists in
  // schema.ts, or specs failing for reasons that make no sense against the code
  // in front of you. That cost real debugging time once already.
  //
  // So the output is captured and checked. A prompt that could not be answered
  // is now a loud failure with the one-line fix, rather than a zero exit code.
  console.log("[e2e] pushing schema to local Postgres…");
  const pushOutput = await runCapture(
    "./node_modules/.bin/drizzle-kit",
    ["push", "--force"],
    dbEnv,
    { inheritStderr: false }
  );
  if (/Interactive prompts require a TTY/i.test(pushOutput)) {
    throw new Error(
      "[e2e] drizzle-kit push needed an interactive answer and could not ask, so the schema was NOT applied " +
        "and every later step would run against a stale database. This happens when the persisted data dir " +
        "has drifted from src/db/schema.ts (a renamed or re-typed column).\n\n" +
        "Fix: rm -rf web/e2e/.pgdata web/e2e/.auth web/e2e/.artifacts, then re-run. The seed is idempotent, " +
        "so a fresh database costs seconds.\n\n" +
        `drizzle-kit said:\n${pushOutput}`
    );
  }

  // ── 3. Seed realistic data ───────────────────────────────────────────────
  // Spawned as its own `tsx` process rather than imported in-process:
  // dynamically importing this ESM module tree from Playwright's
  // CJS-compiled global-setup hits a "Cannot require() ES Module ... in a
  // cycle" error (Node's require(esm) interop limitation).
  console.log("[e2e] seeding local database…");
  await run("./node_modules/.bin/tsx", ["e2e/seed.ts"], dbEnv);

  // ── 3b. Apply the Phase 3 enforcement SQL ────────────────────────────────
  // `drizzle-kit push` above builds tables from schema.ts and replays no
  // migrations, so the row level security policies would not exist and the
  // isolation specs would pass against a database with no isolation. See
  // e2e/apply-rls.ts.
  //
  // After the seed, not before: the seed writes both users' data with no
  // request context set, which the policies would (correctly) refuse. Setup
  // populates the database; the policies then govern how the app reads it.
  console.log("[e2e] applying row level security…");
  await run("./node_modules/.bin/tsx", ["e2e/apply-rls.ts"], dbEnv);

  // ── 4. Build the app, then serve that build against the seeded database ──
  //
  // A production build, not `next dev`, and the reason is the entire failure
  // history of this suite. `next dev` compiles on demand and pushes a Fast
  // Refresh update over the HMR socket on every compile; a page that takes one
  // mid-hydration can stop hydrating, and the spec that fails is whichever one
  // happened to be open. Warming every route up front and pinning them in
  // memory removed most of it, but not all: entries like `/_error` only compile
  // when a request actually fails, and no HTTP request can warm them (`/_error`
  // itself 404s), so one 500 anywhere in a run still fires a hot update into
  // whatever spec is running.
  //
  // `next build` has no HMR socket, no on-demand compilation and no Fast
  // Refresh, so the whole class is gone rather than mitigated — and the suite
  // now exercises the same output that actually serves users. It also costs
  // less than it looks: the build replaces a warm-up pass that was taking 128s
  // in CI.
  //
  // NODE_ENV=production is set *on this child only*. The guard in
  // assertSafeToRunLocally deliberately reads the inherited environment, so it
  // still refuses to run under a production environment; what this does is
  // build and serve production *code* against the throwaway local Postgres.
  // The database URL is unchanged and still hardcoded to 127.0.0.1.
  const prodEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: E2E_DATABASE_URL,
    SESSION_SECRET: E2E_SESSION_SECRET,
    NODE_ENV: "production",
  };

  // `next build` directly, not `npm run build` — that script also runs
  // scripts/migrate.mjs, and the schema here comes from drizzle-kit push above.
  console.log("[e2e] building the app (production build)…");
  await run("./node_modules/.bin/next", ["build", "--webpack"], prodEnv);

  console.log("[e2e] starting the app…");
  const appServer = spawn(
    "./node_modules/.bin/next",
    ["start", "-p", String(E2E_APP_PORT), "-H", "127.0.0.1"],
    {
      cwd: dirname(dirname(__filename)),
      stdio: "inherit",
      // Own process group, so teardown can kill the whole tree: next forks a
      // separate server child, and SIGTERM to the parent alone leaves that
      // child alive still holding the port, after which the next run in this
      // directory fails to bind and the harness looks broken for an unrelated
      // reason.
      detached: true,
      env: prodEnv,
    }
  );
  state.appServer = appServer;
  await waitForServer(E2E_BASE_URL, 60_000);

  // ── 5. Mint valid session cookies the same way the OAuth callback would
  // (src/lib/session.ts's own makeSessionCookie — zero app code changes), one
  // per seeded user, and hand the owner's to every test via Playwright's
  // storageState (unchanged behaviour for every existing spec). Both raw
  // cookies are also written to E2E_COOKIES_PATH — the cross-user-isolation
  // spec is the only consumer of the second one, and it drives its own
  // per-user API request contexts rather than a browser storageState (see
  // that spec for why: it needs to hold both users' cookies at once, which
  // storageState — one per Playwright project — can't express).
  const mintOutput = await runCapture(
    "./node_modules/.bin/tsx",
    ["e2e/mint-cookie.ts", OWNER_USER_ID, USER_B_ID],
    { ...process.env, SESSION_SECRET: E2E_SESSION_SECRET }
  );
  const [ownerCookie, userBCookie] = mintOutput.split("\n");
  const [name, value] = ownerCookie.split("=");

  mkdirSync(E2E_ARTIFACTS_DIR, { recursive: true });
  writeFileSync(
    E2E_COOKIES_PATH,
    JSON.stringify({ owner: ownerCookie.trim(), userB: userBCookie.trim() }, null, 2)
  );

  const storageState = {
    cookies: [
      {
        name,
        value,
        domain: "127.0.0.1",
        path: "/",
        expires: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
        httpOnly: true,
        secure: true,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  };
  mkdirSync(dirname(E2E_AUTH_STATE_PATH), { recursive: true });
  writeFileSync(E2E_AUTH_STATE_PATH, JSON.stringify(storageState, null, 2));

  console.log("[e2e] global setup complete.");
}
