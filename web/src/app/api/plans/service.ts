import { db } from "@/db";

// ── Shared plan-by-id query ─────────────────────────────────────────────────
// Pulled out of [id]/route.ts so /api/today/bootstrap can fetch the same
// shape without a second copy of the query drifting from the route's.
// Ownership is the caller's job (requireOwned in the route; the bootstrap
// endpoint only ever calls this with a plan id it already read off its own
// active-plan row).
//
// ?summary=1 drops every workout's blocks (warmup/work/cooldown/rep detail) —
// the bulk of the payload (~101KB full vs ~a few KB summary). Stats only ever
// reads week.targetKm and workout.date/type/status for its distribution maths,
// never block detail, so it asks for the summary. Today's week sheet and
// plan/rearrange genuinely need every block and still get the full shape.

export async function getPlanById(id: string, opts?: { summary?: boolean }) {
  const plan = opts?.summary
    ? await db.query.plans.findFirst({
        where: (p, { eq }) => eq(p.id, id),
        with: {
          weeks: {
            orderBy: (w, { asc }) => [asc(w.weekNumber)],
            with: {
              workouts: { orderBy: (wo, { asc }) => [asc(wo.sortOrder)] },
            },
          },
        },
      })
    : await db.query.plans.findFirst({
        where: (p, { eq }) => eq(p.id, id),
        with: {
          weeks: {
            orderBy: (w, { asc }) => [asc(w.weekNumber)],
            with: {
              workouts: {
                orderBy: (wo, { asc }) => [asc(wo.sortOrder)],
                with: { blocks: { orderBy: (b, { asc }) => [asc(b.sortOrder)] } },
              },
            },
          },
        },
      });

  if (!plan) return null;

  // See /api/plans (list) for why "still active past race day" implies
  // unlogged rather than needing a separate lookup.
  const pastRaceDayUnlogged =
    plan.intent === "race" && plan.status === "active" && plan.raceDate < new Date();

  return { ...plan, pastRaceDayUnlogged };
}
