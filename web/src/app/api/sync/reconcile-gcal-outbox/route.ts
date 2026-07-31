import { type NextRequest } from "next/server";
import { withCronFanOut } from "@/lib/api/with-session";
import { previewGcalOutboxCleanup, applyGcalOutboxCleanup } from "@/lib/sync/gcal-outbox-cleanup";

// ── GET /api/sync/reconcile-gcal-outbox ─────────────────────────────────────
// Google Calendar sync has been broken for a long time (expired grant, and
// unset OAuth env vars before that), so the pending gcal outbox has been
// growing instead of draining. A pending job is dead on arrival once either
// of its two dependencies is gone: the workout/strength_session row itself,
// or the plan it belongs to (archived). Reconnecting the grant would drain
// the whole queue at once and dump every one of those stale jobs onto the
// calendar — this sweeps them first.
//
// Bare call or ?apply=0 (the default) changes nothing and just reports what
// would be cancelled; ?apply=1 is required to actually cancel jobs. Cancelled
// jobs move to sync_status "cancelled" rather than being deleted, so the
// outbox keeps an auditable record of what got swept and why.
//
// Never touches a job for the active plan — the archived-status filter and
// the entity-exists check are the whole guard, both enforced by the same
// pure predicate this route shares with its unit tests.
//
// sync_outbox/workouts/strength_sessions are all tenanted (Phase 3): this
// only ever touches jobs targeting gcal, which every user manages
// independently, so it fans out per user via withCronFanOut — same auth as
// the other reconcile routes (CRON_SECRET bearer or a signed-in session).

export function GET(request: NextRequest): Promise<Response> {
  const apply = request.nextUrl.searchParams.get("apply") === "1";

  return withCronFanOut(async (userId) => {
    try {
      if (!apply) {
        const preview = await previewGcalOutboxCleanup();
        return { apply: false, ...preview };
      }
      const result = await applyGcalOutboxCleanup();
      return { apply: true, ...result };
    } catch (err) {
      console.error(`Failed to reconcile gcal outbox for user ${userId}:`, err);
      return { ok: false, error: "Reconcile failed" };
    }
  }, "sync-reconcile-gcal-outbox")(request);
}
