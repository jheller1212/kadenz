import { type NextRequest } from "next/server";
import { withCronFanOut } from "@/lib/api/with-session";
import {
  previewArchivedPlanSyncArtifacts,
  reconcileArchivedPlanSyncArtifacts,
} from "@/lib/sync/plan-retire";

// ── GET /api/sync/reconcile-archived-plans ───────────────────────────────────
// One-off repair for duplicates left by plans that were replaced before the
// archive path queued any cleanup: finds workouts on already-archived plans
// that still carry a gcalEventId/garminWorkoutId, queues deletes for both
// surfaces, and clears the stored ids. Only ever touches archived plans —
// never the active one — and is safe to run more than once: a row whose ids
// are already cleared no longer matches, so nothing gets queued twice.
//
// Trigger with `?dryRun=1` first to see the row count with no writes, then
// call again without it to actually queue the deletes.
//
// plans/workouts/sync_outbox are tenanted (Phase 3), so this fans out per
// user via withCronFanOut, same auth as the daily cron: either CRON_SECRET
// (Bearer) or a signed-in session. Unlike the Garmin-specific reconcile
// routes this needs no owner-only guard — a plan and its archived workouts
// belong to whichever user is being iterated, and a non-owner user's own
// garminWorkoutId column is never populated in the first place (Garmin push
// is owner-gated — see cron/gcal), so their turn here just finds nothing to
// queue on that surface.

export function GET(request: NextRequest): Promise<Response> {
  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  return withCronFanOut(async (userId) => {
    try {
      if (dryRun) {
        const preview = await previewArchivedPlanSyncArtifacts();
        return { dryRun: true, ...preview };
      }
      const result = await reconcileArchivedPlanSyncArtifacts();
      return { dryRun: false, ...result };
    } catch (err) {
      console.error(`Failed to reconcile archived plan sync artifacts for user ${userId}:`, err);
      return { ok: false, error: "Reconcile failed" };
    }
  }, "sync-reconcile-archived-plans")(request);
}
