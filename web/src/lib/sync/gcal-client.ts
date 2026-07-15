import { google } from "googleapis";
import { db, syncOutbox } from "@/db";
import { eq } from "drizzle-orm";
import { formatLoad } from "@/lib/strength/weights";

// ── Token storage (in DB via sync_outbox with special entity) ────────────────

const TOKEN_ENTITY_TYPE = "plan" as const; // reuse existing enum value
const TOKEN_ENTITY_ID = "00000000-0000-0000-0000-000000000000";
const TOKEN_IDEM_KEY = "gcal:tokens:singleton";

export interface GCalTokens {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
}

export async function loadTokens(): Promise<GCalTokens | null> {
  try {
    const [row] = await db
      .select({ payload: syncOutbox.payload })
      .from(syncOutbox)
      .where(eq(syncOutbox.idempotencyKey, TOKEN_IDEM_KEY))
      .limit(1);

    if (!row?.payload) return null;
    return row.payload as unknown as GCalTokens;
  } catch {
    return null;
  }
}

export async function saveTokens(tokens: GCalTokens): Promise<void> {
  await db
    .insert(syncOutbox)
    .values({
      entityType: TOKEN_ENTITY_TYPE,
      entityId: TOKEN_ENTITY_ID,
      action: "update",
      target: "gcal",
      status: "completed",
      idempotencyKey: TOKEN_IDEM_KEY,
      payload: tokens as unknown as Record<string, unknown>,
      attempts: 0,
    })
    .onConflictDoUpdate({
      target: syncOutbox.idempotencyKey,
      set: { payload: tokens as unknown as Record<string, unknown> },
    });
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

export async function getAuthClient() {
  const tokens = await loadTokens();
  if (!tokens) return null;
  const auth = createOAuth2Client();
  auth.setCredentials(tokens);
  // Persist refreshed tokens automatically
  auth.on("tokens", (newTokens) => {
    const merged: GCalTokens = {
      access_token: newTokens.access_token ?? tokens.access_token,
      refresh_token: newTokens.refresh_token ?? tokens.refresh_token,
      expiry_date: newTokens.expiry_date ?? tokens.expiry_date,
    };
    saveTokens(merged).catch((err) => {
      console.error("Failed to persist refreshed gcal tokens:", err);
    });
  });
  return auth;
}

export async function isConnected(): Promise<boolean> {
  return (await loadTokens()) !== null;
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
  description?: string | null;
  date: Date;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
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

function formatPaceSec(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = secPerKm % 60;
  return `${min}:${sec.toString().padStart(2, "0")} /km`;
}

function buildEventDescription(workout: WorkoutEventInput): string {
  const lines: string[] = [];

  if (workout.targetKm) {
    lines.push(`Distance: ${workout.targetKm.toFixed(1)} km`);
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
        parts.push(`${block.distanceKm.toFixed(1)} km`);
      } else if (block.durationMinutes) {
        parts.push(`${block.durationMinutes} min`);
      }
      if (block.targetPaceSecKm) {
        parts.push(`@ ${formatPaceSec(block.targetPaceSecKm)}`);
      }
      lines.push(parts.join(" "));
    }
  }

  lines.push("", "— Kadenz");
  return lines.join("\n");
}

function buildEventTimes(date: Date, durationMinutes?: number | null) {
  // Default to 7:00 AM start, 1 hour if no duration
  const start = new Date(date);
  start.setHours(7, 0, 0, 0);

  const end = new Date(start);
  end.setMinutes(end.getMinutes() + (durationMinutes ?? 60));

  return {
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
  };
}

// ── Calendar event CRUD ───────────────────────────────────────────────────────

export async function createEvent(workout: WorkoutEventInput): Promise<string> {
  const auth = await getAuthClient();
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });
  const times = buildEventTimes(workout.date, workout.targetDurationMinutes);

  const res = await cal.events.insert({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    requestBody: {
      summary: workout.title,
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
  gcalEventId: string,
  workout: Partial<WorkoutEventInput> & { workoutId: string }
): Promise<void> {
  const auth = await getAuthClient();
  if (!auth) throw new Error("Google Calendar not connected");

  const cal = google.calendar({ version: "v3", auth });

  const body: Record<string, unknown> = {};
  if (workout.title) body.summary = workout.title;
  if (workout.description !== undefined || workout.blocks !== undefined) {
    body.description = buildEventDescription(workout as WorkoutEventInput);
  }
  if (workout.date) {
    Object.assign(
      body,
      buildEventTimes(workout.date, workout.targetDurationMinutes)
    );
  }

  await cal.events.patch({
    calendarId: process.env.GOOGLE_CALENDAR_ID ?? "primary",
    eventId: gcalEventId,
    requestBody: body,
  });
}

export async function deleteEvent(gcalEventId: string): Promise<void> {
  const auth = await getAuthClient();
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
          ? ` @ ${formatLoad(ex.suggestedWeightKg, { dumbbells: ex.dumbbells, holdNote: ex.holdNote, perSide: ex.perSide })}`
          : "";
      lines.push(`  • ${ex.name} — ${ex.prescription}${load}`);
    }
  }
  lines.push("", "— Kadenz · Kraft");
  return lines.join("\n");
}

export async function createStrengthEvent(
  session: StrengthEventInput
): Promise<string> {
  const auth = await getAuthClient();
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
  gcalEventId: string,
  session: StrengthEventInput
): Promise<void> {
  const auth = await getAuthClient();
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
