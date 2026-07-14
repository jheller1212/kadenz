import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, plans, strengthPlanSettings, strengthSessions, workouts } from "@/db";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { SESSION_TEMPLATES } from "./program";
import { placeStrengthWeek, type PlacementDay } from "./schedule-place";
import type { StrengthSessionType } from "./types";

// ── Weekly strength scheduler ────────────────────────────────────────────────
// Tops up planned strength sessions for the next two weeks from the profile's
// wizard settings. Idempotent: one session per calendar day; existing sessions
// (manual or auto) block a slot; pruning only touches future auto-scheduled
// sessions the user never edited (any PATCH clears the auto flag).
//
// Day math runs in the household timezone — the server is UTC and naive
// startOfDay would put late-evening sessions on the wrong calendar day.

const HORIZON_DAYS = 14;
const APP_TZ = "Europe/Amsterdam";

// Session-type rotation per goal and sessions/week. Running focus keeps upper
// body minimal (Benchmark's framing); all-round mixes upper and lower evenly.
const ROTATIONS: Record<string, Record<number, StrengthSessionType[]>> = {
  running_focus: {
    1: ["lower_achilles"],
    2: ["lower_achilles", "full_body"],
    3: ["lower_achilles", "full_body", "achilles"],
    4: ["lower_achilles", "full_body", "achilles", "upper"],
  },
  all_round: {
    1: ["full_body"],
    2: ["upper", "lower"],
    3: ["upper", "lower", "full_body"],
    4: ["upper", "lower", "full_body", "upper_achilles"],
  },
};

/** Calendar-day key ("2026-07-14") of a timestamp in the household TZ. */
function dayKey(d: Date): string {
  return d.toLocaleDateString("en-CA", { timeZone: APP_TZ });
}

/** 0=Sun … 6=Sat of a timestamp in the household TZ. */
function dowInTz(d: Date): number {
  const name = d.toLocaleDateString("en-US", { timeZone: APP_TZ, weekday: "short" });
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(name);
}

export async function ensureStrengthSchedule(profileId: string | null) {
  const [settings] = await db
    .select()
    .from(strengthPlanSettings)
    .where(
      profileId
        ? eq(strengthPlanSettings.profileId, profileId)
        : isNull(strengthPlanSettings.profileId)
    );
  if (!settings || !settings.active) return { created: 0 };

  const rotation =
    ROTATIONS[settings.goal]?.[settings.sessionsPerWeek] ??
    ROTATIONS.running_focus[2];

  // Anchor at noon UTC — a timestamp whose calendar day is identical in UTC
  // and any European timezone, so stored dates can't drift across midnight.
  const now = new Date();
  const anchor = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0
  ));
  const horizon = new Date(anchor);
  horizon.setUTCDate(horizon.getUTCDate() + HORIZON_DAYS + 1);
  const windowStart = new Date(anchor);
  windowStart.setUTCDate(windowStart.getUTCDate() - 1); // TZ slack

  // Existing sessions in the window (any status) block their calendar day.
  const existing = await db
    .select({ date: strengthSessions.date })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, windowStart),
        lte(strengthSessions.date, horizon),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  const taken = new Set(existing.map((s) => dayKey(s.date)));

  // Run schedule in the window (owner's active plan) — the placement engine
  // keeps heavy leg work off hard-run days and the day before.
  const runByDay = new Map<string, string>();
  if (!profileId) {
    const runs = await db
      .select({ date: workouts.date, type: workouts.type })
      .from(workouts)
      .innerJoin(plans, eq(workouts.planId, plans.id))
      .where(
        and(
          eq(plans.status, "active"),
          gte(workouts.date, windowStart),
          lte(workouts.date, horizon)
        )
      );
    for (const r of runs) {
      if (r.type !== "rest") runByDay.set(dayKey(r.date), r.type);
    }
  }

  const rotation2 = rotation; // rotation per week
  const gcal = !profileId ? await isConnected().catch(() => false) : false;

  // Build the day strip (tomorrow → horizon) and cut it into Monday weeks.
  const strip: Array<PlacementDay & { date: Date }> = [];
  for (let offset = 1; offset <= HORIZON_DAYS; offset++) {
    const day = new Date(anchor);
    day.setUTCDate(day.getUTCDate() + offset);
    const key = dayKey(day);
    const nextDay = new Date(day);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    strip.push({
      key,
      date: day,
      dow: dowInTz(day),
      runType: runByDay.get(key) ?? null,
      nextDayRunType: runByDay.get(dayKey(nextDay)) ?? null,
      taken: taken.has(key),
    });
  }
  const weeks: Array<Array<PlacementDay & { date: Date }>> = [];
  let current: Array<PlacementDay & { date: Date }> = [];
  for (const d of strip) {
    if (d.dow === 1 && current.length > 0) {
      weeks.push(current);
      current = [];
    }
    current.push(d);
  }
  if (current.length > 0) weeks.push(current);

  let created = 0;
  for (const week of weeks) {
    // A partial leading week may already hold this week's earlier sessions —
    // count them so we only top up the remainder of the rotation.
    const alreadyThisWeek = week.filter((d) => d.taken).length;
    const remaining = rotation2.slice(
      Math.min(alreadyThisWeek, rotation2.length)
    );
    if (remaining.length === 0) continue;

    const placements = placeStrengthWeek(week, settings.availableDays, remaining);
    for (const placement of placements) {
      const day = week.find((d) => d.key === placement.key)!;
      const template = SESSION_TEMPLATES[placement.type];
      const [row] = await db
        .insert(strengthSessions)
        .values({
          profileId,
          date: day.date,
          dayOfWeek: day.dow,
          type: placement.type,
          title: template.title,
          status: "planned",
          targetDurationMinutes: settings.durationMinutes,
          autoScheduled: true,
        })
        .onConflictDoNothing()
        .returning({ id: strengthSessions.id });
      if (row) {
        created++;
        if (gcal) {
          queueStrengthSessionSync(row.id, "create", "gcal").catch(() => {});
        }
      }
    }
  }

    return { created };
}

/** Remove future auto-scheduled sessions the user never touched. */
export async function pruneAutoSchedule(profileId: string | null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const future = await db
    .select({
      id: strengthSessions.id,
      gcalEventId: strengthSessions.gcalEventId,
    })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, today),
        eq(strengthSessions.autoScheduled, true),
        eq(strengthSessions.status, "planned"),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  if (future.length === 0) return { removed: 0 };

  // Calendar events must go with their rows or they linger forever.
  for (const s of future) {
    if (s.gcalEventId) {
      await queueStrengthSessionSync(s.id, "delete", "gcal", {
        gcalEventId: s.gcalEventId,
      }).catch(() => {});
    }
  }

  await db
    .delete(strengthSessions)
    .where(inArray(strengthSessions.id, future.map((s) => s.id)));
  return { removed: future.length };
}
