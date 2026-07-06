import { NextRequest } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, plans, strengthSessions } from "@/db";
import { validateStrengthPlacement } from "@/lib/strength/constraints";
import type { RunRef, StrengthRef } from "@/lib/strength/constraints";

const ValidateSchema = z.object({
  type: z.enum(["upper", "lower", "lower_achilles"]),
  date: z.string().datetime(),
  excludeSessionId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
});

// ── POST /api/strength/validate ───────────────────────────────────────────────
// Check a proposed placement (or move) against the run schedule + Achilles cap.
// Used by the planner's drag-and-drop override UX before committing a move.

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = ValidateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const data = parsed.data;

  try {
    let planId = data.planId ?? null;
    if (!planId) {
      const [active] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.status, "active"))
        .limit(1);
      planId = active?.id ?? null;
    }

    const runWorkouts: RunRef[] = planId
      ? (
          await db.query.workouts.findMany({
            where: (w, { eq }) => eq(w.planId, planId!),
            columns: { date: true, type: true },
          })
        ).map((w) => ({ date: w.date, type: w.type }))
      : [];

    const strength: StrengthRef[] = (
      await db
        .select({ id: strengthSessions.id, date: strengthSessions.date, type: strengthSessions.type })
        .from(strengthSessions)
    ).map((s) => ({ id: s.id, date: s.date, type: s.type }));

    const violations = validateStrengthPlacement({
      session: { id: data.excludeSessionId, date: new Date(data.date), type: data.type },
      runWorkouts,
      strengthSessions: strength,
    });

    return Response.json({
      ok: !violations.some((v) => v.severity === "error"),
      violations,
    });
  } catch (err) {
    console.error("DB error validating placement:", err);
    return Response.json({ error: "Validation failed" }, { status: 500 });
  }
}
