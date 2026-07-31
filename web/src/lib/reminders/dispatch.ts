// DB/push I/O side of workout reminders — called from the cron route. The
// actual "is this due" decision lives in due.ts (pure, unit-tested); this
// module fetches candidates, sends, and persists the outcome. A workout is
// claimed (sent_reminders row) before the push attempt so two overlapping
// cron runs never send twice, but the claim now records success/failure —
// see retry.ts for the pure "should this claim be retried" rule — so a
// transient push failure gets another attempt on a later run instead of
// permanently swallowing the reminder.

import { and, eq, inArray } from "drizzle-orm";
import type { UserId } from "@/lib/user-id";
import { db, sentReminders } from "@/db";
import { localDayKey } from "@/lib/app-time";
import { displayWorkoutTitle } from "@/lib/plan-engine/workout-title";
import { loadUserUnits } from "@/lib/user-units";
import { selectDueReminders, type ReminderCandidate } from "./due";
import { isRetryEligible, type SentReminderRow } from "./retry";
import { listEnabledReminderConfigs, type ReminderConfig } from "./settings";
import { listSubscriptions, removeExpiredSubscriptions } from "./subscriptions";
import { sendPush } from "./push";

// Generous padding either side of "now" so any workout that could plausibly
// be within its reminder window today gets fetched, regardless of how far
// UTC and the athlete's local calendar day have drifted apart.
const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export interface DispatchResult {
  /** True if at least one user has reminders switched on. */
  enabled: boolean;
  /** How many users this run dispatched for. */
  users: number;
  checked: number;
  sent: number;
  skippedNoSubscription: number;
  errors: number;
}

/**
 * Sends every due reminder, one user at a time.
 *
 * The per-user loop is the whole point. This used to read one settings row,
 * every planned workout and every push subscription in the database with no
 * owner filter anywhere, so with two athletes signed up, each of them would
 * have received a push for the other's workouts.
 */
export async function dispatchDueReminders(now: Date = new Date()): Promise<DispatchResult> {
  const enabledUsers = await listEnabledReminderConfigs();

  const total: DispatchResult = {
    enabled: enabledUsers.length > 0,
    users: enabledUsers.length,
    checked: 0,
    sent: 0,
    skippedNoSubscription: 0,
    errors: 0,
  };

  // Collected across users and deleted once at the end. An endpoint the push
  // service reports as gone is gone for everyone, and one DELETE beats one
  // per athlete.
  const deadEndpoints = new Set<string>();

  for (const { userId, config } of enabledUsers) {
    // One athlete's push provider being down must not stop the others from
    // getting their reminders, so a failure is counted and the loop goes on.
    try {
      const result = await dispatchForUser(userId, config, now, deadEndpoints);
      total.checked += result.checked;
      total.sent += result.sent;
      total.skippedNoSubscription += result.skippedNoSubscription;
      total.errors += result.errors;
    } catch (err) {
      console.error(`Reminder dispatch failed for user ${userId}:`, err);
      total.errors += 1;
    }
  }

  if (deadEndpoints.size > 0) {
    await removeExpiredSubscriptions([...deadEndpoints]);
  }

  return total;
}

type UserDispatchResult = Omit<DispatchResult, "enabled" | "users">;

