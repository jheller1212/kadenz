"use client";

import { useEffect, useState } from "react";
import { BarChart3 , CalendarDays } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import type {
  GeneratedPlan,
  GeneratedWeek,
  GeneratedBlock,
  GeneratedWorkout,
  WorkoutType,
} from "@/lib/plan-engine/types";

// ── API → GeneratedPlan adapter (mirrors plan/page.tsx) ──────────────────────

function adaptApiPlan(raw: Record<string, unknown>): GeneratedPlan {
  return {
    name: raw.name as string,
    raceDistance: raw.raceDistance as GeneratedPlan["raceDistance"],
    goalTimeSeconds: raw.goalTimeSeconds as number,
    vdot: raw.vdot as number,
    startDate: new Date(raw.startDate as string),
    raceDate: new Date(raw.raceDate as string),
    planLengthWeeks: raw.planLengthWeeks as number,
    daysPerWeek: raw.daysPerWeek as number,
    preferredLongRunDay: (raw.preferredLongRunDay as number) ?? 6,
    currentWeeklyKm: (raw.currentWeeklyKm as number) ?? 0,
    trainingVolume: raw.trainingVolume as GeneratedPlan["trainingVolume"],
    trainingDifficulty: raw.trainingDifficulty as GeneratedPlan["trainingDifficulty"],
    longRunCapKm: (raw.longRunCapKm as number) ?? 0,
    hillyArea: (raw.hillyArea as boolean) ?? false,
    weeks: ((raw.weeks as Record<string, unknown>[]) ?? []).map((week) => ({
      weekNumber: week.weekNumber as number,
      phase: week.phase as GeneratedWeek["phase"],
      type: week.type as GeneratedWeek["type"],
      targetKm: (week.targetKm as number) ?? 0,
      workouts: ((week.workouts as Record<string, unknown>[]) ?? []).map((wo) => ({
        dayOfWeek: wo.dayOfWeek as number,
        date: new Date(wo.date as string),
        type: wo.type as GeneratedWorkout["type"],
        title: wo.title as string,
        description: wo.description as string | undefined,
        targetKm: wo.targetKm as number | undefined,
        targetDurationMinutes: wo.targetDurationMinutes as number | undefined,
        sortOrder: wo.sortOrder as number,
        blocks: ((wo.blocks as Record<string, unknown>[]) ?? []).map((b) => ({
          sortOrder: b.sortOrder as number,
          type: b.type as GeneratedBlock["type"],
          durationMinutes: b.durationMinutes as number | undefined,
          distanceKm: b.distanceKm as number | undefined,
          targetPaceSecKm: b.targetPaceSecKm as number | undefined,
          minPaceSecKm: b.minPaceSecKm as number | undefined,
          maxPaceSecKm: b.maxPaceSecKm as number | undefined,
          reps: b.reps as number | undefined,
          repDistanceKm: b.repDistanceKm as number | undefined,
          repRestSeconds: b.repRestSeconds as number | undefined,
        })),
      })),
    })),
  };
}

// ── Derived stats helpers ─────────────────────────────────────────────────────

const WORKOUT_COLORS: Record<WorkoutType, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  long: "#60A5FA",
  tempo: "#FFB547",
  interval: "#C084FC",
  race: "#FF4D4D",
  rest: "#2A2A2E",
};

const WORKOUT_LABELS: Record<WorkoutType, string> = {
  easy: "Easy",
  recovery: "Recovery",
  long: "Long",
  tempo: "Tempo",
  interval: "Interval",
  race: "Race",
  rest: "Rest",
};

function getCurrentWeekIndex(plan: GeneratedPlan): number {
  const now = new Date();
  for (let i = 0; i < plan.weeks.length; i++) {
    const week = plan.weeks[i];
    const dates = week.workouts.map((w) => w.date);
    const first = dates[0];
    const last = dates[dates.length - 1];
    if (first && last) {
      const endOfWeek = new Date(last);
      endOfWeek.setHours(23, 59, 59, 999);
      if (first <= now && now <= endOfWeek) return i;
    }
  }
  // fallback: find first future week
  for (let i = 0; i < plan.weeks.length; i++) {
    const first = plan.weeks[i].workouts[0]?.date;
    if (first && first > now) return i;
  }
  return plan.weeks.length - 1;
}

