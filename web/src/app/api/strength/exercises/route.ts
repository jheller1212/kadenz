import { db, strengthExercises } from "@/db";
import { asc } from "drizzle-orm";

// ── GET /api/strength/exercises ───────────────────────────────────────────────
// The seeded exercise catalogue.

export async function GET() {
  try {
    const rows = await db
      .select()
      .from(strengthExercises)
      .orderBy(asc(strengthExercises.sortOrder));
    return Response.json(rows);
  } catch (err) {
    console.error("DB error listing strength exercises:", err);
    return Response.json({ error: "Failed to fetch exercises" }, { status: 500 });
  }
}