async function dispatchForUser(
  userId: UserId,
  config: ReminderConfig,
  now: Date,
  deadEndpoints: Set<string>
): Promise<UserDispatchResult> {
  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_MS);

  // type/targetKm and the work block come along because the notification body
  // rebuilds the title in the athlete's own unit (displayWorkoutTitle), and
  // tempo runs carry their distance on the block rather than the workout.
  const rows = await db.query.workouts.findMany({
    where: (w, { and: andW, eq: eqW, gte: gteW, lte: lteW }) =>
      andW(
        eqW(w.userId, userId),
        eqW(w.status, "planned"),
        gteW(w.date, windowStart),
        lteW(w.date, windowEnd)
      ),
    columns: {
      id: true,
      title: true,
      date: true,
      timeOfDay: true,
      status: true,
      type: true,
      targetKm: true,
    },
    with: { blocks: { columns: { type: true, distanceKm: true } } },
  });

  const candidates: ReminderCandidate[] = rows.map((r) => ({
    workoutId: r.id,
    dateKey: localDayKey(r.date),
    timeOfDay: r.timeOfDay,
    status: r.status,
  }));

  // A miles athlete used to get "Easy Run 8km is coming up" because the push
  // body used the stored title, which is always written in km.
  const { distanceUnit } = await loadUserUnits(userId);
  const titleById = new Map(
    rows.map((r) => [r.id, displayWorkoutTitle(r, distanceUnit)])
  );

  // `alreadySent` is an empty set here on purpose — the real idempotency
  // guard is the unique-workout_id claim below, which is safe even against
  // two overlapping cron invocations. This pre-filter only exists so
  // selectDueReminders' contract stays honest for callers that DO have a
  // cheap already-sent set on hand (see due.test.ts).
  const due = selectDueReminders(now, candidates, config, new Set());

  if (due.length === 0) {
    return { checked: candidates.length, sent: 0, skippedNoSubscription: 0, errors: 0 };
  }

  // This athlete's own devices. Anything wider here is a notification sent to
  // a stranger.
  const subscriptions = await listSubscriptions(userId);
  let sent = 0;
  let skippedNoSubscription = 0;
  let errors = 0;

  // Existing claims for these workouts, so a prior transient failure can be
  // told apart from "never attempted" without racing the claim itself.
  //
  // No user filter, on purpose: the workout ids come from the owner-scoped
  // query above, so they are already this athlete's. Filtering on user_id as
  // well would hide a claim whose owner disagreed with its workout's, and a
  // hidden claim reads as "never attempted", which is the one state that can
  // send a second push.
  const existingRows =
    due.length === 0
      ? []
      : await db
          .select({
            workoutId: sentReminders.workoutId,
            status: sentReminders.status,
            attempts: sentReminders.attempts,
            lastAttemptAt: sentReminders.lastAttemptAt,
          })
          .from(sentReminders)
          .where(
            inArray(
              sentReminders.workoutId,
              due.map((d) => d.workoutId)
            )
          );
  const existingByWorkoutId = new Map(existingRows.map((r) => [r.workoutId, r]));

  for (const reminder of due) {
    if (subscriptions.length === 0) {
      // Nothing to deliver to — deliberately don't claim (or re-claim) the
      // workout, so a subscription added later in the same window can still
      // catch it, and a claimed-but-failed row keeps its attempt count
      // untouched instead of burning through the cap for nothing.
      skippedNoSubscription += 1;
      continue;
    }

    const existing = existingRows.length > 0 ? existingByWorkoutId.get(reminder.workoutId) : undefined;

    let claimedId: string | undefined;
    if (!existing) {
      // First attempt. The unique constraint on sent_reminders.workout_id
      // means a second cron run (or an overlapping invocation) racing this
      // one gets zero rows back and simply moves on — never a second push.
      const claimed = await db
        .insert(sentReminders)
        .values({ workoutId: reminder.workoutId, userId, status: "pending", attempts: 1 })
        .onConflictDoNothing()
        .returning({ id: sentReminders.id });
      if (claimed.length === 0) continue;
      claimedId = claimed[0].id;
    } else {
      const row: SentReminderRow = existing;
      if (!isRetryEligible(row, now, reminder.scheduledAt)) continue;
      // Re-claim atomically: flip status to "pending" conditioned on the
      // state we just read still holding. A racing run's UPDATE matches
      // zero rows once this one lands, so only one process ever sends.
      const reclaimed = await db
        .update(sentReminders)
        .set({ status: "pending", attempts: row.attempts + 1, lastAttemptAt: now })
        .where(
          and(
            eq(sentReminders.workoutId, reminder.workoutId),
            eq(sentReminders.status, row.status),
            eq(sentReminders.attempts, row.attempts)
          )
        )
        .returning({ id: sentReminders.id });
      if (reclaimed.length === 0) continue;
      claimedId = reclaimed[0].id;
    }

    const payload = {
      title: "Workout reminder",
      body: `${titleById.get(reminder.workoutId) ?? "Your workout"} is coming up`,
      url: "/",
    };

    let anySucceeded = false;
    let anyTransientError = false;
    for (const sub of subscriptions) {
      const result = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      if (result.ok) anySucceeded = true;
      else if (result.expired) deadEndpoints.add(sub.endpoint);
      else {
        anyTransientError = true;
        errors += 1;
      }
    }

    // Reached at least one device: done, forever — a stale desktop
    // subscription failing must never cause a resend to a phone that
    // already got the notification.
    const finalStatus = anySucceeded ? "sent" : anyTransientError ? "failed" : "permanent";
    await db
      .update(sentReminders)
      .set({ status: finalStatus, lastAttemptAt: now })
      .where(eq(sentReminders.id, claimedId!));

    if (anySucceeded) sent += 1;
    else if (!anyTransientError) errors += 1; // permanent: every subscription was expired
  }

  return { checked: candidates.length, sent, skippedNoSubscription, errors };
}
