import { NextRequest } from "next/server";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthDelete } from "@/lib/sync/garmin-sync";
import { isConnected } from "@/lib/sync/gcal-client";
import { db, strengthSessions, strengthSets, activityTrash } from "@/db";
import { and, eq } from "drizzle-orm";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { ownedBy, requireOwned } from "@/lib/api/owned";

// ── POST /api/strength/sessions/[id]/trash ───────────────────────────────────
// Moves a strength session (and its logged sets) into the recoverable trash,
// then deletes it. Same 30-day recovery window as deleted activities.

export const POST = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  // Checked before the try block: requireOwned's 404 must not be swallowed by
  // this route's broad "DB error" catch below (see the sessions/[id] GET/
  // DELETE routes for the same fix and the reasoning).
  const session = await requireOwned(strengthSessions, id);
  try {
    const sets = await db
      .select()
      .from(strengthSets)
      .where(eq(strengthSets.sessionId, id));

    await db
      .insert(activityTrash)
      .values({
        id: session.id,
        userId: currentUserId(),
        payload: {
          kind: "strength_session",
          session: JSON.parse(JSON.stringify(session)),
          sets: JSON.parse(JSON.stringify(sets)),
        },
      })
      .onConflictDoNothing();

    // Sets cascade with the session delete.
    await db
      .delete(strengthSessions)
      .where(and(ownedBy(strengthSessions), eq(strengthSessions.id, id)));

    // The row is gone from Kadenz — take it off the athlete's calendar and
    // watch too, or it lingers on services they can't clean up from here.
    if (session.gcalEventId) {
      isConnected(currentUserId())
        .then((connected) => {
          if (connected) {
            return queueStrengthSessionSync(id, "delete", currentUserId(), "gcal", {
              gcalEventId: session.gcalEventId!,
            });
          }
        })
        .catch((err) => console.error("Failed to queue calendar cleanup:", err));
    }
    if (session.garminWorkoutId) {
      queueGarminStrengthDelete(currentUserId(), id, session.garminWorkoutId).catch((err) =>
        console.error("Failed to queue Garmin cleanup:", err)
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error trashing strength session:", err);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
});
