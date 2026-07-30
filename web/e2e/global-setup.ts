// ── Playwright global setup ──────────────────────────────────────────────────
// Boots a disposable, local-only Postgres (no Docker required — the
// `embedded-postgres` package downloads real Postgres binaries once and runs
// them as a plain child process), pushes the current Drizzle schema onto it,
// seeds it with one owner's worth of realistic data, starts the app's own
// dev server against that database, and mints a valid session cookie for the
// tests to reuse — all local, all disposable, never production.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
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
      "[e2e] NODE_ENV=production — refusing to boot the e2e harness. " +
        "This suite starts its own throwaway local Postgres and dev server; " +
        "it must never run against a production build or environment."
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

// A syntactically valid id that matches nothing in the seed. Dynamic routes
// warmed with it compile and then 404, which is all the warm-up needs.
const WARM_PLACEHOLDER_ID = "00000000-0000-0000-0000-000000000000";

function segmentToPath(name: string): string {
  // [id] / [exerciseId] → a placeholder; [...slug] / [[...slug]] → one segment.
  if (name.startsWith("[")) return WARM_PLACEHOLDER_ID;
  return name;
}

/**
 * Every route module under `src/app`, as a URL that will compile it:
 * `src/app/settings/apps/page.tsx` → `/settings/apps`,
 * `src/app/api/activities/[id]/route.ts` → `/api/activities/<placeholder>`.
 * Route groups `(name)` collapse away, since they contribute no URL path.
 */
function allRouteUrls(): { pages: string[]; api: string[] } {
  const appDir = join(dirname(dirname(__filename)), "src", "app");
  const pages: string[] = [];
  const api: string[] = [];

  const walk = (dir: string, segments: string[]) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const isGroup = entry.name.startsWith("(") && entry.name.endsWith(")");
        walk(join(dir, entry.name), isGroup ? segments : [...segments, segmentToPath(entry.name)]);
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        pages.push("/" + segments.join("/"));
      } else if (/^route\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        api.push("/" + segments.join("/"));
      }
    }
  };

  walk(appDir, []);
  return { pages: pages.sort(), api: api.sort() };
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
  throw new Error(`[e2e] dev server never became ready at ${url}`);
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

  // ── 4. Start the app's own dev server against the seeded database ───────
  console.log("[e2e] starting the app dev server…");
  const devServer = spawn(
    "./node_modules/.bin/next",
    ["dev", "--webpack", "-p", String(E2E_APP_PORT), "-H", "127.0.0.1"],
    {
      cwd: dirname(dirname(__filename)),
      stdio: "inherit",
      // Own process group, so teardown can kill the whole tree. `next dev`
      // forks a separate `next-server` child, and SIGTERM to the parent alone
      // leaves that child alive holding .next/dev/lock — after which the next
      // run in this directory refuses to start ("Another next dev server is
      // already running") and the harness looks broken for an unrelated reason.
      detached: true,
      env: {
        ...process.env,
        DATABASE_URL: E2E_DATABASE_URL,
        SESSION_SECRET: E2E_SESSION_SECRET,
        NODE_ENV: "development",
        // Pins every compiled route in memory for the run — see the
        // onDemandEntries block in next.config.ts for why that matters here.
        KADENZ_E2E: "1",
      },
    }
  );
  state.devServer = devServer;
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

  // ── 6. Compile every route in the app before any spec runs ───────────────
  // Next dev compiles each page and route module on its first request, and an
  // on-demand compile does not just cost time: it pushes a Fast Refresh update
  // over the HMR socket to whatever page is open at that moment. A page that
  // takes a hot update mid-hydration can end up never finishing it, which
  // looks exactly like a broken screen — the app sits on the boot splash and
  // the test times out waiting for an element that will never appear.
  //
  // A first-time compile is therefore a hazard for whichever test happens to
  // be running, not just for the test that triggered it. That is why this
  // compiles everything up front, and why the list is discovered from src/app
  // instead of hand-maintained: a hand-written list only ever covers the specs
  // that existed when it was written, and the routes it misses are exactly the
  // ones that fire a hot update mid-test.
  //
  // Route handlers count too, not just pages: an API route compiling for the
  // first time fires the same hot update, and the page that takes it drops its
  // in-flight fetches, so a card that was loading simply never appears.
  //
  // Pages are warmed with GET. Route handlers are warmed with OPTIONS: Next
  // has to load the module to answer what methods it allows, so the module
  // compiles, but no handler body runs — warming must not kick off a sync just
  // because a route exists. Dynamic segments are filled with an id that
  // matches nothing, so those compile and then 404.
  //
  // Requests go out a few at a time: the compile itself is serial inside Next,
  // but overlapping requests let it batch entries, which takes this pass from
  // ~2 minutes to well under one.
  console.log("[e2e] compiling every route before the first spec…");
  const cookieHeader = `${name}=${value}`;
  const { pages, api } = allRouteUrls();
  const warmStarted = Date.now();

  const warmOne = async (route: string, method: "GET" | "OPTIONS") => {
    try {
      const res = await fetch(`${E2E_BASE_URL}${route}`, {
        method,
        headers: { cookie: cookieHeader },
      });
      // Read the body to completion even though nothing wants it. An unread
      // response body makes undici reset the socket, which next dev surfaces
      // as `uncaughtException: Error: aborted (ECONNRESET)` — measured at
      // dozens of them per warm-up pass, all from this loop. They are noise,
      // but noise in the one log you read to diagnose a failing spec, and it
      // pushes the dev server through its error path ~100 times on boot.
      await res.arrayBuffer();
    } catch (err) {
      console.warn(`[e2e] warm-up request to ${route} failed (continuing):`, err);
    }
  };

  const warmAll = async (routes: string[], method: "GET" | "OPTIONS", concurrency: number) => {
    const queue = [...routes];
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          await warmOne(next, method);
        }
      })
    );
  };

  await warmAll(pages, "GET", 4);
  await warmAll(api, "OPTIONS", 8);

  // The not-found path is its own entry and cannot be discovered by walking
  // src/app, so the loops above never cover it. Measured: the first unmatched
  // URL of a run costs ~900ms of framework time and every later one ~18ms, so
  // it is a first-time compile like any other — it just prints no "Compiling"
  // line, which is why it went unnoticed. Any spec that requests a URL the app
  // does not serve would otherwise pay that compile, and a compile mid-run is
  // the whole failure class this pass exists to remove.
  await warmOne(`/${WARM_PLACEHOLDER_ID}-not-a-route`, "GET");

  console.log(
    `[e2e] compiled ${pages.length} pages and ${api.length} route handlers in ${Math.round(
      (Date.now() - warmStarted) / 1000
    )}s`
  );

  console.log("[e2e] global setup complete.");
}
