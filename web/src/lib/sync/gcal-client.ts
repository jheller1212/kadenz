import { google } from "googleapis";
import { formatLoad } from "@/lib/strength/weights";
import { displayWorkoutTitle } from "@/lib/plan-engine/workout-title";
import { displayDistance, displayPace, distanceUnitLabel, paceUnitLabel } from "@/lib/units";
import type { DistanceUnit, WeightUnit } from "@/lib/user-units";
import { loadCredentials, saveCredentials } from "@/lib/sync/credentials";

// ── Token storage ─────────────────────────────────────────────────────────────
// Per-user, via lib/sync/credentials.ts. Before Phase 4 these lived in one
// sync_outbox row shared by the whole installation, so the second person to
// connect Google overwrote the first person's tokens. See credentials.ts for
// the full story.

export interface GCalTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export async function loadTokens(userId: string): Promise<GCalTokens | null> {
  return loadCredentials<GCalTokens>(userId, "google");
}

export async function saveTokens(userId: string, tokens: GCalTokens): Promise<void> {
  await saveCredentials(userId, "google", tokens as unknown as Record<string, unknown>);
}

// ── OAuth2 client factory ─────────────────────────────────────────────────────

export function createOAuth2Client() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set");
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    `${process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000"}/api/auth/google/callback`
  );
}

export async function getAuthClient(userId: string) {
  const tokens = await loadTokens(userId);
  if (!tokens) return null;
  const auth = createOAuth2Client();
  auth.setCredentials(tokens);
  // Persist refreshed tokens automatically, against the SAME userId this
  // client was built for. `userId` is captured by this closure, not read
  // again later, so a refresh can never land on the wrong person's row even
  // if another user's client is created concurrently.
  auth.on("tokens", (newTokens) => {
    const merged: GCalTokens = {
      access_token: newTokens.access_token ?? tokens.access_token,
      refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
      expiry_date: newTokens.expiry_date ?? tokens.expiry_date,
    };
    saveTokens(userId, merged).catch((err) => {
      console.error("Failed to persist refreshed gcal tokens:", err);
    });
  });
  return auth;
}

export async function isConnected(userId: string): Promise<boolean> {
  return (await loadTokens(userId)) !== null;
}

// ── Workout → Calendar event mapping ─────────────────────────────────────────

// Color IDs per Google Calendar API (1-11)
const WORKOUT_COLORS: Record<string, string> = {
  easy: "2",      // Sage (green)
  long: "5",      // Banana (yellow)
  tempo: "6",     // Tangerine (orange)
  interval: "11", // Tomato (red)
  recovery: "1",  // Lavender (blue-grey)
  race: "4",      // Flamingo (pink)
  rest: "8",      // Graphite (grey)
};

export interface WorkoutEventInput {
  workoutId: string;
  title: string;
  /**
   * The owner's distance unit (users.distance_unit). Optional so a caller
   * that has not resolved it yet still compiles; absent means km, which is
   * both the storage unit and the default preference.
   */
  distanceUnit?: DistanceUnit;
  description?: string | null;
  date: Date;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
  // "HH:mm" 24h local, or null/undefined for "no specific time" — in which
  // case the event still gets a time (the 7 AM default below), it's just not
  // one the athlete chose.
  timeOfDay?: string | null;
  type: string;
  blocks?: Array<{
    type: string;
    durationMinutes?: number | null;
    distanceKm?: number | null;
    targetPaceSecKm?: number | null;
    reps?: number | null;
    repDistanceKm?: number | null;
  }>;
}

// Pace is stored per km. Converting to the athlete's unit means converting
// the number AND the label together, so both come from the same `unit`.
function formatPaceSec(secPerKm: number, unit?: DistanceUnit): string {
  const perUnit = Math.round(displayPace(secPerKm, unit));
  const min = Math.floor(perUnit / 60);
  const sec = perUnit % 60;
  return `${min}:${sec.toString().padStart(2, "0")} ${paceUnitLabel(unit)}`;
}

function buildEventDescription(workout: WorkoutEventInput): string {
  const lines: string[] = [];
  // Distances and paces are stored in km and converted here, the same way
  // every in-app screen converts them. Before this, a miles athlete's
  // calendar was the one place in Kadenz still quoting km.
  const unit = workout.distanceUnit;
  const unitLabel = distanceUnitLabel(unit);

  if (workout.targetKm) {
    lines.push(`Distance: ${displayDistance(workout.targetKm, 1, unit).toFixed(1)} ${unitLabel}`);
  }
  if (workout.targetDurationMinutes) {
    lines.push(`Duration: ~${workout.targetDurationMinutes} min`);
  }

  if (workout.description) {
    lines.push("", workout.description);
  }

  if (workout.blocks && workout.blocks.length > 0) {
    lines.push("", "Structure:");
    for (const block of workout.blocks) {
      const parts: string[] = [`  [${block.type}]`];
      if (block.reps && block.repDistanceKm) {
        parts.push(
          `${block.reps}x ${(block.repDistanceKm * 1000).toFixed(0)}m`
        );
      } else if (block.distanceKm) {
        parts.push(`${displayDistance(block.distanceKm, 1, unit).toFixed(1)} ${unitLabel}`);
      } else if (block.durationMinutes) {
        parts.push(`${block.durationMinutes} min`);
      }
      if (block.targetPaceSecKm) {
        parts.push(`@ ${formatPaceSec(block.targetPaceSecKm, unit)}`);
      }
      lines.push(parts.join(" "));
    }
  }

  lines.push("", "Kadenz");
  return lines.join("\n");
}

