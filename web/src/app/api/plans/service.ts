import { and, eq } from "drizzle-orm";
import { db, plans } from "@/db";
import { ownedBy } from "@/lib/api/owned";
import { listStrengthSessions } from "../strength/sessions/service";
import { mondayOf, addDays } from "@/lib/plan-ui";

// ── Shared "which plan is active" query ─────────────────────────────────────
// The same lookup /api/today's getTodaySnapshot does as its first step,
// pulled out so a caller that only needs the id (not the whole snapshot)
// isn't stuck either duplicating this WHERE or paying for stats/behind-plan/
// week-workout queries it will throw away. today/service.ts still does its
// own select for the extra columns it needs — see call site there.

export async function getActivePlanId(): Promise<string | null> {
  const [activePlan] = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.status, "active"), ownedBy(plans)))
    .limit(1);
  return activePlan?.id ?? null;
}

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

// ── Active plan + (optionally) its strength sessions, in one call ───────────
// Backs GET /api/plans/active. Written for the four plan/* screens that used
// to run /api/today -> /api/plans/[id] -> (sometimes) /api/strength/sessions
// as three serial round trips purely to learn the active plan's id and then
// its own date range — see docs/PLAN_OF_ATTACK.md's plan-bootstrap entry.
// getTodaySnapshot() is deliberately not reused here: it also computes this
// week's workouts, adherence and achieved-km, none of which any /plan/*
// screen renders, and paying for those queries just to throw the extra
// fields away would be its own small version of the same problem.
export interface ActivePlanBundle {
  activePlan: boolean;
  plan: Awaited<ReturnType<typeof getPlanById>> | null;
  strengthSessions: Awaited<ReturnType<typeof listStrengthSessions>> | null;
}

export async function getActivePlanBundle(opts: {
  profileId: string | null;
  includeSessions: boolean;
  summary?: boolean;
}): Promise<ActivePlanBundle> {
  const planId = await getActivePlanId();
  if (!planId) return { activePlan: false, plan: null, strengthSessions: null };

  const plan = await getPlanById(planId, { summary: opts.summary });
  if (!plan) return { activePlan: false, plan: null, strengthSessions: null };

  if (!opts.includeSessions) return { activePlan: true, plan, strengthSessions: null };

  // Same range every /plan/* screen computed client-side after its own plan
  // fetch: Monday of the plan's first workout through the Sunday of race
  // week. Now that the plan is already in hand server-side, there is no
  // reason to hand its id back to the browser only to have it ask for this
  // range itself.
  const firstDate = plan.weeks[0]?.workouts[0]?.date;
  if (!firstDate) return { activePlan: true, plan, strengthSessions: [] };
  const from = mondayOf(new Date(firstDate));
  const to = addDays(mondayOf(new Date(plan.raceDate)), 6);
  to.setHours(23, 59, 59, 999);
  const strengthSessions = await listStrengthSessions(opts.profileId, { from, to });

  return { activePlan: true, plan, strengthSessions };
}
