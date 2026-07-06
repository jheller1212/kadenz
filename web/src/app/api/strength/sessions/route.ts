import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, plans, strengthSessions } from "@/db";
import { SESSION_TEMPLATES } from "@/lib/strength/program";
import { validateStrengthPlacement } from "@/lib/strength/constraints";
import { buildPlannedSession } from "@/lib/strength/service";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import type { RunRef, StrengthRef } from "@/lib/strength/constraints";

const CreateSchema = z.object({
  type: z.enum(["upper", "lower", "lower_achilles"]),
  date: z.string().datetime(),
  planId: z.string().uuid().optional(),
  force: z.boolean().optional(),
});

// ── GET /api/strength/sessions?from=&to= ──────────────────────────────────────
// List sessions (with logged sets) in an optional date window, newest-first.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  try {
    const conds = [];
    if (from) conds.push(gte(strengthSessions.date, new Date(from)));
    if (to) conds.push(lte(strengthSessions.date, new Date(to)));

    const rows = await db.query.strengthSessions.findMany({
      where: conds.length ? and(...conds) : undefined,
      orderBy: (s, { desc }) => [desc(s.date)],
      with: {
        sets: { orderBy: (st, { asc }) => [asc(st.setNumber)] },
      },
    });
    return Response.json(rows);
  } catch (err) {
    console.error("DB error listing strength sessions:", err);
    return Response.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
}

// ── POST /api/strength/sessions ───────────────────────────────────────────────
// Create a planned session. Runs the constraint engine against the run schedule
// and other strength sessions; blocking (error) violations are rejected unless
// `force` is set (mirrors the dnd-kit override UX).

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const data = parsed.data;
  const date = new Date(data.date);

  try {
    // Resolve the active plan when none supplied.
    let planId = data.planId ?? null;
    if (!planId) {
      const [active] = await db
        .select({ id: plans.id })
        .from(plans)
        .where(eq(plans.status, "active"))
        .limit(1);
      planId = active?.id ?? null;
    }

    // Gather context for the constraint engine.
    const runWorkouts: RunRef[] = planId
      ? (
          await db.query.workouts.findMany({
            where: (w, { eq }) => eq(w.planId, planId!),
            columns: { date: true, type: true },
          })
        ).map((w) => ({ date: w.date, type: w.type }))
      : [];
    const existingStrength: StrengthRef[] = (
      await db
        .select({ id: strengthSessions.id, date: strengthSessions.date, type: strengthSessions.type })
        .from(strengthSessions)
    ).map((s) => ({ id: s.id, date: s.date, type: s.type }));

    const violations = validateStrengthPlacement({
      session: { date, type: data.type },
      runWorkouts,
      strengthSessions: existingStrength,
    });
    const hasError = violations.some((v) => v.severity === "error");
    if (hasError && !data.force) {
      return Response.json(
        { error: "Constraint violation", violations },
        { status: 409 }
      );
    }

    const template = SESSION_TEMPLATES[data.type];
    const [session] = await db
      .insert(strengthSessions)
      .values({
        planId,
        date,
        dayOfWeek: date.getDay(),
        type: data.type,
        title: template.title,
        targetDurationMinutes: template.targetDurationMinutes,
        status: "planned",
      })
      .returning();

    // Fan out to Google Calendar if connected.
    isConnected()
      .then((connected) => {
        if (connected) {
          queueStrengthSessionSync(session.id, "create", "gcal").catch((err) =>
            console.error("Failed to queue strength gcal sync:", err)
          );
        }
      })
      .catch(() => {});

    const plannedExercises = await buildPlannedSession(data.type, date);
    return Response.json({ session, plannedExercises, violations }, { status: 201 });
  } catch (err) {
    console.error("DB error creating strength session:", err);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
