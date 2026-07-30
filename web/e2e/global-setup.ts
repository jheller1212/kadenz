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
  E2E_AUTH_STATE_PATH,
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_DB_NAME,
  E2E_PG_DATA_DIR,
  E2E_PG_PORT,
  E2E_SESSION_SECRET,
} from "./env";
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
function runCapture(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ["ignore", "pipe", "inherit"],
      env,
      cwd: dirname(dirname(__filename)),
    });
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk.toString();
    });
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

  try {
    await pg.createDatabase(E2E_DB_NAME);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/already exists/i.test(msg)) throw err;
  }

  const dbEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: E2E_DATABASE_URL };

  // ── 2. Push the current Drizzle schema (dashboard-driven schema changes
  // are the source of truth per project convention — same reasoning applies
  // here: push straight from src/db/schema.ts rather than replaying the
  // hand-authored migration chain, which assumes a pre-existing baseline). ──
  console.log("[e2e] pushing schema to local Postgres…");
  await run(
    "./node_modules/.bin/drizzle-kit",
    ["push", "--force"],
    dbEnv
  );

  // ── 3. Seed realistic data ───────────────────────────────────────────────
  // Spawned as its own `tsx` process rather than imported in-process:
  // dynamically importing this ESM module tree from Playwright's
  // CJS-compiled global-setup hits a "Cannot require() ES Module ... in a
  // cycle" error (Node's require(esm) interop limitation).
  console.log("[e2e] seeding local database…");
  await run("./node_modules/.bin/tsx", ["e2e/seed.ts"], dbEnv);

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

  // ── 5. Mint a valid session cookie the same way the OAuth callback would
  // (src/lib/session.ts's own makeSessionCookie — zero app code changes),
  // and hand it to every test via Playwright's storageState. ──────────────
  const nameValue = await runCapture(
    "./node_modules/.bin/tsx",
    ["e2e/mint-cookie.ts"],
    { ...process.env, SESSION_SECRET: E2E_SESSION_SECRET }
  );
  const [name, value] = nameValue.split("=");

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
