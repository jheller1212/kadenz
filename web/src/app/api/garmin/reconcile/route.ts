import { db, workouts, strengthSessions } from "@/db";
import { isNotNull } from "drizzle-orm";
import { garminClient } from "@/lib/sync/garmin-client";
import { validateSessionCookie } from "@/lib/session";

// ── POST /api/garmin/reconcile ───────────────────────────────────────────────
// Removes leftovers Kadenz itself created on Garmin: duplicates from the old
// move bug, or deletions that never ran while the sync queue was wedged.
//
// A Garmin account is SHARED with other apps and the athlete's own
// hand-made workouts. "Kadenz does not track it" therefore does NOT mean
// "safe to delete" — only workouts carrying the Kadenz tag are ever removed,
// and the caller must pass {"confirm": true} to delete anything at all.
// Without it the route reports what it would do and changes nothing.
//
// This is destructive, so it checks auth itself rather than relying solely
// on the proxy gating every /api/* path — belt and suspenders, in case that
// matching ever changes. Same CRON_SECRET-or-owner-session rule as the other
// reconcile routes.

// Deleting is one Garmin round-trip each; cap per call so the function always
// returns. The response reports what is left so it can simply be run again.
const MAX_DELETES_PER_RUN = 20;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const fromCron =
    Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
  const fromOwner = await validateSessionCookie(request.headers.get("cookie"));
  if (!fromCron && !fromOwner) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!garminClient.isConfigured()) {
    return Response.json({ error: "Garmin worker not configured" }, { status: 503 });
  }

  let confirm = false;
  try {
    const body = (await request.json().catch(() => ({}))) as { confirm?: boolean };
    confirm = body.confirm === true;
  } catch {
    /* no body → dry run */
  }

  try {
    const [runRows, strengthRows, onGarmin] = await Promise.all([
      db
        .select({ garminWorkoutId: workouts.garminWorkoutId })
        .from(workouts)
        .where(isNotNull(workouts.garminWorkoutId)),
      db
        .select({ garminWorkoutId: strengthSessions.garminWorkoutId })
        .from(strengthSessions)
        .where(isNotNull(strengthSessions.garminWorkoutId)),
      garminClient.listWorkouts(300),
    ]);

    const tracked = new Set<string>();
    for (const r of [...runRows, ...strengthRows]) {
      if (r.garminWorkoutId) tracked.add(r.garminWorkoutId);
    }

    // Ours, and no longer referenced by any row. Anything untagged belongs to
    // another app or to the athlete — it is reported, never deleted.
    const orphans = onGarmin.filter(
      (w) => w.createdByKadenz && !tracked.has(w.garminWorkoutId)
    );
    const foreign = onGarmin.filter((w) => !w.createdByKadenz).length;
    const batch = confirm ? orphans.slice(0, MAX_DELETES_PER_RUN) : [];
    const deleted: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const orphan of batch) {
      try {
        await garminClient.deleteWorkout(orphan.garminWorkoutId);
        deleted.push(orphan.garminWorkoutId);
      } catch (err) {
        failed.push({
          id: orphan.garminWorkoutId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return Response.json({
      ok: true,
      dryRun: !confirm,
      onGarmin: onGarmin.length,
      notOurs: foreign,
      trackedByKadenz: tracked.size,
      orphans: orphans.length,
      deleted: deleted.length,
      remaining: orphans.length - deleted.length,
      failed,
    });
  } catch (err) {
    console.error("Garmin reconcile failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("garmin_auth")) {
      return Response.json({ error: "garmin_auth" }, { status: 503 });
    }
    return Response.json({ error: "Failed to reconcile" }, { status: 500 });
  }
}
