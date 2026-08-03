import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db, plans, strengthSessions } from "@/db";
import { getVerifiedProfileId } from "@/lib/profiles";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { ownedBy } from "@/lib/api/owned";
import { listStrengthSessions } from "./service";
import { SESSION_TEMPLATES } from "@/lib/strength/program";
import { EQUIPMENT_KEYS } from "@/lib/strength/equipment";
import { STRENGTH_SESSION_TYPES } from "@/lib/strength/types";
import { validateStrengthPlacement } from "@/lib/strength/constraints";
import {
  buildPlannedSession,
  getStrengthPlanSettingsRow,
  planDurationMinutesFromRow,
} from "@/lib/strength/service";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthMove } from "@/lib/sync/garmin-sync";
import { isConnected } from "@/lib/sync/gcal-client";
import type { RunRef, StrengthRef } from "@/lib/strength/constraints";
import type { Equipment } from "@/lib/strength/types";
import type { PlannedExercise } from "@/lib/strength/session";

const CreateSchema = z.object({
  type: z.enum(STRENGTH_SESSION_TYPES),
  date: z.string().datetime(),
  planId: z.string().uuid().optional(),
  force: z.boolean().optional(),
  // Explicit intent, not inferred: true only from Plan > Rearrange's "add a
  // session to this day" flow, which is deliberately building the schedule
  // (same category as the weekly scheduler's own placements). A Kraft-picker
  // "Start" or custom-workout quick-start never sends this — those are
  // ad-hoc trial sessions and must not reach the watch on their own (see
  // schema.ts strengthSessions.watchEligible and garmin-sync.ts).
  addToPlan: z.boolean().optional(),
  // Custom-workout sessions override the stock template's display fields so
  // history and calendar fan-out show the template name, not "Full Body".
  title: z.string().trim().min(1).max(120).optional(),
  targetDurationMinutes: z.number().int().min(1).max(600).optional(),
  // Session-level overrides ("I'm at the gym today", "only got 30 min
  // today") — apply to this one session only, never written back to
  // strength_plan_settings (see lib/strength/service.ts buildPlannedSession).
  // `equipmentOverride` is client-sent and re-validated below against the
  // known equipment vocabulary — never trusted blindly.
  equipmentOverride: z.array(z.string()).max(20).optional(),
  durationOverrideMinutes: z.number().int().min(10).max(120).optional(),
});

// ── GET /api/strength/sessions?from=&to= ──────────────────────────────────────
// List sessions in an optional date window, newest-first. Logged sets are
// joined ONLY with ?include=sets — the Today/list views need 6 scalar fields,
// and dragging every set along made strength cards render slower than runs.

export const GET = withSession(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const includeSets = searchParams.get("include") === "sets";

  const profileId = await getVerifiedProfileId(request);

  try {
    const rows = await listStrengthSessions(profileId, {
      from: from ? new Date(from) : null,
      to: to ? new Date(to) : null,
      includeSets,
    });
    return Response.json(rows);
  } catch (err) {
    console.error("DB error listing strength sessions:", err);
    return Response.json({ error: "Failed to fetch sessions" }, { status: 500 });
  }
});

// ── POST /api/strength/sessions ───────────────────────────────────────────────
// Create a planned session. Runs the constraint engine against the run schedule
// and other strength sessions; blocking (error) violations are rejected unless
// `force` is set (mirrors the dnd-kit override UX).

export const POST = withSession(async (request: NextRequest) => {
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

  const profileId = await getVerifiedProfileId(request);

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
          // The caller's active plan, not whoever's plan happens to be active.
          // RLS enforces it either way; naming the owner keeps the intent
          // readable and lets the planner use the user_id index.
          .where(and(ownedBy(plans), eq(plans.status, "active")))
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
            .where(and(ownedBy(strengthSessions), isNull(strengthSessions.profileId)))
        ).map((s) => ({ id: s.id, date: s.date, type: s.type }));

    // Fetched once and handed to buildPlannedSession below (both branches).
    const settingsRow = await getStrengthPlanSettingsRow(profileId);

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

    // Never trust a client-sent equipment list blindly — filter to the known
    // vocabulary the same way derivePlanSettingsForLoads already filters the
    // profile's own stored equipment. `undefined` (field absent) means "no
    // override, use the profile default"; an explicit `[]` is a real
    // override (bodyweight only), not "not sent".
    const equipmentKeySet = new Set<string>(EQUIPMENT_KEYS);
    const equipmentOverride: Equipment[] | undefined = data.equipmentOverride
      ? data.equipmentOverride.filter((e): e is Equipment => equipmentKeySet.has(e))
      : undefined;

    let targetDurationMinutes: number;
    let plannedExercises: PlannedExercise[];
    if (isCustom) {
      targetDurationMinutes = data.targetDurationMinutes ?? template.targetDurationMinutes;
      plannedExercises = (
        await buildPlannedSession(data.type, date, profileId, undefined, [], settingsRow)
      ).exercises;
    } else {
      // Honor the athlete's Kraft settings length (30/45/60 min) — an
      // explicit per-session override wins, then the legacy
      // targetDurationMinutes field (kept for existing callers), then the
      // saved preference, and only then the template's nominal length.
      const chosenMinutes =
        data.durationOverrideMinutes ??
        data.targetDurationMinutes ??
        planDurationMinutesFromRow(settingsRow) ??
        template.targetDurationMinutes;
      const built = await buildPlannedSession(
        data.type,
        date,
        profileId,
        chosenMinutes,
        [],
        settingsRow,
        equipmentOverride
      );
      plannedExercises = built.exercises;
      // Store the plan's real estimate, not the nominal chosen number — this
      // is what makes the duration setting show the truth downstream.
      targetDurationMinutes = built.estimatedDurationMinutes;
    }

    const [session] = await db
      .insert(strengthSessions)
      .values({
        userId: currentUserId(),
        planId,
        equipmentOverride: equipmentOverride ?? null,
        durationOverrideMinutes: data.durationOverrideMinutes ?? null,
        profileId,
        date,
        dayOfWeek: date.getDay(),
        type: data.type,
        title: data.title ?? template.title,
        targetDurationMinutes,
        status: "planned",
        watchEligible: data.addToPlan === true,
      })
      .returning();

    // Fan out to the watch and (if connected) Google Calendar. Owner sessions
    // only. queueGarminStrengthMove is safe to call unconditionally — it
    // self-gates on watchEligible, so a Kraft-picker/custom-workout ad-hoc
    // session (addToPlan not set) is a no-op here and only ever reaches the
    // watch via the athlete's explicit "Send to watch" control.
    if (!profileId) {
      queueGarminStrengthMove(session.id).catch((err) =>
        console.error("Failed to queue Garmin strength push:", err)
      );
      isConnected(currentUserId())
        .then((connected) => {
          if (connected) {
            queueStrengthSessionSync(session.id, "create", currentUserId(), "gcal").catch((err) =>
              console.error("Failed to queue strength gcal sync:", err)
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
});
