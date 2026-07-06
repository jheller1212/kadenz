import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, strengthSessions, painLogs } from "@/db";

const PainSchema = z.object({
  score: z.number().int().min(0).max(10),
  timing: z.enum(["during", "after", "next_day"]),
  settledWithin24h: z.boolean().nullable().optional(),
  note: z.string().optional(),
});

// ── POST /api/strength/sessions/[id]/pain ─────────────────────────────────────
// Log an Achilles pain check-in for a session. Feeds the (advisory) pain gate.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PainSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }

  try {
    const [session] = await db
      .select({ id: strengthSessions.id })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, id));
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    const [row] = await db
      .insert(painLogs)
      .values({
        sessionId: id,
        score: parsed.data.score,
        timing: parsed.data.timing,
        settledWithin24h: parsed.data.settledWithin24h ?? null,
        note: parsed.data.note ?? null,
      })
      .returning();

    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error("DB error logging pain:", err);
    return Response.json({ error: "Failed to log pain" }, { status: 500 });
  }
}
