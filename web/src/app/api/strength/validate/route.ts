import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, plans, strengthSessions } from "@/db";
import { validateStrengthPlacement } from "@/lib/strength/constraints";
import { STRENGTH_SESSION_TYPES } from "@/lib/strength/types";
import type { RunRef, StrengthRef } from "@/lib/strength/constraints";
import { withSession } from "@/lib/api/with-session";
import { ownedBy } from "@/lib/api/owned";

const ValidateSchema = z.object({
  // Must match the create schema — a narrower list 422'd real requests
  // (e.g. full_body), so constraint feedback silently failed in the UI.
  type: z.enum(STRENGTH_SESSION_TYPES),
  date: z.string().datetime(),
  excludeSessionId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
});

// ── POST /api/strength/validate ───────────────────────────────────────────────
// Check a proposed placement (or move) against the run schedule + Achilles cap.
// Used by the planner's drag-and-drop override UX before committing a move.

export const POST = withSession(async (request: NextRequest) => {
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
        // "The active plan" means the CALLER's active plan. Row level security
        // would already limit this to them, but an unfiltered status lookup
        // reads as "whoever's plan is active", which is the wrong intent to
        // leave in the code and the wrong thing to copy into the next route.
        .where(and(ownedBy(plans), eq(plans.status, "active")))
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
        .where(ownedBy(strengthSessions))
    ).map((s) => ({ id: s.id, date: s.date, type: s.type }));

    // The constraint engine's Achilles rules (spacing/frequency cap, before-
    // hard-run) key entirely off session `type` now — only the dedicated
    // "achilles" type (and the historic lower_achilles/upper_achilles combo
    // types) carry the block, since an achilles complaint no longer reshapes
    // a plain lower/upper/full_body session (see constraints.ts
    // hasAchillesBlock / program.ts sessionTemplateFor) — no extra profile
    // lookup needed here.
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
});
