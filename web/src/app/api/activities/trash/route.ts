import { db, activityTrash } from "@/db";
import { lt, desc } from "drizzle-orm";

const RETENTION_DAYS = 30;

// ── GET /api/activities/trash ────────────────────────────────────────────────
// Lists recently deleted activities (newest first). Entries older than 30 days
// are purged on every read — no cron needed.

export async function GET() {
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    await db.delete(activityTrash).where(lt(activityTrash.deletedAt, cutoff));

    const rows = await db
      .select()
      .from(activityTrash)
      .orderBy(desc(activityTrash.deletedAt));

    return Response.json(
      rows.map((r) => {
        const p = r.payload as Record<string, unknown>;
        if (p.kind === "strength_session") {
          const sess = p.session as Record<string, unknown>;
          return {
            id: r.id,
            deletedAt: r.deletedAt.toISOString(),
            name: (sess.title as string | null) ?? "Strength session",
            date: (sess.date as string | null) ?? null,
            distanceKm: null,
            sportType: "strength",
          };
        }
        return {
          id: r.id,
          deletedAt: r.deletedAt.toISOString(),
          name: (p.name as string | null) ?? null,
          date: (p.startDate as string | null) ?? null,
          distanceKm: (p.distanceKm as number | null) ?? null,
          sportType: (p.sportType as string | null) ?? null,
        };
      })
    );
  } catch (err) {
    console.error("DB error listing activity trash:", err);
    return Response.json({ error: "Failed to load trash" }, { status: 500 });
  }
}
