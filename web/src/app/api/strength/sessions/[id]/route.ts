import { NextRequest } from "next/server";
import { z } from "zod";
import { eq, and, gte, lt, isNull } from "drizzle-orm";
import { db, strengthSessions, strengthSets, painLogs, activities, strengthExercises } from "@/db";
import {
  buildPlannedSession,
  getStrengthPlanSettingsRow,
  planDurationMinutesFromRow,
} from "@/lib/strength/service";
import { clearsAutoScheduled, twinAbsorptionUpdate } from "@/lib/strength/reconcile";
import { SESSION_TEMPLATES, EXERCISE_BY_SLUG } from "@/lib/strength/program";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { queueGarminStrengthDelete, queueGarminStrengthMove } from "@/lib/sync/garmin-sync";
import { isConnected } from "@/lib/sync/gcal-client";
import type { Equipment, StrengthSessionType } from "@/lib/strength/types";
import { validateAchillesOrdering, type ExerciseOverride } from "@/lib/strength/session";
import { alignSetHeartRate, type HeartRateStream } from "@/lib/sync/strength-hr";

const ExerciseOverrideSchema = z.discriminatedUnion("action", [
  z.object({ slug: z.string(), action: z.literal("removed") }),
  z.object({ slug: z.string(), action: z.literal("swapped"), replacementSlug: z.string() }),
]);

const PatchSchema = z
  .object({
    status: z.enum(["planned", "completed", "skipped", "missed"]).optional(),
    date: z.string().datetime().optional(),
    durationMinutes: z.number().int().positive().optional(),
    notes: z.string().optional(),
    sortOrder: z.number().int().optional(),
    // Exchange / Remove — full replace of the session's hand-edit layer (see
    // lib/strength/session.ts applyExerciseOverrides). The caller always
    // sends the complete array, same pattern as availableDays elsewhere.
    exerciseOverrides: z.array(ExerciseOverrideSchema).optional(),
    // The athlete's own exercise order for this session, as slugs, sent when
    // they start from the pre-start sheet. Full replace, same as
    // exerciseOverrides above. An empty array clears it back to the plan's
    // own order.
    exerciseOrder: z.array(z.string()).optional(),
  })
  .strict();

// Achilles-role work is rehab, not filler — never let an override touch it,
// either as the thing being changed or as a swap target.
function rejectsAchillesWork(overrides: ExerciseOverride[]): boolean {
  return overrides.some((ov) => {
    const target = EXERCISE_BY_SLUG[ov.slug];
    if (target?.achillesRole) return true;
    if (ov.action === "swapped") {
      const replacement = EXERCISE_BY_SLUG[ov.replacementSlug];
      if (!replacement || replacement.achillesRole) return true;
    }
    return false;
  });
}

