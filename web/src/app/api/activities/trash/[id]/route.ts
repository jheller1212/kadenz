import { NextRequest } from "next/server";
import { db, activityTrash } from "@/db";
import { and, eq } from "drizzle-orm";
import { withSession } from "@/lib/api/with-session";
import { ownedBy, requireOwned } from "@/lib/api/owned";

// ── DELETE /api/activities/trash/[id] ────────────────────────────────────────
// Purges a trashed activity forever. Sync tombstones (deleted_activities) are
// intentionally kept so Strava/Garmin never re-import it.

export const DELETE = withSession(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // Outside the try below so its 404 reaches withSession directly.
  await requireOwned(activityTrash, id);

  try {
    const [row] = await db
      .delete(activityTrash)
      .where(and(eq(activityTrash.id, id), ownedBy(activityTrash)))
      .returning({ id: activityTrash.id });
    if (!row) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error purging trashed activity:", err);
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
});
