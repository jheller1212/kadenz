import { asc, eq, gt } from "drizzle-orm";
import { db, strengthSets, strengthSessions, strengthExercises } from "@/db";
import { csvRow } from "@/lib/csv";

// ── GET /api/export/strength-sets ──────────────────────────────────────────────
// Streams every logged strength set as CSV, joined to its session (for the
// date) and exercise (for the name). Same keyset-cursor pagination as the
// activities export — see that route for why.

const BATCH_SIZE = 500;

const HEADER = [
  "date",
  "exercise",
  "set_number",
  "kind", // "warmup" or "working"
  "weight_kg",
  "reps",
  "rpe",
  "feel",
];

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(csvRow(HEADER) + "\n"));

      let cursor: string | null = null;
      try {
        for (;;) {
          const rows = await db
            .select({
              id: strengthSets.id,
              sessionDate: strengthSessions.date,
              exerciseName: strengthExercises.name,
              setNumber: strengthSets.setNumber,
              kind: strengthSets.kind,
              weightKg: strengthSets.weightKg,
              reps: strengthSets.reps,
              rpe: strengthSets.rpe,
              feel: strengthSets.feel,
            })
            .from(strengthSets)
            .innerJoin(strengthSessions, eq(strengthSets.sessionId, strengthSessions.id))
            .innerJoin(strengthExercises, eq(strengthSets.exerciseId, strengthExercises.id))
            .where(cursor ? gt(strengthSets.id, cursor) : undefined)
            .orderBy(asc(strengthSets.id))
            .limit(BATCH_SIZE);

          if (rows.length === 0) break;

          let chunk = "";
          for (const r of rows) {
            chunk +=
              csvRow([
                r.sessionDate.toISOString(),
                r.exerciseName,
                r.setNumber,
                // Null reads as "working" everywhere else in the app (see
                // schema.ts strength_sets.kind) — the export makes that
                // explicit rather than leaving the column blank.
                r.kind ?? "working",
                r.weightKg,
                r.reps,
                r.rpe,
                r.feel ?? "",
              ]) + "\n";
          }
          controller.enqueue(encoder.encode(chunk));

          cursor = rows[rows.length - 1].id;
          if (rows.length < BATCH_SIZE) break;
        }
        controller.close();
      } catch (err) {
        console.error("Error streaming strength-sets export:", err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kadenz-strength-sets.csv"',
    },
  });
}