function buildEventTimes(date: Date, durationMinutes?: number | null, timeOfDay?: string | null) {
  // Default to 7:00 AM start, 1 hour if no duration. An explicit timeOfDay
  // ("HH:mm") overrides the default hour/minute.
  const start = new Date(date);
  const match = timeOfDay?.match(/^(\d{2}):(\d{2})$/);
  if (match) {
    start.setHours(Number(match[1]), Number(match[2]), 0, 0);
  } else {
    start.setHours(7, 0, 0, 0);
  }

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + (durationMinutes ?? 60));

  return {
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

// The stored title is always written in km at generation time, so it is
// rebuilt here from the workout's numeric fields in the athlete's own unit,
// exactly as every in-app screen does. Interval and race titles come back
// unchanged: they are in meters and in race-distance labels respectively,
// neither of which converts.
function eventSummary(workout: WorkoutEventInput): string {
  return displayWorkoutTitle(workout, workout.distanceUnit);
}

// ── Calendar event CRUD ───────────────────────────────────────────────────────

export async function createEvent(userId: string, workout: WorkoutEventInput): Promise<string> {
  const auth = await getAuthClient(userId);
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });
  const times = buildEventTimes(workout.date, workout.targetDurationMinutes, workout.timeOfDay);

  const res = await cal.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    requestBody: {
      summary: eventSummary(workout),
      description: buildEventDescription(workout),
      colorId: WORKOUT_COLORS[workout.type] ?? "0",
      ...times,
      extendedProperties: {
        private: { kadenzWorkoutId: workout.workoutId },
      },
    },
  });

  if (!res.data.id) throw new Error("Google Calendar returned no event ID");
  return res.data.id;
}

export async function patchEvent(
  userId: string,
  gcalEventId: string,
  workout: Partial<WorkoutEventInput> & { workoutId: string }
): Promise<void> {
  const auth = await getAuthClient(userId);
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });

  const body: Record<string, unknown> = {};
  if (workout.title) body.summary = eventSummary(workout as WorkoutEventInput);
  if (workout.description !== undefined || workout.blocks !== undefined) {
    body.description = buildEventDescription(workout as WorkoutEventInput);
  }
  if (workout.date) {
    Object.assign(
      body,
      buildEventTimes(workout.date, workout.targetDurationMinutes, workout.timeOfDay)
    );
  }

  await cal.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    eventId: gcalEventId,
    requestBody: body,
  });
}

export async function deleteEvent(userId: string, gcalEventId: string): Promise<void> {
  const auth = await getAuthClient(userId);
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });
  await cal.events.delete({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    eventId: gcalEventId,
  });
}

// ── Strength session → Calendar event mapping ────────────────────────────────

// Strength sessions get their own colour band, distinct from run workouts.
const STRENGTH_COLORS: Record<string, string> = {
  upper: "9", // Blueberry
  lower: "3", // Grape
  lower_achilles: "6", // Tangerine
};

export interface StrengthEventInput {
  sessionId: string;
  title: string;
  /**
   * The owner's weight unit (users.weight_unit). The description lists every
   * exercise's load, so without this a lbs athlete reads their calendar in
   * kg. Absent means kg, which is both the storage unit and the default.
   */
  weightUnit?: WeightUnit;
  date: Date;
  type: string;
  targetDurationMinutes?: number | null;
  exercises?: Array<{
    name: string;
    prescription: string;
    suggestedWeightKg?: number | null;
    perSide?: boolean;
    dumbbells?: 1 | 2;
    holdNote?: string;
  }>;
}

function buildStrengthDescription(session: StrengthEventInput): string {
  const lines: string[] = [];
  if (session.targetDurationMinutes) {
    lines.push(`Duration: ~${session.targetDurationMinutes} min`);
  }
  if (session.exercises && session.exercises.length > 0) {
    lines.push("", "Exercises:");
    for (const ex of session.exercises) {
      const load =
        ex.suggestedWeightKg != null
          ? ` @ ${formatLoad(ex.suggestedWeightKg, {
              dumbbells: ex.dumbbells,
              holdNote: ex.holdNote,
              perSide: ex.perSide,
              // Explicit: this runs in the cron, where formatLoad's own
              // localStorage lookup would silently answer kg for everyone.
              unit: session.weightUnit,
            })}`
          : "";
      lines.push(`  • ${ex.name} · ${ex.prescription}${load}`);
    }
  }
  lines.push("", "Kadenz · Kraft");
  return lines.join("\n");
}

export async function createStrengthEvent(
  userId: string,
  session: StrengthEventInput
): Promise<string> {
  const auth = await getAuthClient(userId);
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });
  const times = buildEventTimes(session.date, session.targetDurationMinutes);

  const res = await cal.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    requestBody: {
      summary: session.title,
      description: buildStrengthDescription(session),
      colorId: STRENGTH_COLORS[session.type] ?? "8",
      ...times,
      extendedProperties: {
        private: { kadenzStrengthSessionId: session.sessionId },
      },
    },
  });

  if (!res.data.id) throw new Error("Google Calendar returned no event ID");
  return res.data.id;
}

export async function patchStrengthEvent(
  userId: string,
  gcalEventId: string,
  session: StrengthEventInput
): Promise<void> {
  const auth = await getAuthClient(userId);
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });
  await cal.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    eventId: gcalEventId,
    requestBody: {
      summary: session.title,
      description: buildStrengthDescription(session),
      ...buildEventTimes(session.date, session.targetDurationMinutes),
    },
  });
}
