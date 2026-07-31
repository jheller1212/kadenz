// ── Server-side lookup backing the week-complete / peak-week celebrations ────
// Pure decision logic lives in celebrations.ts; this just fetches the rows it
// needs (the week's phase/skippedAt and every sibling workout's real status)
// so both workout-completion routes (plain complete, GPS record) can call one
// thing instead of duplicating the query.

import { and, eq } from "drizzle-orm";
import { db, weeks, workouts } from "@/db";
import { ownedBy } from "@/lib/api/owned";
import { weekMilestoneFor, type WeekMilestone } from "./celebrations";

export async function weekMilestoneForCompletedWorkout(weekId: string): Promise<WeekMilestone> {
  const [week] = await db
    .select({ phase: weeks.phase, skippedAt: weeks.skippedAt })
    .from(weeks)
    .where(and(eq(weeks.id, weekId), ownedBy(weeks)));
  if (!week) return null;

  const siblingWorkouts = await db
    .select({ type: workouts.type, status: workouts.status })
    .from(workouts)
    .where(and(eq(workouts.weekId, weekId), ownedBy(workouts)));

  return weekMilestoneFor(week.phase, week.skippedAt, siblingWorkouts);
}
