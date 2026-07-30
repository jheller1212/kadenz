// ── Playwright global teardown ───────────────────────────────────────────────
// Stops the app server and the local Postgres started in global-setup.ts.
// `persistent: true` means stop() does NOT delete the data directory — the
// next `npm run test:e2e` reuses it and the idempotent seed just no-ops.
import { state } from "./server-state";

export default async function globalTeardown() {
  const appServer = state.appServer;
  if (appServer?.pid && !appServer.killed) {
    // Negative pid = the whole process group (global-setup spawns detached for
    // exactly this reason). `next start` forks a server child that survives a
    // SIGTERM aimed at the parent and keeps holding the port, after which the
    // next run in this directory cannot bind and the harness looks broken for
    // an unrelated reason. Fall back to the single process if the group is
    // already gone.
    try {
      process.kill(-appServer.pid, "SIGTERM");
    } catch {
      appServer.kill("SIGTERM");
    }
  }
  if (state.pg) {
    await state.pg.stop().catch((err) => {
      console.error("[e2e] error stopping local Postgres:", err);
    });
  }
}