function getWorkoutTypeCounts(
  plan: GeneratedPlan
): Partial<Record<WorkoutType, number>> {
  const counts: Partial<Record<WorkoutType, number>> = {};
  for (const week of plan.weeks) {
    for (const wo of week.workouts) {
      if (wo.type !== "rest") {
        counts[wo.type] = (counts[wo.type] ?? 0) + 1;
      }
    }
  }
  return counts;
}

// ── Volume bar chart ──────────────────────────────────────────────────────────

function VolumeChart({
  weeks,
  currentWeekIdx,
}: {
  weeks: GeneratedWeek[];
  currentWeekIdx: number;
}) {
  const maxKm = Math.max(...weeks.map((w) => w.targetKm), 1);

  return (
    <div className="flex items-end gap-0.5 h-16" aria-hidden="true">
      {weeks.map((week, i) => {
        const pct = (week.targetKm / maxKm) * 100;
        const isCurrent = i === currentWeekIdx;
        const isPast = i < currentWeekIdx;
        const color =
          week.type === "race"
            ? "#FF4D4D"
            : week.type === "deload"
            ? "#FFB547"
            : "#C8FF3C";
        return (
          <div
            key={week.weekNumber}
            className="flex-1 rounded-sm transition-all"
            style={{
              height: `${Math.max(pct, 5)}%`,
              backgroundColor: color,
              opacity: isCurrent ? 1 : isPast ? 0.35 : 0.55,
              outline: isCurrent ? `2px solid ${color}` : "none",
              outlineOffset: 1,
            }}
            title={`Week ${week.weekNumber}: ${week.targetKm} km`}
          />
        );
      })}
    </div>
  );
}

// ── Workout type distribution ─────────────────────────────────────────────────

function WorkoutTypeBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3">
      <p className="w-16 shrink-0 text-[13px] text-text-2">{label}</p>
      <div className="flex-1 h-1.5 rounded-full bg-elevated overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
      <p className="w-8 shrink-0 text-right text-[13px] tabular-nums text-text-3">
        {count}
      </p>
    </div>
  );
}

// ── Loading / empty states ────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Stats" large={false} centerAlways left={<ProfileAvatar />} right={
          <TransitionLink
            href="/plan"
            aria-label="Calendar"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
          </TransitionLink>
        } />
      <div className="px-4 pb-tabbar flex flex-col gap-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <BottomNav active="stats" />
    </main>
  );
}

