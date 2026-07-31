import { NextRequest } from "next/server";
import { z } from "zod";
import { db, painLogs, strengthSessions } from "@/db";
import { withSession } from "@/lib/api/with-session";
import { requireOwned } from "@/lib/api/owned";

const PainSchema = z.object({
  score: z.number().int().min(0).max(10),
  timing: z.enum(["during", "after", "next_day"]),
  settledWithin24h: z.boolean().nullable().optional(),
  note: z.string().optional(),
});

// ── POST /api/strength/sessions/[id]/pain ─────────────────────────────────────
// Log an Achilles pain check-in for a session. Feeds the (advisory) pain gate.

export const POST = withSession(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;

  // pain_logs has no user_id of its own — it inherits isolation from its
  // parent session (see schema.ts), so ownership is resolved on the parent
  // here, before the body is even parsed. Checked ahead of body validation
  // for the same reason as the sessions PATCH route: a 422 on the body must
  // not stand in for "not owned".
  await requireOwned(strengthSessions, id);

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
});