// ── GET /api/strength/sessions/[id] ───────────────────────────────────────────
// Session with logged sets, plus the planned exercises (prescriptions,
// progression prefill, pain-gate advisory) for the logger.

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await db.query.strengthSessions.findFirst({
      where: (s, { eq }) => eq(s.id, id),
      with: {
        // Exercise slug per set is a single indexed FK join (exerciseId is
        // already the PK lookup strength_sets is built around) — needed so
        // the volume stat below can look up each set's dumbbell/bodyweight
        // profile from the catalogue (see lib/strength/volume.ts).
        sets: {
          orderBy: (st, { asc }) => [asc(st.setNumber)],
          with: { exercise: { columns: { slug: true } } },
        },
        painLogs: true,
      },
    });
    if (!session) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }
    const sets = session.sets.map(({ exercise, ...set }) => ({
      ...set,
      exerciseSlug: exercise.slug,
    }));
    const type = session.type as StrengthSessionType;
    // A custom-workout session (title differs from the stock template's
    // title) already carries its own real duration — never re-fit it
    // against the stock template's exercise list.
    const isCustom = session.title !== SESSION_TEMPLATES[type].title;
    // Fit to the athlete's Kraft LENGTH SETTING (30/45/60), never to the
    // session's stored targetDurationMinutes. That column holds the ESTIMATE
    // (an output); feeding it back as the fit target shrinks the session a
    // little more on every read (trim-only fit) — a slow death-spiral that made
    // the shown duration drift. The setting is the stable input.
    // Fetched once and handed to buildPlannedSession below so it doesn't
    // query strength_plan_settings a second time for the same profile —
    // buildPlannedSession always needs ability/equipment/complaints from this
    // row regardless of isCustom, only the duration-fit use is conditional.
    const settingsRow = await getStrengthPlanSettingsRow(session.profileId);
    // This session's own stored duration/equipment override (if the athlete
    // set one at creation — see the sessions POST route) wins over the
    // profile default, exactly like the plan is rebuilt from the template on
    // every read rather than stored — the override must be re-applied here
    // too, or a reopened session would silently revert to the profile's
    // default equipment/length (see schema.ts strengthSessions comment).
    const fitMinutes = isCustom
      ? undefined
      : session.durationOverrideMinutes ?? planDurationMinutesFromRow(settingsRow);
    const equipmentOverride =
      session.equipmentOverride != null ? (session.equipmentOverride as Equipment[]) : undefined;
    const { exercises: plannedExercises, estimatedDurationMinutes } =
      await buildPlannedSession(
        type,
        new Date(session.date),
        session.profileId,
        fitMinutes,
        (session.exerciseOverrides as ExerciseOverride[] | null) ?? [],
        settingsRow,
        equipmentOverride,
        // The athlete's own order, stored when they started from the
        // pre-start sheet. Same reason the equipment/duration overrides
        // above are re-applied on every read: the plan itself is not stored.
        session.exerciseOrder
      );

    // Self-heal: a session's targetDurationMinutes may still hold the
    // nominal Kraft-settings choice (30/45/60) from auto-scheduling, not the
    // real estimate of the plan actually produced — bring it in line with
    // the truth on first read so the app and Garmin push it correctly too.
    if (!isCustom && session.targetDurationMinutes !== estimatedDurationMinutes) {
      await db
        .update(strengthSessions)
        .set({ targetDurationMinutes: estimatedDurationMinutes })
        .where(eq(strengthSessions.id, id));
      session.targetDurationMinutes = estimatedDurationMinutes;
    }

    // A linked recorded activity (Strava or Garmin) contributes HR + duration
    // to the logged sets. streamsJson/startDate are only used server-side
    // below (to derive per-set HR) — not echoed back on linkedActivity itself.
    const [linkedActivityRow] = await db
      .select({
        id: activities.id,
        stravaId: activities.stravaId,
        garminId: activities.garminId,
        avgHr: activities.avgHr,
        maxHr: activities.maxHr,
        durationSeconds: activities.durationSeconds,
        startDate: activities.startDate,
        streamsJson: activities.streamsJson,
      })
      .from(activities)
      .where(eq(activities.strengthSessionId, id))
      .limit(1);

    // Per-set heart rate, derived on read from the linked activity's HR
    // stream aligned against each set's createdAt — see alignSetHeartRate for
    // exactly what the number represents (a guessed window ending around
    // when the set was logged, not an exact per-rep reading). Absent (null)
    // whenever there's no linked activity, no HR stream, or no sample falls
    // in the set's window — never a fabricated 0.
    const stream =
      linkedActivityRow?.streamsJson != null
        ? ((linkedActivityRow.streamsJson as { time?: number[]; heartrate?: number[] })
            .heartrate
            ? {
                time: (linkedActivityRow.streamsJson as { time: number[] }).time,
                heartrate: (linkedActivityRow.streamsJson as { heartrate: number[] }).heartrate,
              }
            : null)
        : null;
    const setsWithHr = sets.map((set) => {
      const hr: HeartRateStream | null = stream;
      const { avgHr, maxHr } =
        linkedActivityRow?.startDate && hr
          ? alignSetHeartRate(linkedActivityRow.startDate, hr, {
              createdAt: set.createdAt,
              durationSeconds: set.durationSeconds,
            })
          : { avgHr: null, maxHr: null };
      return { ...set, avgHr, maxHr };
    });

    const linkedActivity = linkedActivityRow
      ? {
          id: linkedActivityRow.id,
          stravaId: linkedActivityRow.stravaId,
          garminId: linkedActivityRow.garminId,
          avgHr: linkedActivityRow.avgHr,
          maxHr: linkedActivityRow.maxHr,
          durationSeconds: linkedActivityRow.durationSeconds,
        }
      : null;

    return Response.json({
      ...session,
      sets: setsWithHr,
      plannedExercises,
      linkedActivity,
    });
  } catch (err) {
    console.error("DB error fetching strength session:", err);
    return Response.json({ error: "Failed to fetch session" }, { status: 500 });
  }
}

// ── PATCH /api/strength/sessions/[id] ─────────────────────────────────────────
// Update status / reschedule / duration. A date or status change re-syncs the
// calendar event (the drag-and-drop fan-out).

