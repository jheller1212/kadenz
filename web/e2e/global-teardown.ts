// ── Playwright global teardown ───────────────────────────────────────────────
// Stops the dev server and the local Postgres started in global-setup.ts.
// `persistent: true` means stop() does NOT delete the data directory — the
// next `npm run test:e2e` reuses it and the idempotent seed just no-ops.
import { state } from "./server-state";

export default async function globalTeardown() {
  const devServer = state.devServer;
  if (devServer?.pid && !devServer.killed) {
    // Negative pid = the whole process group (global-setup spawns detached for
    // exactly this reason). `next dev` forks a `next-server` child that
    // survives a SIGTERM aimed at the parent and keeps holding
    // .next/dev/lock, which makes the *next* run in this directory refuse to
    // start. Fall back to the single process if the group is already gone.
    try {
      process.kill(-devServer.pid, "SIGTERM");
    } catch {
      devServer.kill("SIGTERM");
    }
  }
  if (state.pg) {
    await state.pg.stop().catch((err) => {
      console.error("[e2e] error stopping local Postgres:", err);
    });
  }
}
