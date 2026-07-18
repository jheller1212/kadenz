import { NextRequest } from "next/server";
import { db, strengthSessions, strengthSets, activityTrash } from "@/db";
import { eq } from "drizzle-orm";

// ── POST /api/strength/sessions/[id]/trash ───────────────────────────────────
// Moves a strength session (and its logged sets) into the recoverable trash,
// then deletes it. Same 30-day recovery window as deleted activities.

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error trashing strength session:", err);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