export async function PATCH(
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

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 }
    );
  }
  const updates = parsed.data;
  if (Object.keys(updates).length === 0) {
    return Response.json({ error: "No fields to update" }, { status: 422 });
  }

  if (updates.exerciseOverrides && rejectsAchillesWork(updates.exerciseOverrides)) {
    return Response.json(
      { error: "Achilles/calf rehab work can't be exchanged or removed." },
      { status: 422 }
    );
  }

  // Within an Achilles session, explosive work comes before slow heavy (HSR)
  // calf work. A stored order outlives the day it was set, so an order that
  // breaks the rehab protocol is refused rather than saved.
  if (updates.exerciseOrder && updates.exerciseOrder.length > 0) {
    const ordering = validateAchillesOrdering(updates.exerciseOrder);
    if (!ordering.valid) {
      return Response.json({ error: ordering.message }, { status: 422 });
    }
  }

  // Never let an override erase or reinterpret sets the athlete already
  // logged this session — block it outright rather than guess whether to
  // keep or discard the history.
  if (updates.exerciseOverrides && updates.exerciseOverrides.length > 0) {
    const logged = await db
      .select({ slug: strengthExercises.slug })
      .from(strengthSets)
      .innerJoin(strengthExercises, eq(strengthSets.exerciseId, strengthExercises.id))
      .where(eq(strengthSets.sessionId, id));
    const loggedSlugs = new Set(logged.map((l) => l.slug));
    if (updates.exerciseOverrides.some((ov) => loggedSlugs.has(ov.slug))) {
      return Response.json(
        { error: "That exercise already has sets logged this session. It can't be exchanged or removed." },
        { status: 409 }
      );
    }
  }

  try {
    const set: Record<string, unknown> = { ...updates, updatedAt: new Date() };
    // A meaningful hand edit (date move, notes, reorder, duration) adopts an
    // auto-scheduled session — the scheduler's prune must never delete
    // something the user deliberately shaped. A bare status tick/untick is
    // NOT adoption: it must not launder auto sessions past future pruning.
    if (clearsAutoScheduled(updates)) set.autoScheduled = false;
    if (updates.date) {
      const d = new Date(updates.date);
      set.date = d;
      set.dayOfWeek = d.getDay();
    }

    // The real duration is the gap between the first and last logged set
    // (see schema.ts strengthSessions startedAt/endedAt), never a client-side
    // wall-clock read since app foreground time — that ref doesn't survive a
    // reload or a minimize/resume days apart. Overrides whatever
    // durationMinutes the client sent; a session with no logged sets at all
    // (startedAt still null) falls back to the client's value untouched, so
    // an empty completed session doesn't get a fabricated duration either.
    if (updates.status === "completed") {
      const [times] = await db
        .select({ startedAt: strengthSessions.startedAt, endedAt: strengthSessions.endedAt })
        .from(strengthSessions)
        .where(eq(strengthSessions.id, id));
      if (times?.startedAt && times?.endedAt) {
        set.durationMinutes = Math.max(
          1,
          Math.round((times.endedAt.getTime() - times.startedAt.getTime()) / 60000)
        );
      }
    }

    const [updated] = await db
      .update(strengthSessions)
      .set(set)
      .where(eq(strengthSessions.id, id))
      .returning();

    // Completing a session absorbs any same-day planned twin of the same type
    // (an ad-hoc start that didn't adopt the scheduled slot, or vice versa).
    // Its sets and pain logs move over so no history is lost, and the twin is
    // marked skipped rather than deleted — it stops counting as a phantom
    // "planned" leftover, but it stays in the DB so nothing an athlete could
    // have seen (a note, a linked Strava/Garmin activity still pointing at
    // it, a hand-edited exercise list) silently vanishes without trace.
    if (updated && updates.status === "completed") {
      const dayStart = new Date(updated.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const twins = await db
        .select()
        .from(strengthSessions)
        .where(
          and(
            eq(strengthSessions.type, updated.type),
            eq(strengthSessions.status, "planned"),
            gte(strengthSessions.date, dayStart),
            lt(strengthSessions.date, dayEnd),
            // Same athlete only — a household member's identical session must
            // never be absorbed (and its sets stolen) by someone else's tick.
            updated.profileId
              ? eq(strengthSessions.profileId, updated.profileId)
              : isNull(strengthSessions.profileId)
          )
        );
      for (const twin of twins) {
        if (twin.id === updated.id) continue;
        await db
          .update(strengthSets)
          .set({ sessionId: updated.id })
          .where(eq(strengthSets.sessionId, twin.id));
        // Pain logs cascade-delete with the session, so move them across too.
        await db
          .update(painLogs)
          .set({ sessionId: updated.id })
          .where(eq(painLogs.sessionId, twin.id));
        if (twin.gcalEventId) {
          isConnected()
            .then((connected) => {
              if (connected) {
                return queueStrengthSessionSync(twin.id, "delete", "gcal", {
                  gcalEventId: twin.gcalEventId,
                });
              }
            })
            .catch((err) => console.error("Failed to queue twin calendar cleanup:", err));
        }
        // Same reasoning as the calendar event: a Garmin workout push for the
        // twin has to be cancelled explicitly, it doesn't follow the row. The
        // stored id is cleared in the same update below so the row doesn't
        // keep pointing at a watch workout we just queued for deletion — an
        // uncleared id there would look, to the self-heal resync, like a
        // legitimate push that needs repair rather than a deliberate removal.
        if (twin.garminWorkoutId) {
          queueGarminStrengthDelete(twin.id, twin.garminWorkoutId).catch((err) =>
            console.error("Failed to queue twin Garmin cleanup:", err)
          );
        }
        await db
          .update(strengthSessions)
          .set({
            ...twinAbsorptionUpdate(new Date()),
            ...(twin.garminWorkoutId ? { garminWorkoutId: null } : {}),
          })
          .where(eq(strengthSessions.id, twin.id));
      }
    }

    if (!updated) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    if (updates.date || updates.status || updates.exerciseOverrides) {
      // A completed session comes OFF the watch rather than being updated in
      // place: the plan no longer has anything due there, and a "planned"
      // entry that's actually already done is exactly the stale-is-worse-
      // than-missing case — either the athlete logged it in-app (the watch
      // copy is now pure noise) or they did it on the watch directly (Garmin
      // already reflects that on the device; this push-side copy is inert).
      if (updates.status === "completed" && updated?.garminWorkoutId) {
        const garminWorkoutId = updated.garminWorkoutId;
        queueGarminStrengthDelete(id, garminWorkoutId).catch((err) =>
          console.error("Failed to queue Garmin strength delete on completion:", err)
        );
        // Clear it now, not just after the queued job runs — otherwise a
        // second edit before the job drains would see a stale id and try to
        // "update" a workout that's already been queued for deletion.
        await db
          .update(strengthSessions)
          .set({ garminWorkoutId: null })
          .where(eq(strengthSessions.id, id));
      } else {
        // Garmin is independent of Google Calendar: push to the watch whenever a
        // session changes (the queue self-gates on Garmin being configured), so a
        // reschedule/tick/exercise-swap reaches the watch immediately even
        // without GCal.
        queueGarminStrengthMove(id).catch((err) =>
          console.error("Failed to queue Garmin strength update:", err)
        );
      }
      isConnected()
        .then((connected) => {
          if (connected) {
            queueStrengthSessionSync(id, "update", "gcal").catch((err) =>
              console.error("Failed to queue strength gcal update:", err)
            );
          }
        })
        .catch(() => {});
    }

    return Response.json(updated);
  } catch (err) {
    console.error("DB error updating strength session:", err);
    return Response.json({ error: "Failed to update session" }, { status: 500 });
  }
}

