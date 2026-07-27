// DB/push I/O side of workout reminders — called from the cron route. The
// actual "is this due" decision lives in due.ts (pure, unit-tested); this
// module fetches candidates, sends, and persists the send so re-runs are
// no-ops.

import { and, eq, gte, lte } from "drizzle-orm";
import { db, workouts, sentReminders } from "@/db";
import { localDayKey } from "@/lib/app-time";
import { selectDueReminders, type ReminderCandidate } from "./due";
import { loadReminderConfig } from "./settings";
import { listSubscriptions, removeExpiredSubscriptions } from "./subscriptions";
import { sendPush } from "./push";

// Generous padding either side of "now" so any workout that could plausibly
// be within its reminder window today gets fetched, regardless of how far
// UTC and the athlete's local calendar day have drifted apart.
const WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export interface DispatchResult {
  enabled: boolean;
  checked: number;
  sent: number;
  skippedNoSubscription: number;
  errors: number;
}

export async function dispatchDueReminders(now: Date = new Date()): Promise<DispatchResult> {
  const config = await loadReminderConfig();
  if (!config.enabled) {
    return { enabled: false, checked: 0, sent: 0, skippedNoSubscription: 0, errors: 0 };
  }

  const windowStart = new Date(now.getTime() - WINDOW_MS);
  const windowEnd = new Date(now.getTime() + WINDOW_MS);

  const rows = await db
    .select({
      id: workouts.id,
      title: workouts.title,
      date: workouts.date,
      timeOfDay: workouts.timeOfDay,
      status: workouts.status,
    })
    .from(workouts)
    .where(
      and(eq(workouts.status, "planned"), gte(workouts.date, windowStart), lte(workouts.date, windowEnd))
    );

  const candidates: ReminderCandidate[] = rows.map((r) => ({
    workoutId: r.id,
    dateKey: localDayKey(r.date),
    timeOfDay: r.timeOfDay,
    status: r.status,
  }));
  const titleById = new Map(rows.map((r) => [r.id, r.title]));

  // `alreadySent` is an empty set here on purpose — the real idempotency
  // guard is the unique-workout_id claim below, which is safe even against
  // two overlapping cron invocations. This pre-filter only exists so
  // selectDueReminders' contract stays honest for callers that DO have a
  // cheap already-sent set on hand (see due.test.ts).
  const due = selectDueReminders(now, candidates, config, new Set());

  if (due.length === 0) {
    return { enabled: true, checked: candidates.length, sent: 0, skippedNoSubscription: 0, errors: 0 };
  }

  const subscriptions = await listSubscriptions();
  let sent = 0;
  let skippedNoSubscription = 0;
  let errors = 0;
  const deadEndpoints = new Set<string>();

  for (const reminder of due) {
    if (subscriptions.length === 0) {
      // Nothing to deliver to — deliberately don't claim the workout, so a
      // subscription added later in the same window can still catch it.
      skippedNoSubscription += 1;
      continue;
    }

    // Claim first. The unique constraint on sent_reminders.workout_id means
    // a second cron run (or an overlapping invocation) racing this one gets
    // zero rows back and simply moves on — never a second push.
    const claimed = await db
      .insert(sentReminders)
      .values({ workoutId: reminder.workoutId })
      .onConflictDoNothing()
      .returning({ id: sentReminders.id });
    if (claimed.length === 0) continue;

    const payload = {
      title: "Workout reminder",
      body: `${titleById.get(reminder.workoutId) ?? "Your workout"} is coming up`,
      url: "/",
    };

    let anySucceeded = false;
    for (const sub of subscriptions) {
      const result = await sendPush(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      );
      if (result.ok) anySucceeded = true;
      else if (result.expired) deadEndpoints.add(sub.endpoint);
      else errors += 1;
    }
    if (anySucceeded) sent += 1;
    else errors += 1;
  }

  if (deadEndpoints.size > 0) {
    await removeExpiredSubscriptions([...deadEndpoints]);
  }

  return { enabled: true, checked: candidates.length, sent, skippedNoSubscription, errors };
}
