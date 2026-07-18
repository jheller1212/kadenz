"use client";

// "Your Plan" hub (Benchmark-style): hero card with week progress, quick actions,
// then one card per plan week with day-by-day chips. Rearranging lives in
// /plan/rearrange, week ticking in /plan/overview, settings in /plan/manage.

import { useEffect, useMemo, useState } from "react";
import {
  CalendarClock,
  Check,
  LayoutList,
  SlidersHorizontal,
  TrendingUp,
} from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { WeeklyStrengthPlan } from "@/components/strength/WeeklyStrengthPlan";
import { apiFetch } from "@/lib/api";
import { displayDistance, distanceUnitLabel } from "@/lib/units";
import {
  WORKOUT_BAR_COLOR,
  STRENGTH_BLUE,
  type ApiPlanRow,
  type ApiWeekRow,
  type ApiWorkoutRow,
  type StrengthSessionRow,
  mondayOf,
  addDays,
  sameDay,
  weekRangeLabel,
  itemSpec,
} from "@/lib/plan-ui";

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type DayItem =
  | { kind: "run"; workout: ApiWorkoutRow }
  | { kind: "strength"; session: StrengthSessionRow };

function itemCompleted(item: DayItem): boolean {
  return (item.kind === "run" ? item.workout.status : item.session.status) === "completed";
}

// ── Day chip: keeps its workout colors (solid or two-tone split); a white
// check overlays when everything that day is done ────────────────────────────

function DayChip({ items }: { items: DayItem[] }) {
  const allDone = items.length > 0 && items.every(itemCompleted);
  const run = items.find((i) => i.kind === "run");
  const strength = items.find((i) => i.kind === "strength");

  let style: React.CSSProperties;
  if (run && strength) {
    const runColor = WORKOUT_BAR_COLOR[run.kind === "run" ? run.workout.type : "easy"];
    // Two-tone split: left half strength blue, right half the run color.
    style = {
      background: `linear-gradient(90deg, ${STRENGTH_BLUE} 50%, ${runColor} 50%)`,
    };
  } else if (run && run.kind === "run") {
    style = { backgroundColor: WORKOUT_BAR_COLOR[run.workout.type] };
  } else {
    style = { backgroundColor: STRENGTH_BLUE };
  }

  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
      style={style}
    >
      {allDone && (
        <Check
          className="h-4 w-4 text-white [filter:drop-shadow(0_1px_1px_rgba(0,0,0,0.45))]"
          strokeWidth={3.5}
        />
      )}
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
  const doneCount = allItems.filter(itemCompleted).length;

  return (
    <section
      className={`k-card p-4 ${isCurrent ? "ring-2 ring-text-1" : ""}`}
    >
      <p className="text-[10px] font-bold uppercase tracking-widest text-text-3">
        {weekRangeLabel(monday)}
      </p>
      <h2 className="mt-0.5 text-[17px] font-bold text-text-1">
        Week {week.weekNumber}
      </h2>

      {/* Dashed workout-progress segments */}
      {allItems.length > 0 && (
        <div className="mt-2.5 flex h-1.5 gap-1">
          {allItems.map((item, i) => (
            <span
              key={i}
              className="flex-1 rounded-full"
              style={{
                backgroundColor: itemCompleted(item)
                  ? "var(--k-text-1)"
                  : "var(--k-elevated)",
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between text-[12px] text-text-2">
        <span>
          Workouts: <span className="font-bold text-text-1 tabular-nums">{doneCount}/{allItems.length}</span>
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

function HubEmptyState() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Your Plan" large={false} centerAlways left={<ProfileAvatar />} />
      <div className="mx-auto flex w-full max-w-md flex-col px-4 pb-tabbar">
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
  { href: "/plan/rearrange", label: "Training Calendar", Icon: CalendarClock },
  { href: "/pace-insights", label: "Pace Insights", Icon: TrendingUp },
  { href: "/plan/manage", label: "Manage Plan", Icon: SlidersHorizontal },
];

export default function PlanHubPage() {
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<ApiPlanRow | null>(null);
  const [sessions, setSessions] = useState<StrengthSessionRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const todayRes = await apiFetch("/api/today");
        if (!todayRes.ok) return;
        const today = await todayRes.json();
        if (!today.activePlan || cancelled) return;

        const planRes = await apiFetch(`/api/plans/${today.planId}`);
        if (!planRes.ok || cancelled) return;
        const p = (await planRes.json()) as ApiPlanRow;
        setPlan(p);

        // One call for the whole plan window (Monday of week 1 → Sunday of
        // the race week) — the sessions API takes an arbitrary range.
        const firstDate = p.weeks[0]?.workouts[0]?.date;
        if (firstDate) {
          const from = mondayOf(new Date(firstDate));
          const to = addDays(mondayOf(new Date(p.raceDate)), 6);
          to.setHours(23, 59, 59, 999);
          const sRes = await apiFetch(
            `/api/strength/sessions?from=${from.toISOString()}&to=${to.toISOString()}`
          );
          if (sRes.ok && !cancelled) {
            setSessions((await sRes.json()) as StrengthSessionRow[]);
          }
        }
      } catch {
        /* silent — empty state below */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
    return { completedWeeks, currentWeekNumber, totalKm };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  if (loading) return <HubSkeleton />;
  if (!plan || !derived) return <HubEmptyState />;

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
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-text-1">
            {plan.name}
          </h1>
          <p className="mt-1 text-[13px] text-text-2">Your race: {raceDateLabel}</p>

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

          <div className="mt-2.5 flex items-center justify-between text-[12px] text-text-2">
            <span>
              Total Weeks{" "}
              <span className="font-bold text-text-1 tabular-nums">
                {derived.completedWeeks}/{plan.weeks.length}
              </span>
            </span>
            <span>
              Total Distance{" "}
              <span className="font-bold text-text-1 tabular-nums">
                {displayDistance(derived.totalKm, 0)} {distanceUnitLabel()}
              </span>
            </span>
          </div>
        </section>

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

        {/* Strength */}
        <section>
          <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-text-3">
            Strength
          </p>
          <WeeklyStrengthPlan />
        </section>

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