// ── DELETE /api/strength/sessions/[id] ────────────────────────────────────────
// Remove a scheduled strength session and its calendar event.

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const [existing] = await db
      .select({
        id: strengthSessions.id,
        gcalEventId: strengthSessions.gcalEventId,
        garminWorkoutId: strengthSessions.garminWorkoutId,
      })
      .from(strengthSessions)
      .where(eq(strengthSessions.id, id));

    if (!existing) {
      return Response.json({ error: "Session not found" }, { status: 404 });
    }

    await db.delete(strengthSessions).where(eq(strengthSessions.id, id));

    // Fan out the calendar deletion if there was an event.
    if (existing.gcalEventId) {
      isConnected()
        .then((connected) => {
          if (connected) {
            queueStrengthSessionSync(id, "delete", "gcal", {
              gcalEventId: existing.gcalEventId!,
            }).catch((err) =>
              console.error("Failed to queue strength gcal delete:", err)
            );
          }
        })
        .catch(() => {});
    }

    // ...and take it off the watch, or it lingers there after deletion here.
    if (existing.garminWorkoutId) {
      queueGarminStrengthDelete(id, existing.garminWorkoutId).catch((err) =>
        console.error("Failed to queue Garmin strength delete:", err)
      );
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("DB error deleting strength session:", err);
    return Response.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
