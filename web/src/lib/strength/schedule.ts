import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, strengthPlanSettings, strengthSessions } from "@/db";
import { SESSION_TEMPLATES } from "./program";
import { pickSpreadDays } from "./schedule-days";
import type { StrengthSessionType } from "./types";

// ── Weekly strength scheduler ────────────────────────────────────────────────
// Tops up planned strength sessions for the current + next week from the
// profile's wizard settings. Idempotent: one auto session per day, existing
// sessions (manual or auto) block a slot, and pruning only ever touches
// future auto-scheduled sessions that are still "planned".

const HORIZON_DAYS = 14;

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

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
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

  const today = startOfDay(new Date());
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + HORIZON_DAYS);

  // Existing strength sessions in the window (any status) block their day.
  const existing = await db
    .select({ date: strengthSessions.date })
    .from(strengthSessions)
    .where(
      and(
        gte(strengthSessions.date, today),
        lte(strengthSessions.date, horizon),
        profileId
          ? eq(strengthSessions.profileId, profileId)
          : isNull(strengthSessions.profileId)
      )
    );
  const taken = new Set(existing.map((s) => startOfDay(s.date).getTime()));

  const chosenDays = pickSpreadDays(
    settings.availableDays,
    settings.sessionsPerWeek
  );

  let created = 0;
  // Walk the two Monday-anchored weeks covering the horizon.
  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const day = new Date(today);
    day.setDate(day.getDate() + offset);
    const dow = day.getDay();
    if (!chosenDays.includes(dow)) continue;
    if (taken.has(day.getTime())) continue;

    // Sessions land on the chosen days even when a hard run shares the day —
    // predictable beats clever, and the calendar drag makes moving trivial.
    // Rotation index: the day's position among the chosen days (Mon-based),
    // so a given weekday always hosts the same session type.
    const slotIndex = chosenDays
      .map((d) => (d + 6) % 7) // Monday-based ordering
      .sort((a, b) => a - b)
      .indexOf((dow + 6) % 7);
    const type = rotation[Math.max(0, slotIndex) % rotation.length];
    const template = SESSION_TEMPLATES[type];

    await db.insert(strengthSessions).values({
      profileId,
      date: day,
      dayOfWeek: dow,
      type,
      title: template.title,
      status: "planned",
      targetDurationMinutes: settings.durationMinutes,
      autoScheduled: true,
    });
    taken.add(day.getTime());
    created++;
  }

  return { created };
}

/** Remove future auto-scheduled sessions that are still untouched. */
export async function pruneAutoSchedule(profileId: string | null) {
  const today = startOfDay(new Date());
  const future = await db
    .select({ id: strengthSessions.id })
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
  await db
    .delete(strengthSessions)
    .where(inArray(strengthSessions.id, future.map((s) => s.id)));
  return { removed: future.length };
}
