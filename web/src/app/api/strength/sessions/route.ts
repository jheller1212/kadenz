import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { db, plans, strengthSessions } from "@/db";
import { getActiveProfileId } from "@/lib/profiles";
import { SESSION_TEMPLATES } from "@/lib/strength/program";
import { STRENGTH_SESSION_TYPES } from "@/lib/strength/types";
import { validateStrengthPlacement } from "@/lib/strength/constraints";
import { buildPlannedSession, getPlanDurationMinutes } from "@/lib/strength/service";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthMove } from "@/lib/sync/garmin-sync";
import { isConnected } from "@/lib/sync/gcal-client";
import type { RunRef, StrengthRef } from "@/lib/strength/constraints";
import type { PlannedExercise } from "@/lib/strength/session";

const CreateSchema = z.object({
  type: z.enum(STRENGTH_SESSION_TYPES),
  date: z.string().datetime(),
  planId: z.string().uuid().optional(),
  force: z.boolean().optional(),
  // Custom-workout sessions override the stock template's display fields so
  // history and calendar fan-out show the template name, not "Full Body".
  title: z.string().trim().min(1).max(120).optional(),
  targetDurationMinutes: z.number().int().min(1).max(600).optional(),
});

// ── GET /api/strength/sessions?from=&to= ──────────────────────────────────────
// List sessions (with logged sets) in an optional date window, newest-first.

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const profileId = getActiveProfileId(request);

  try {
    const conds = [
      profileId
        ? eq(strengthSessions.profileId, profileId)
        : isNull(strengthSessions.profileId),
    ];
    if (from) conds.push(gte(strengthSessions.date, new Date(from)));
    if (to) conds.push(lte(strengthSessions.date, new Date(to)));

    const rows = await db.query.strengthSessions.findMany({
      where: and(...conds),
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

  const profileId = getActiveProfileId(request);

  try {
    // Guest profiles live outside the run plan: no plan link, no run-schedule
    // constraint engine, no calendar fan-out.
    let planId: string | null = null;
    if (!profileId) {
      planId = data.planId ?? null;
      if (!planId) {
        const [active] = await db
          .select({ id: plans.id })
          .from(plans)
          .where(eq(plans.status, "active"))
          .limit(1);
        planId = active?.id ?? null;
      }
    }

    // Gather context for the constraint engine (owner only, own sessions only).
    const runWorkouts: RunRef[] = planId
      ? (
          await db.query.workouts.findMany({
            where: (w, { eq }) => eq(w.planId, planId!),
            columns: { date: true, type: true },
          })
        ).map((w) => ({ date: w.date, type: w.type }))
      : [];
    const existingStrength: StrengthRef[] = profileId
      ? []
      : (
          await db
            .select({ id: strengthSessions.id, date: strengthSessions.date, type: strengthSessions.type })
            .from(strengthSessions)
            .where(isNull(strengthSessions.profileId))
        ).map((s) => ({ id: s.id, date: s.date, type: s.type }));

    const violations = profileId
      ? []
      : validateStrengthPlacement({
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
    // A custom-workout session (title override) already carries its own
    // exact exercise list and duration estimate from the client — don't
    // re-fit it against the stock template, that would silently replace the
    // real custom-workout duration with a stock-template-based guess.
    const isCustom = data.title != null;

    let targetDurationMinutes: number;
    let plannedExercises: PlannedExercise[];
    if (isCustom) {
      targetDurationMinutes = data.targetDurationMinutes ?? template.targetDurationMinutes;
      plannedExercises = (await buildPlannedSession(data.type, date, profileId)).exercises;
    } else {
      // Honor the athlete's Kraft settings length (30/45/60 min) — an
      // explicit override wins, otherwise fall back to the saved
      // preference, and only then to the template's nominal length.
      const chosenMinutes =
        data.targetDurationMinutes ??
        (await getPlanDurationMinutes(profileId)) ??
        template.targetDurationMinutes;
      const built = await buildPlannedSession(data.type, date, profileId, chosenMinutes);
      plannedExercises = built.exercises;
      // Store the plan's real estimate, not the nominal chosen number — this
      // is what makes the duration setting show the truth downstream.
      targetDurationMinutes = built.estimatedDurationMinutes;
    }

    const [session] = await db
      .insert(strengthSessions)
      .values({
        planId,
        profileId,
        date,
        dayOfWeek: date.getDay(),
        type: data.type,
        title: data.title ?? template.title,
        targetDurationMinutes,
        status: "planned",
      })
      .returning();

    // Fan out to Google Calendar if connected (owner sessions only).
    if (!profileId) {
      isConnected()
        .then((connected) => {
          if (connected) {
            queueStrengthSessionSync(session.id, "create", "gcal").catch((err) =>
              console.error("Failed to queue strength gcal sync:", err)
            );
            // Push to the watch too — a Kraft session is a real workout there.
            queueGarminStrengthMove(session.id).catch((err) =>
              console.error("Failed to queue Garmin strength push:", err)
            );
          }
        })
        .catch(() => {});
    }

    return Response.json({ session, plannedExercises, violations }, { status: 201 });
  } catch (err) {
    console.error("DB error creating strength session:", err);
    return Response.json({ error: "Failed to create session" }, { status: 500 });
  }
}
