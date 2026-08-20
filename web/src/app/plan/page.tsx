"use client";

// "Your Plan" hub: hero card with week progress, quick actions,
// then one card per plan week with day-by-day chips. Rearranging lives in
// /plan/rearrange, week ticking in /plan/overview, settings in /plan/manage.

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  LayoutList,
  LayoutGrid,
  Minus,
  SlidersHorizontal,
  TrendingUp,
  ChevronRight,
  X,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { KadenzMark } from "@/components/ui/KadenzMark";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { workoutColor, STRENGTH_COLOR, strengthColor } from "@/lib/workout-colors";
import { WeeklyStrengthPlan } from "@/components/strength/WeeklyStrengthPlan";
import { PlansOverview } from "@/components/plan/PlansOverview";
import { strengthPlanPresence } from "@/lib/plan-presence";
import { apiFetch } from "@/lib/api";
import { displayDistance, distanceUnitLabel } from "@/lib/units";
import { completedDistanceKm } from "@/lib/training/distance";
import {
  type ApiPlanRow,
  type ApiWeekRow,
  type ApiWorkoutRow,
  type StrengthSessionRow,
  type ItemState,
  mondayOf,
  addDays,
  sameDay,
  weekRangeLabel,
  itemSpec,
  itemState,
} from "@/lib/plan-ui";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type DayItem =
  | { kind: "run"; workout: ApiWorkoutRow }
  | { kind: "strength"; session: StrengthSessionRow };

// ── Day chip: keeps its workout colors (solid or two-tone split) for a day
// that's still open or was completed; a skipped/missed day mutes to the
// same quiet "elevated" treatment the week-level Skipped pill already uses,
// so it never competes with — let alone outshouts — a completed check ─────

function DayChip({ items }: { items: DayItem[] }) {
  const states = items.map((i) => itemState(i));
  const allDone = items.length > 0 && states.every((s) => s === "completed");
  // A day only reads as "skipped" once every item on it was skipped — a
  // mixed run+strength day where just one half was dropped still shows its
  // real colors so the part that did happen doesn't get muted away.
  const allSkipped = items.length > 0 && states.every((s) => s === "skipped");
  const anyMissed = states.some((s) => s === "missed");
  const run = items.find((i) => i.kind === "run");
  const strength = items.find((i) => i.kind === "strength");

  // Rehab reads as its own thing, not folded into the ordinary Kraft blue —
  // see docs/DESIGN.md and lib/workout-colors.ts strengthColor().
  const strengthDayColor =
    strength && strength.kind === "strength" ? strengthColor(strength.session) : STRENGTH_COLOR;

  let style: React.CSSProperties;
  if (allSkipped) {
    style = { backgroundColor: "var(--k-elevated)" };
  } else if (run && strength && run.kind === "run") {
    // Two-tone split: left half strength, right half the run color.
    const runSolid = workoutColor(run.workout.type).solid;
    style = {
      background: `linear-gradient(135deg, ${strengthDayColor.solid} 0%, ${strengthDayColor.solid} 50%, ${runSolid} 50%, ${runSolid} 100%)`,
    };
  } else if (run && run.kind === "run") {
    style = { background: workoutColor(run.workout.type).grad };
  } else {
    style = { background: strengthDayColor.grad };
  }

  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
      style={style}
    >
      {allDone ? (
        <Check
          className="h-4 w-4 text-white [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.45))]"
          strokeWidth={3.5}
        />
      ) : allSkipped ? (
        // Deliberate, quiet — a dash, not a failure mark.
        <Minus className="h-4 w-4 text-text-3" strokeWidth={3} />
      ) : anyMissed ? (
        // Distinct from both: it happened to be missed, not chosen — same
        // muted ink as skipped's dash so it doesn't read as an alarm.
        <X className="h-3.5 w-3.5 text-white/70" strokeWidth={3} />
      ) : null}
    </span>
  );
}

// ── Week card ─────────────────────────────────────────────────────────────────

