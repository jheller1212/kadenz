import { NextRequest } from "next/server";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthDelete } from "@/lib/sync/garmin-sync";
import { isConnected } from "@/lib/sync/gcal-client";
import { resolveRequestUserId } from "@/lib/request-user";
import { db, strengthSessions, strengthSets, activityTrash } from "@/db";
import { eq } from "drizzle-orm";

// ── POST /api/strength/sessions/[id]/trash ───────────────────────────────────
// Moves a strength session (and its logged sets) into the recoverable trash,
// then deletes it. Same 30-day recovery window as deleted activities.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await resolveRequestUserId(request);
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const [session] = await db
      .select()
      .from(strengthSessions)
      .where(eq(strengthSessions.id, id))
      .limit(1);
    if (!session) return Response.json({ error: "Not found" }, { status: 404 });

    const sets = await db
      .select()
      .from(strengthSets)
      .where(eq(strengthSets.sessionId, id));

    await db
      .insert(activityTrash)
      .values({
        id: session.id,
        payload: {
          kind: "strength_session",
          session: JSON.parse(JSON.stringify(session)),
          sets: JSON.parse(JSON.stringify(sets)),
        },
      })
      .onConflictDoNothing();

    // Sets cascade with the session delete.
    await db.delete(strengthSessions).where(eq(strengthSessions.id, id));

    // The row is gone from Kadenz — take it off the athlete's calendar and
    // watch too, or it lingers on services they can't clean up from here.
    if (session.gcalEventId) {
      isConnected(userId)
        .then((connected) => {
          if (connected) {
            return queueStrengthSessionSync(id, "delete", userId, "gcal", {
              gcalEventId: session.gcalEventId!,
            });
          }
        })
        .catch((err) => console.error("Failed to queue calendar cleanup:", err));
    }
    if (session.garminWorkoutId) {
      queueGarminStrengthDelete(userId, id, session.garminWorkoutId).catch((err) =>
        console.error("Failed to queue Garmin cleanup:", err)
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error trashing strength session:", err);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
