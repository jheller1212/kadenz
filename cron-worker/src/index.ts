// Trigger only: this Worker has no business logic of its own. It exists
// because GitHub Actions' `schedule` trigger is documented as best-effort
// and in practice drifted by 1-3 hours on this repo (see README), which
// silently starved both the reminder dispatch and the sync-drain safety
// net of the minute-scale cadence they need. Cloudflare cron triggers run
// on time, so both endpoints move here.
//
// Both targets tolerate being called this often, concurrently with the
// old GitHub Actions job, or repeatedly: reminder dispatch claims each
// workout via a DB constraint before sending, and sync-drain is a no-op
// once the outbox is empty. So this can be deployed without touching
// reminders.yml / sync-drain.yml first.

export interface Env {
  CRON_SECRET: string;
  APP_BASE_URL?: string;
}

const ENDPOINTS = ["/api/cron/reminders", "/api/cron/sync-drain"] as const;

async function callEndpoint(baseUrl: string, path: string, secret: string): Promise<void> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secret}` },
  });

  const body = await response.text();
  console.log(`${path} -> ${response.status}: ${body}`);

  if (!response.ok) {
    // Thrown errors surface as a failed run in the Cloudflare dashboard
    // instead of being swallowed, which is the whole point of moving this
    // off a scheduler that can't be trusted to even run.
    throw new Error(`${path} failed with status ${response.status}: ${body}`);
  }
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    const baseUrl = env.APP_BASE_URL ?? "https://kadenz-tau.vercel.app";

    const results = await Promise.allSettled(
      ENDPOINTS.map((path) => callEndpoint(baseUrl, path, env.CRON_SECRET)),
    );

    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0) {
      // Re-throwing (rather than just logging) is what makes Cloudflare mark
      // this run as failed, which is visible in the dashboard and can be
      // wired to email/webhook alerting later.
      throw new Error(failures.map((f) => String(f.reason)).join("; "));
    }
  },

  // No fetch handler on purpose: this Worker is not meant to be reachable
  // over HTTP, only invoked on its cron schedule.
} satisfies ExportedHandler<Env>;