function WeekCard({
  week,
  sessions,
  isCurrent,
}: {
  week: ApiWeekRow;
  sessions: StrengthSessionRow[];
  isCurrent: boolean;
}) {
  const first = week.workouts[0]?.date;
  if (!first) return null;
  const monday = mondayOf(new Date(first));

  // All items this week (non-rest runs + strength), grouped per day Mon–Sun.
  const dayItems: DayItem[][] = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(monday, i);
    const items: DayItem[] = [];
    const s = sessions.find((x) => sameDay(new Date(x.date), date));
    if (s) items.push({ kind: "strength", session: s });
    const run = week.workouts.find(
      (w) => w.type !== "rest" && sameDay(new Date(w.date), date)
    );
    if (run) items.push({ kind: "run", workout: run });
    return items;
  });

  const allItems = dayItems.flat();
  const itemStates: ItemState[] = allItems.map((it) => itemState(it));
  const doneCount = itemStates.filter((s) => s === "completed").length;
  // A skipped item isn't owed anymore — Skip a week exists precisely so a
  // dropped week doesn't read as a shortfall, so it comes out of both sides
  // of the ratio. A fully skipped week has nothing left to report; showing
  // "0/0" would look like a data bug, so that case renders as a dash instead
  // (the "Skipped" pill above already says why).
  const skippedCount = itemStates.filter((s) => s === "skipped").length;
  const owedCount = allItems.length - skippedCount;

  return (
    <section
      className={`k-card p-4 ${isCurrent ? "ring-2 ring-text-1" : ""}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-3">
        {weekRangeLabel(monday)}
      </p>
      <div className="mt-0.5 flex items-center gap-2">
        <h2 className="text-[17px] font-bold text-text-1">
          Week {week.weekNumber}
        </h2>
        {week.skippedAt && (
          <span className="rounded-full bg-elevated px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-3">
            Skipped
          </span>
        )}
      </div>

      {/* Dashed workout-progress segments — skipped items recede to the same
          quiet hairline tone as the day chip's dash, instead of sitting flush
          with an item that's still genuinely owed. */}
      {allItems.length > 0 && (
        <div className="mt-2.5 flex h-1.5 gap-1">
          {allItems.map((item, i) => {
            const s = itemStates[i];
            return (
              <span
                key={i}
                className="flex-1 rounded-full"
                style={{
                  backgroundColor:
                    s === "completed"
                      ? "var(--k-text-1)"
                      : s === "skipped"
                      ? "var(--k-hairline)"
                      : "var(--k-elevated)",
                }}
              />
            );
          })}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[12px] text-text-2">
        <span>
          Workouts:{" "}
          <span className="font-bold text-text-1 tabular-nums">
            {owedCount > 0 ? `${doneCount}/${owedCount}` : "—"}
          </span>
        </span>
        <span>
          Distance: <span className="font-bold text-text-1 tabular-nums">{displayDistance(week.targetKm, 0)} {distanceUnitLabel()}</span>
        </span>
      </div>

      {/* Per-day list */}
      <div className="mt-3 flex flex-col gap-2.5">
        {dayItems.map((items, i) =>
          items.length === 0 ? null : (
            <div key={i} className="flex items-start gap-3">
              <DayChip items={items} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-text-1">{DAY_NAMES[i]}</p>
                {items.map((item, j) => (
                  <p key={j} className="text-[12.5px] leading-snug text-text-2 truncate">
                    {itemSpec(item)}
                  </p>
                ))}
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}

// ── States ────────────────────────────────────────────────────────────────────

function HubSkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Your Plan" large={false} centerAlways left={<ProfileAvatar />} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-4 pb-tabbar pt-2">
        <div className="h-40 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
        <div className="h-20 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 rounded-[var(--radius-card)] bg-elevated animate-shimmer" />
        ))}
      </div>
      <BottomNav active="plan" />
    </main>
  );
}

function HubEmptyState({
  strengthPlan,
  onChanged,
}: {
  strengthPlan?: { active: boolean; sessionsPerWeek: number } | null;
  onChanged?: () => void;
}) {
  // Reached whenever there is no RUNNING plan — which is not the same as
  // having no plans. Kraft can be running here, so the overview comes first
  // and the create-a-race-plan prompt only appears when there is genuinely
  // nothing.
  const kraftOn = strengthPlanPresence(strengthPlan) === "active";

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Your Plan" large={false} centerAlways left={<ProfileAvatar />} />
      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-tabbar pt-2">
        <PlansOverview
          runPlan={null}
          strengthPlan={strengthPlan ?? null}
          onChanged={onChanged ?? (() => {})}
        />

        {!kraftOn && (
        <EmptyState
          icon={
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
            </svg>
          }
          title="Build your plan"
          message="Create a personalised race plan and your week-by-week training schedule will appear here."
          action={
            <TransitionLink href="/create">
              <Button size="lg">Create plan</Button>
            </TransitionLink>
          }
        />
        )}
        <section className="mt-2">
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">
            Strength
          </p>
          <WeeklyStrengthPlan />
        </section>
      </div>
      <BottomNav active="plan" />
    </main>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const QUICK_ACTIONS = [
  { href: "/plan/overview", label: "Plan Overview", Icon: LayoutList },
  { href: "/plan/rearrange", label: "Rearrange Workouts", Icon: CalendarClock },
  { href: "/settings/apps", label: "Connected Apps", Icon: LayoutGrid },
  { href: "/plan/manage", label: "Manage Plan", Icon: SlidersHorizontal },
];

export default function PlanHubPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ApiPlanRow | null>(null);
  const [sessions, setSessions] = useState<StrengthSessionRow[]>([]);
  // Distinct from "no plan": a failed load must not render as an empty state,
  // which would tell the athlete their plan is gone.
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Kraft's own state, captured whether or not a running plan exists — the
  // two plans are independent and this tab has to be able to say so.
  const [strengthPlan, setStrengthPlan] = useState<{ active: boolean; sessionsPerWeek: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Was /api/today -> /api/plans/[id] -> /api/strength/sessions, three
        // serial round trips purely to learn the active plan's id and then
        // its own date range. One call now — see api/plans/active/route.ts.
        //
        // summary=1 drops every workout's blocks (warm-up, rep detail,
        // cooldown), which are the bulk of the response: ~101KB full against a
        // few KB summarised. This screen renders week and workout rows only
        // and never reads .blocks, so the full shape was download and parse
        // cost for data that was thrown away. plan/rearrange is the one
        // /plan/* screen that genuinely needs blocks and still asks for them.
        const res = await apiFetch("/api/plans/active?sessions=1&summary=1");
        if (!res.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const bundle = await res.json();
        if (cancelled) return;
        // Read before the running-plan guard below: "no running plan" must not
        // mean "no plans", which is exactly what this screen used to conclude.
        setStrengthPlan(
          (bundle.strengthPlan as { active: boolean; sessionsPerWeek: number } | null) ?? null
        );
        if (bundle.strengthSessions) {
          setSessions(bundle.strengthSessions as StrengthSessionRow[]);
        }
        if (!bundle.activePlan || !bundle.plan) return;
        setPlan(bundle.plan as ApiPlanRow);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const retry = () => {
    setFailed(false);
    setLoading(true);
    setReloadKey((k) => k + 1);
  };

  const now = new Date();

  const derived = useMemo(() => {
    if (!plan) return null;
    const weekMondays = plan.weeks.map((w) => {
      const first = w.workouts[0]?.date;
      return first ? mondayOf(new Date(first)) : null;
    });
    const completedWeeks = weekMondays.filter(
      (m) => m !== null && addDays(m, 7) <= now
    ).length;
    const currentWeekNumber =
      plan.weeks.find((w, i) => {
        const m = weekMondays[i];
        return m !== null && m <= now && now < addDays(m, 7);
      })?.weekNumber ?? null;
    const totalKm = plan.weeks.reduce((sum, w) => sum + (w.targetKm ?? 0), 0);
    // Distance done so far: the recorded distance of each completed run,
    // falling back to its target only when nothing was recorded. Matches
    // Today's mileage ring and Insights — see lib/training/distance.ts.
    const completedKm = plan.weeks.reduce(
      (sum, w) =>
        sum +
        w.workouts
          .filter((x) => x.status === "completed" && x.type !== "rest")
          .reduce((s, x) => s + completedDistanceKm(x), 0),
      0
    );
    return { completedWeeks, currentWeekNumber, totalKm, completedKm };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  if (loading) return <HubSkeleton />;
  if (failed) return <ErrorState onRetry={retry} />;
  if (!plan || !derived)
    return (
      <HubEmptyState
        strengthPlan={strengthPlan}
        onChanged={() => setReloadKey((k) => k + 1)}
      />
    );

  const raceDateLabel = new Date(plan.raceDate).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const weekSessions = (week: ApiWeekRow): StrengthSessionRow[] => {
    const first = week.workouts[0]?.date;
    if (!first) return [];
    const monday = mondayOf(new Date(first));
    const end = addDays(monday, 7);
    return sessions.filter((s) => {
      const d = new Date(s.date);
      return d >= monday && d < end;
    });
  };

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Your Plan" large={false} centerAlways left={<ProfileAvatar />} />

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pb-tabbar pt-2">
        {/* Hero card */}
        <section className="k-card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[22px] font-bold leading-tight tracking-tight text-text-1">
                {plan.name}
              </h1>
              <p className="mt-1 text-[13px] text-text-2">
                {plan.intent && plan.intent !== "race" ? "Ends" : "Your race"}: {raceDateLabel}
              </p>
            </div>
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-on-accent" style={{ background: "var(--k-signature-grad)" }}>
              <KadenzMark className="h-6 w-6" />
            </div>
          </div>

          {/* Dashed week-progress row */}
          <div className="mt-4 flex h-1.5 gap-1">
            {plan.weeks.map((w, i) => (
              <span
                key={w.weekNumber}
                className="flex-1 rounded-full"
                style={{
                  backgroundColor:
                    i < derived.completedWeeks ? "var(--k-text-1)" : "var(--k-elevated)",
                }}
              />
            ))}
          </div>

          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-text-3">Weeks completed</p>
              <p className="text-[18px] font-extrabold tabular-nums text-text-1">
                {derived.completedWeeks}/{plan.weeks.length}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] uppercase tracking-wide text-text-3">Distance</p>
              <p className="text-[18px] font-extrabold tabular-nums text-text-1">
                {displayDistance(derived.completedKm, 0)}/{displayDistance(derived.totalKm, 0)} {distanceUnitLabel()}
              </p>
            </div>
          </div>
        </section>

        {/* Both plans, named, with add/remove — the same section the
            no-running-plan view leads with, so this tab answers "what am I
            signed up for" in one place regardless of which plans exist. */}
        <PlansOverview
          runPlan={{ id: plan.id, name: plan.name, planLengthWeeks: plan.weeks.length }}
          strengthPlan={strengthPlan}
          onChanged={() => setReloadKey((k) => k + 1)}
        />

        {/* Quick actions */}
        <div className="grid grid-cols-4 gap-2">
          {QUICK_ACTIONS.map(({ href, label, Icon }) => (
            <TransitionLink
              key={href}
              href={href}
              className="press flex flex-col items-center gap-1.5"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-hairline bg-surface">
                <Icon className="h-5 w-5 text-text-1" strokeWidth={1.9} />
              </span>
              <span className="text-center text-[10px] font-semibold leading-tight text-text-2">
                {label}
              </span>
            </TransitionLink>
          ))}
        </div>

        {/* Pace insights */}
        <TransitionLink href="/pace-insights" className="press block">
          <section className="k-card flex items-center gap-3 p-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-elevated">
              <TrendingUp className="h-5 w-5 text-accent-fg" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-text-3">Pace insights</p>
              <p className="text-[15px] font-bold text-text-1">See how your pace is tracking</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-text-3" strokeWidth={2} />
          </section>
        </TransitionLink>

        {/* Strength plan config lives in Manage Plan (the Strength tab), parallel
            to the running plan — no duplicate setup card here. The scheduled
            strength SESSIONS still appear inline in each week card below. */}

        {/* Week cards */}
        {plan.weeks.map((week) => (
          <WeekCard
            key={week.weekNumber}
            week={week}
            sessions={weekSessions(week)}
            isCurrent={week.weekNumber === derived.currentWeekNumber}
          />
        ))}
      </div>

      <BottomNav active="plan" />
    </main>
  );
}
