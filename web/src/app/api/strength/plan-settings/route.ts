import { NextRequest } from "next/server";
import { z } from "zod";
import { db, strengthPlanSettings } from "@/db";
import { getVerifiedProfileId } from "@/lib/profiles";
import {
  ensureStrengthSchedule,
  pruneAutoSchedule,
  resyncPlannedStrengthSessions,
} from "@/lib/strength/schedule";
import { withSession } from "@/lib/api/with-session";
import { currentUserId } from "@/db/with-user";
import { profCond, getPlanSettings } from "./service";

const EQUIPMENT_VALUES = [
  "dumbbell", "barbell", "bench", "chair", "box", "kettlebell", "pullup_bar", "band",
] as const;

const COMPLAINT_VALUES = [
  "achilles", "plantar_fascia", "shin", "knee", "itb", "hamstring", "hip_glute",
] as const;

const SettingsSchema = z.object({
  goal: z.enum(["running_focus", "all_round"]),
  durationMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)]),
  sessionsPerWeek: z.number().int().min(1).max(4),
  ability: z.enum(["beginner", "intermediate", "advanced"]),
  availableDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  equipment: z.array(z.enum(EQUIPMENT_VALUES)).max(EQUIPMENT_VALUES.length),
  // Reported running complaints (optional Kraft setup step). Absent/empty =
  // general runner default — no targeted or Achilles work.
  complaints: z.array(z.enum(COMPLAINT_VALUES)).max(COMPLAINT_VALUES.length).optional(),
  active: z.boolean().optional().default(true),
  // Standalone block (only meaningful without a running plan to follow).
  blockWeeks: z.union([z.literal(8), z.literal(12), z.literal(16)]).nullish(),
  blockStartDate: z.string().datetime().nullish(),
  // Cold-start load personalisation — optional, nullable; skipping them keeps
  // today's global default loads (see lib/strength/load-model.ts).
  bodyweightKg: z.number().min(20).max(300).nullable().optional(),
  sex: z.enum(["male", "female", "unspecified"]).nullable().optional(),
  // Preferred rest between sets (seconds). null = program per-exercise defaults.
  restSeconds: z.number().int().min(15).max(300).nullable().optional(),
}).refine((s) => new Set(s.availableDays).size >= s.sessionsPerWeek, {
  message: "Pick at least as many distinct days as sessions per week",
});

export const GET = withSession(async (request: NextRequest) => {
  try {
    const settings = await getPlanSettings(await getVerifiedProfileId(request));
    return Response.json(settings);
  } catch (err) {
    console.error("[plan-settings] get failed", err);
    return Response.json({ error: "Failed to load settings" }, { status: 500 });
  }
});

export const PUT = withSession(async (request: NextRequest) => {
  const profileId = await getVerifiedProfileId(request);

  let data: z.infer<typeof SettingsSchema>;
  try {
    data = SettingsSchema.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "Invalid request", details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }

  try {
    // Update-first, insert-on-miss; the partial unique index (0015) makes the
    // insert race-safe, and a lost race falls through to the update.
    const { blockStartDate, blockWeeks, ...rest } = data;
    const complaints = [...new Set(data.complaints ?? [])];
    // Same Achilles clock the PATCH keeps (see below): re-running setup and
    // reporting Achilles starts the HSR ramp at week 1 from now, and finishing
    // setup without it clears the clock. Only touched when the answer changes,
    // so re-running the wizard and leaving the complaint on does not restart a
    // protocol the athlete is part-way through.
    const [before] = await db
      .select({ complaints: strengthPlanSettings.complaints })
      .from(strengthPlanSettings)
      .where(profCond(profileId));
    const hadAchilles = (before?.complaints ?? []).includes("achilles");
    const hasAchilles = complaints.includes("achilles");
    const values = {
      ...rest,
      availableDays: [...new Set(data.availableDays)],
      complaints,
      ...(hasAchilles === hadAchilles
        ? {}
        : { achillesStartedAt: hasAchilles ? new Date() : null }),
      blockWeeks: blockWeeks ?? null,
      // A block needs a start; default to today so the athlete's week 1 is
      // the week they set it up.
      blockStartDate: blockWeeks
        ? blockStartDate
          ? new Date(blockStartDate)
          : new Date()
        : null,
    };
    const updated = await db
      .update(strengthPlanSettings)
      .set({ ...values, updatedAt: new Date() })
      .where(profCond(profileId))
      .returning({ id: strengthPlanSettings.id });
    if (updated.length === 0) {
      const inserted = await db
        .insert(strengthPlanSettings)
        .values({ ...values, profileId, userId: currentUserId() })
        .onConflictDoNothing()
        .returning({ id: strengthPlanSettings.id });
      if (inserted.length === 0) {
        await db
          .update(strengthPlanSettings)
          .set({ ...values, updatedAt: new Date() })
          .where(profCond(profileId));
      }
    }

    // Rebuild the upcoming auto schedule from the new preferences. Completed
    // and manually created sessions are never touched.
    await pruneAutoSchedule(profileId, currentUserId());
    const { created } = data.active
      ? await ensureStrengthSchedule(profileId, currentUserId())
      : { created: 0 };

    return Response.json({ ok: true, created });
  } catch (err) {
    console.error("[plan-settings] save failed", err);
    return Response.json({ error: "Failed to save settings" }, { status: 500 });
  }
});

