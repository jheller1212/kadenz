import { type NextRequest } from "next/server";
import { validateSessionCookie } from "@/lib/session";
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
// Same auth as the daily cron: either CRON_SECRET (Bearer) or a signed-in
// owner session, so this can be called from a browser tab while logged in.

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";

  try {
    if (dryRun) {
      const preview = await previewArchivedPlanSyncArtifacts();
      return Response.json({ dryRun: true, ...preview });
    }
    const result = await reconcileArchivedPlanSyncArtifacts();
    return Response.json({ dryRun: false, ...result });
  } catch (err) {
    console.error("Failed to reconcile archived plan sync artifacts:", err);
    return Response.json({ error: "Reconcile failed" }, { status: 500 });
  }
}