function NoPlanState() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Stats" large={false} centerAlways left={<ProfileAvatar />} right={
          <TransitionLink
            href="/plan"
            aria-label="Calendar"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
          </TransitionLink>
        } />
      <div className="pb-tabbar">
        <EmptyState
          icon={<BarChart3 className="h-10 w-10" strokeWidth={1.5} />}
          title="No stats yet"
          message="Create a training plan and your stats will appear here."
          action={
            <TransitionLink href="/create">
              <Button variant="primary">Create plan</Button>
            </TransitionLink>
          }
        />
      </div>
      <BottomNav active="stats" />
    </main>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [plan, setPlan] = useState<GeneratedPlan | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadPlan() {
      try {
        const listRes = await apiFetch("/api/plans");
        if (!listRes.ok) throw new Error("Failed to fetch plans");
        const plans = await listRes.json();
        const active = (plans as { id: string; status: string }[]).find(
          (p) => p.status === "active"
        );
        if (!active) {
          setLoaded(true);
          return;
        }
        const res = await apiFetch(`/api/plans/${active.id}`);
        if (!res.ok) throw new Error("Failed to fetch plan");
        const raw = await res.json();
        setPlan(adaptApiPlan(raw));
      } catch {
        setError("Couldn't load your stats. Pull to refresh and try again.");
      } finally {
        setLoaded(true);
      }
    }
    loadPlan();
  }, []);

  if (!loaded) return <StatsSkeleton />;
  if (!plan) return <NoPlanState />;

  const currentWeekIdx = getCurrentWeekIndex(plan);
  const currentWeek = plan.weeks[currentWeekIdx];
  const typeCounts = getWorkoutTypeCounts(plan);
  const totalWorkouts = Object.values(typeCounts).reduce(
    (sum, n) => sum + (n ?? 0),
    0
  );
  const totalKm = plan.weeks.reduce((sum, w) => sum + w.targetKm, 0);

  // This-week completion stats (workouts before or on today)
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const thisWeekWorkouts = currentWeek?.workouts.filter(
    (w) => w.type !== "rest"
  ) ?? [];
  const pastWorkoutsThisWeek = thisWeekWorkouts.filter(
    (w) => w.date <= today
  ).length;
  const completionPct =
    thisWeekWorkouts.length > 0
      ? Math.round((pastWorkoutsThisWeek / thisWeekWorkouts.length) * 100)
      : 0;
  const planPct = Math.round(((currentWeekIdx + 1) / plan.planLengthWeeks) * 100);

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Stats" large={false} centerAlways left={<ProfileAvatar />} right={
          <TransitionLink
            href="/plan"
            aria-label="Calendar"
            className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
          >
            <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
          </TransitionLink>
        } />

      <div className="px-4 pb-tabbar flex flex-col gap-3">
        {error && (
          <div className="rounded-[var(--radius-card)] bg-danger/10 p-4 text-[13px] text-danger">
            {error}
          </div>
        )}

        {/* Plan progress */}
        <section className="rounded-[var(--radius-card)] bg-surface p-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
            Plan progress
          </p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            <div className="rounded-[var(--radius-input)] bg-elevated px-3 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-3">
                Week
              </p>
              <p className="mt-1 text-[22px] font-extrabold tabular-nums text-accent">
                {currentWeekIdx + 1}
                <span className="text-text-3 text-xs font-semibold">
                  /{plan.planLengthWeeks}
                </span>
              </p>
            </div>
            <div className="rounded-[var(--radius-input)] bg-elevated px-3 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-3">
                Total km
              </p>
              <p className="mt-1 text-[22px] font-extrabold tabular-nums text-text-1">
                {Math.round(totalKm)}
              </p>
            </div>
            <div className="rounded-[var(--radius-input)] bg-elevated px-3 py-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-text-3">
                Workouts
              </p>
              <p className="mt-1 text-[22px] font-extrabold tabular-nums text-text-1">
                {totalWorkouts}
              </p>
            </div>
          </div>
          {/* Plan-level progress: one dash per week (Benchmark style) */}
          <div className="mt-4 flex gap-1.5">
            {Array.from({ length: plan.planLengthWeeks }, (_, i) => (
              <div
                key={i}
                className="h-1.5 flex-1 rounded-full"
                style={{ backgroundColor: i <= currentWeekIdx ? "var(--k-text-1)" : "var(--k-elevated)" }}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-text-3 text-right">
            {planPct}% through plan
          </p>
        </section>

        {/* This week */}
        {currentWeek && (
          <section className="rounded-[var(--radius-card)] bg-surface p-4">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
              This week
            </p>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <p className="text-[34px] font-extrabold tabular-nums leading-none text-text-1">
                  {completionPct}%
                </p>
                <p className="mt-1.5 text-[13px] text-text-3">Workouts done</p>
              </div>
              <div>
                <p className="text-[34px] font-extrabold tabular-nums leading-none text-text-1">
                  {currentWeek.targetKm}
                  <span className="text-[15px] font-semibold text-text-3"> km</span>
                </p>
                <p className="mt-1.5 text-[13px] text-text-3">Planned volume</p>
              </div>
            </div>
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </section>
        )}

        {/* Volume progression */}
        <section className="rounded-[var(--radius-card)] bg-surface p-4">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
              Volume progression
            </p>
            <p className="text-[11px] text-text-3">km / week</p>
          </div>
          <VolumeChart weeks={plan.weeks} currentWeekIdx={currentWeekIdx} />
          <div className="mt-2 flex justify-between text-[11px] text-text-3">
            <span>Wk 1</span>
            <span>Wk {plan.planLengthWeeks}</span>
          </div>
        </section>

        {/* Workout type distribution */}
        <section className="rounded-[var(--radius-card)] bg-surface p-4">
          <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3 mb-4">
            Workout distribution
          </p>
          <div className="flex flex-col gap-3">
            {(
              Object.entries(typeCounts) as [WorkoutType, number][]
            )
              .sort(([, a], [, b]) => b - a)
              .map(([type, count]) => (
                <WorkoutTypeBar
                  key={type}
                  label={WORKOUT_LABELS[type]}
                  count={count}
                  total={totalWorkouts}
                  color={WORKOUT_COLORS[type]}
                />
              ))}
          </div>
        </section>
      </div>

      <BottomNav active="stats" />
    </main>
  );
}