// ── PATCH /api/strength/plan-settings ─────────────────────────────────────────
// Partial update of plan-affecting preferences that live outside the setup
// wizard: the rest-timer length and the reported complaints, both changed from
// Kraft settings. Only touches an EXISTING plan — a no-op if the athlete has no
// strength plan — and reconciles the upcoming schedule so the change reaches
// the app, calendar and watch immediately.
//
// Complaints were previously write-once, set in the setup wizard and never
// exposed again, so an athlete whose injury had healed had no way to stop the
// rehab work it added to every session. Sessions are rebuilt from their
// template on every read, so a change here reshapes everything still planned;
// sessions the athlete has already started keep what they were built with
// (schema.ts strengthSessions.complaints).

const PatchSchema = z
  .object({
    restSeconds: z.number().int().min(15).max(300).nullable().optional(),
    complaints: z.array(z.enum(COMPLAINT_VALUES)).max(COMPLAINT_VALUES.length).optional(),
  })
  .strict()
  .refine((d) => d.restSeconds !== undefined || d.complaints !== undefined, {
    message: "Nothing to update",
  });

export const PATCH = withSession(async (request: NextRequest) => {
  const profileId = await getVerifiedProfileId(request);

  let data: z.infer<typeof PatchSchema>;
  try {
    data = PatchSchema.parse(await request.json());
  } catch (err) {
    return Response.json(
      { error: "Invalid request", details: err instanceof z.ZodError ? err.issues : undefined },
      { status: 400 }
    );
  }

  try {
    const [existing] = await db
      .select({
        id: strengthPlanSettings.id,
        complaints: strengthPlanSettings.complaints,
        achillesStartedAt: strengthPlanSettings.achillesStartedAt,
      })
      .from(strengthPlanSettings)
      .where(profCond(profileId));

    // No plan yet → nothing to update or reconcile; the rest preference will
    // apply once a plan is set up (it is also kept client-side for the guided
    // timer), and complaints are collected by the setup wizard.
    if (!existing) return Response.json({ ok: true, hadPlan: false });

    const values: Partial<typeof strengthPlanSettings.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (data.restSeconds !== undefined) values.restSeconds = data.restSeconds;
    if (data.complaints !== undefined) {
      const next = [...new Set(data.complaints)];
      values.complaints = next;
      // The HSR calf ramp counts weeks from when the Achilles complaint was
      // reported, not from the running plan's week (see complaint-work.ts
      // achillesProgramWeek). Adding the complaint starts that clock; removing
      // it clears it, so re-reporting later restarts the protocol at week 1
      // rather than resuming a ramp on a tendon that has not been loaded since.
      const had = (existing.complaints ?? []).includes("achilles");
      const has = next.includes("achilles");
      if (has && !had) values.achillesStartedAt = new Date();
      if (!has && had) values.achillesStartedAt = null;
    }

    const [updated] = await db
      .update(strengthPlanSettings)
      .set(values)
      .where(profCond(profileId))
      .returning({ active: strengthPlanSettings.active });

    // Prescriptions are derived at read time, so no session rows need
    // rewriting: every still-planned session already reflects the new value on
    // its next read. The calendar event and the watch workout are copies
    // though, so they have to be pushed again.
    if (updated?.active) {
      await ensureStrengthSchedule(profileId, currentUserId());
      // ensureStrengthSchedule only re-pushes a session whose duration
      // estimate changed, which a complaint change can leave identical while
      // the exercise list is completely different.
      if (data.complaints !== undefined) {
        await resyncPlannedStrengthSessions(profileId, currentUserId());
      }
    }

    return Response.json({ ok: true, hadPlan: true });
  } catch (err) {
    console.error("[plan-settings] patch failed", err);
    return Response.json({ error: "Failed to update Kraft settings" }, { status: 500 });
  }
});

// ── DELETE /api/strength/plan-settings ────────────────────────────────────────
// Removes the strength plan, for parity with running (which has DELETE on
// /api/plans/[id]). Strength previously offered only Pause, so a plan could be
// silenced but never actually removed or started fresh.
//
// Logged history is deliberately kept: pruneAutoSchedule only takes future,
// still-planned, auto-scheduled sessions, so completed and hand-edited sessions
// survive — they are training data, and load progression is derived from them.
// It also cleans up the calendar events and watch workouts those rows created.
export const DELETE = withSession(async (request: NextRequest) => {
  const profileId = await getVerifiedProfileId(request);

  try {
    const { removed } = await pruneAutoSchedule(profileId, currentUserId());

    const deleted = await db
      .delete(strengthPlanSettings)
      .where(profCond(profileId))
      .returning({ id: strengthPlanSettings.id });

    if (deleted.length === 0) {
      return Response.json({ error: "No strength plan to remove" }, { status: 404 });
    }

    return Response.json({ ok: true, removedSessions: removed });
  } catch (err) {
    console.error("[plan-settings] delete failed", err);
    return Response.json({ error: "Failed to remove strength plan" }, { status: 500 });
  }
});
