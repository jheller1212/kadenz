// ── Playwright global teardown ───────────────────────────────────────────────
// Stops the dev server and the local Postgres started in global-setup.ts.
// `persistent: true` means stop() does NOT delete the data directory — the
// next `npm run test:e2e` reuses it and the idempotent seed just no-ops.
import { state } from "./server-state";

export default async function globalTeardown() {
  if (state.devServer && !state.devServer.killed) {
    state.devServer.kill("SIGTERM");
  }
  if (state.pg) {
    await state.pg.stop().catch((err) => {
      console.error("[e2e] error stopping local Postgres:", err);
    });
  }
}
