import { and, eq, gte, inArray, isNull, lte } from "drizzle-orm";
import { db, strengthPlanSettings, strengthSessions } from "@/db";
import { queueStrengthSessionSync } from "@/lib/sync/sync-manager";
import { isConnected } from "@/lib/sync/gcal-client";
import { SESSION_TEMPLATES } from "./program";
import { pickSpreadDays } from "./schedule-days";
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

  const chosenDays = pickSpreadDays(
    settings.availableDays,
    settings.sessionsPerWeek
  );
  const chosenOrdered = chosenDays
    .map((d) => (d + 6) % 7) // Monday-based ordering
    .sort((a, b) => a - b);

  const gcal = !profileId ? await isConnected().catch(() => false) : false;

  let created = 0;
  // Start tomorrow — a session scheduled onto a nearly-over day is instantly
  // "missed", which is worse than starting the plan a day later.
  for (let offset = 1; offset <= HORIZON_DAYS; offset++) {
    const day = new Date(anchor);
    day.setUTCDate(day.getUTCDate() + offset);
    const dow = dowInTz(day);
    if (!chosenDays.includes(dow)) continue;
    if (taken.has(dayKey(day))) continue;

    // The day's position among the chosen days (Mon-based) fixes its session
    // type, so a given weekday always hosts the same workout.
    const slotIndex = chosenOrdered.indexOf((dow + 6) % 7);
    const type = rotation[slotIndex % rotation.length];
    const template = SESSION_TEMPLATES[type];

    const [row] = await db
      .insert(strengthSessions)
      .values({
        profileId,
        date: day,
        dayOfWeek: dow,
        type,
        title: template.title,
        status: "planned",
        targetDurationMinutes: settings.durationMinutes,
        autoScheduled: true,
      })
      .onConflictDoNothing()
      .returning({ id: strengthSessions.id });

    taken.add(dayKey(day));
    if (row) {
      created++;
      if (gcal) {
        queueStrengthSessionSync(row.id, "create", "gcal").catch(() => {});
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
