"use client";

import { useEffect, useState } from "react";
import { BarChart3, CalendarDays, Trophy, Flame } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { apiFetch } from "@/lib/api";
import { displayDistance, distanceUnitLabel, displayPace, paceUnitLabel } from "@/lib/units";
import { HR_ZONE_META, getUserZoneBounds, formatZoneDuration } from "@/lib/hr-zone-time";
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
    easyRunMinKm: (raw.easyRunMinKm as number) ?? 0,
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

// ── Performance (real activity data) types + formatters ──────────────────────

interface PerfRecord {
  key: string;
  label: string;
  timeSeconds: number | null;
  paceSecKm: number | null;
  date: string | null;
}
interface PerfBadge {
  category: string;
  label: string;
  earned: boolean;
  value: number;
  target: number;
}
interface Performance {
  hasData: boolean;
  totals?: {
    runCount: number;
    totalKm: number;
    totalSeconds: number;
    totalElevation: number;
    longestRunKm: number;
    yearKm: number;
    monthKm: number;
    streakWeeks: number;
  };
  records?: PerfRecord[];
  monthly?: { label: string; km: number }[];
  badges?: PerfBadge[];
}

function fmtDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function fmtPace(secKm: number): string {
  const m = Math.floor(secKm / 60);
  const s = Math.round(secKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ── Derived stats helpers ─────────────────────────────────────────────────────

const WORKOUT_COLORS: Record<WorkoutType, string> = {
  easy: "#7BC232",
  recovery: "#7BC232",
  long: "#8655F0",
  tempo: "#F2A113",
  interval: "#E0402E",
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
            : "var(--k-progress)";
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
            title={`Week ${week.weekNumber}: ${displayDistance(week.targetKm)} ${distanceUnitLabel()}`}
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

// ── Time in HR zones (current month) ──────────────────────────────────────────

interface ZoneTimes {
  seconds: number[];
  total: number;
}

function TimeInZonesCard({ zones }: { zones: ZoneTimes }) {
  return (
    <section className="k-card p-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
          Time in zones
        </p>
        <p className="text-[11px] text-text-3">this month</p>
      </div>

      {/* Stacked bar — one segment per zone with time in it */}
      <div className="flex h-3 gap-px overflow-hidden rounded-full">
        {zones.seconds.map((s, i) =>
          s > 0 ? (
            <div
              key={i}
              className="h-full"
              style={{
                width: `${(s / zones.total) * 100}%`,
                backgroundColor: HR_ZONE_META[i].color,
              }}
            />
          ) : null
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-col gap-2.5">
        {zones.seconds.map((s, i) => (
          <div key={i} className="flex items-center gap-2.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: HR_ZONE_META[i].color }}
            />
            <span className="text-[13px] text-text-2">
              {HR_ZONE_META[i].label} · {HR_ZONE_META[i].name}
            </span>
            <span className="ml-auto text-[13px] font-semibold tabular-nums text-text-1">
              {s > 0 ? formatZoneDuration(s) : "—"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Monthly distance trend (trailing 12 months) ──────────────────────────────

function MonthlyChart({ monthly }: { monthly: { label: string; km: number }[] }) {
  const maxKm = Math.max(...monthly.map((m) => m.km), 1);
  return (
    <div>
      <div className="flex items-end gap-1 h-24">
        {monthly.map((m, i) => {
          const pct = (m.km / maxKm) * 100;
          const isCurrent = i === monthly.length - 1;
          return (
            <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full rounded-sm transition-all"
                style={{
                  height: `${Math.max(pct, 3)}%`,
                  backgroundColor: "var(--k-accent)",
                  opacity: isCurrent ? 1 : 0.4,
                }}
                title={`${m.label}: ${displayDistance(m.km)} ${distanceUnitLabel()}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {monthly.map((m, i) => (
          <span
            key={i}
            className="flex-1 text-center text-[9px] text-text-3"
            style={{ opacity: i % 2 === 0 ? 1 : 0.55 }}
          >
            {m.label[0]}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Loading / empty states ────────────────────────────────────────────────────

function StatsSkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Stats" large={false} centerAlways left={<ProfileAvatar />} right={
          <TransitionLink
            href="/plan/rearrange"
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
            href="/plan/rearrange"
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
  const [perf, setPerf] = useState<Performance | null>(null);
  const [zoneTimes, setZoneTimes] = useState<ZoneTimes | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Time in zones for the displayed (current) month. Zone bounds live in
  // client settings, so we pass them to the API. Fails silently — the card
  // just stays hidden.
  useEffect(() => {
    (async () => {
      try {
        const { bounds, max } = getUserZoneBounds();
        const now = new Date();
        const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
        const res = await apiFetch(
          `/api/stats/hr-zones?month=${month}&bounds=${bounds.join(",")}&max=${max}`
        );
        if (!res.ok) return;
        const data = (await res.json()) as { zones: { seconds: number }[] };
        const seconds = data.zones.map((z) => z.seconds);
        const total = seconds.reduce((s, n) => s + n, 0);
        if (total > 0) setZoneTimes({ seconds, total });
      } catch {
        // no HR data / offline — hide the card
      }
    })();
  }, []);

  useEffect(() => {
    async function load() {
      // Performance (real activities) and the active plan load independently —
      // either can be present without the other.
      const [perfResult, planResult] = await Promise.allSettled([
        (async () => {
          const res = await apiFetch("/api/performance");
          if (!res.ok) throw new Error("perf");
          return (await res.json()) as Performance;
        })(),
        (async () => {
          const listRes = await apiFetch("/api/plans");
          if (!listRes.ok) throw new Error("plans");
          const plans = await listRes.json();
          const active = (plans as { id: string; status: string }[]).find(
            (p) => p.status === "active"
          );
          if (!active) return null;
          const res = await apiFetch(`/api/plans/${active.id}`);
          if (!res.ok) throw new Error("plan");
          return adaptApiPlan(await res.json());
        })(),
      ]);

      if (perfResult.status === "fulfilled" && perfResult.value.hasData) {
        setPerf(perfResult.value);
      }
      if (planResult.status === "fulfilled") {
        setPlan(planResult.value);
      }
      if (perfResult.status === "rejected" && planResult.status === "rejected") {
        setError("Couldn't load your stats. Pull to refresh and try again.");
      }
      setLoaded(true);
    }
    load();
  }, []);

  if (!loaded) return <StatsSkeleton />;
  if (!plan && !perf) return <NoPlanState />;

  // Plan-derived stats (only when an active plan exists).
  const planStats = plan
    ? (() => {
        const currentWeekIdx = getCurrentWeekIndex(plan);
        const currentWeek = plan.weeks[currentWeekIdx];
        const typeCounts = getWorkoutTypeCounts(plan);
        const totalWorkouts = Object.values(typeCounts).reduce(
          (sum, n) => sum + (n ?? 0),
          0
        );
        const totalKm = plan.weeks.reduce((sum, w) => sum + w.targetKm, 0);
        const thisWeekWorkouts =
          currentWeek?.workouts.filter((w) => w.type !== "rest") ?? [];
        const completedThisWeek = thisWeekWorkouts.filter(
          (w) => w.status === "completed"
        ).length;
        const completionPct =
          thisWeekWorkouts.length > 0
            ? Math.round((completedThisWeek / thisWeekWorkouts.length) * 100)
            : 0;
        const planPct = Math.round(
          ((currentWeekIdx + 1) / plan.planLengthWeeks) * 100
        );
        return {
          currentWeekIdx,
          currentWeek,
          typeCounts,
          totalWorkouts,
          totalKm,
          completionPct,
          planPct,
        };
      })()
    : null;

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Stats" large={false} centerAlways left={<ProfileAvatar />} right={
          <TransitionLink
            href="/plan/rearrange"
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

        {/* ── Performance (real activity data) ─────────────────────────── */}
        {perf?.totals && (
          <>
            {/* Lifetime totals */}
            <section className="k-card p-4">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                All-time running
              </p>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[34px] font-extrabold tabular-nums leading-none text-accent">
                    {displayDistance(perf.totals.totalKm, 0)}
                    <span className="text-[15px] font-semibold text-text-3"> {distanceUnitLabel()}</span>
                  </p>
                  <p className="mt-1.5 text-[13px] text-text-3">Total distance</p>
                </div>
                <div>
                  <p className="text-[34px] font-extrabold tabular-nums leading-none text-text-1">
                    {perf.totals.runCount}
                  </p>
                  <p className="mt-1.5 text-[13px] text-text-3">Runs logged</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-[var(--radius-input)] bg-elevated px-2 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Time</p>
                  <p className="mt-1 text-[15px] font-extrabold tabular-nums text-text-1">
                    {fmtDuration(perf.totals.totalSeconds).split(":").slice(0, 2).join(":")}
                    <span className="text-[10px] font-semibold text-text-3">
                      {perf.totals.totalSeconds >= 3600 ? " h" : " min"}
                    </span>
                  </p>
                </div>
                <div className="rounded-[var(--radius-input)] bg-elevated px-2 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Longest</p>
                  <p className="mt-1 text-[15px] font-extrabold tabular-nums text-text-1">
                    {displayDistance(perf.totals.longestRunKm)}
                    <span className="text-[10px] font-semibold text-text-3"> {distanceUnitLabel()}</span>
                  </p>
                </div>
                <div className="rounded-[var(--radius-input)] bg-elevated px-2 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-3">Elev.</p>
                  <p className="mt-1 text-[15px] font-extrabold tabular-nums text-text-1">
                    {perf.totals.totalElevation}
                    <span className="text-[10px] font-semibold text-text-3"> m</span>
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center gap-4 text-[13px]">
                <span className="text-text-2">
                  <span className="font-bold tabular-nums text-text-1">
                    {displayDistance(perf.totals.yearKm, 0)}
                  </span>{" "}
                  {distanceUnitLabel()} this year
                </span>
                <span className="text-text-2">
                  <span className="font-bold tabular-nums text-text-1">
                    {displayDistance(perf.totals.monthKm, 0)}
                  </span>{" "}
                  {distanceUnitLabel()} this month
                </span>
                {perf.totals.streakWeeks > 1 && (
                  <span className="ml-auto flex items-center gap-1 text-accent">
                    <Flame className="h-3.5 w-3.5" strokeWidth={2.2} />
                    <span className="font-bold tabular-nums">{perf.totals.streakWeeks}</span>
                    <span className="text-text-3">wk</span>
                  </span>
                )}
              </div>
            </section>

            {/* Monthly trend */}
            {perf.monthly && perf.monthly.some((m) => m.km > 0) && (
              <section className="k-card p-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                    Monthly distance
                  </p>
                  <p className="text-[11px] text-text-3">last 12 months</p>
                </div>
                <MonthlyChart monthly={perf.monthly} />
              </section>
            )}

            {/* Time in HR zones (current month) */}
            {zoneTimes && <TimeInZonesCard zones={zoneTimes} />}

            {/* Personal records */}
            {perf.records && perf.records.some((r) => r.timeSeconds != null) && (
              <section className="k-card p-4">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3 mb-4">
                  Personal records
                </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {perf.records
                    .filter((r) => r.timeSeconds != null)
                    .map((r) => (
                      <div
                        key={r.key}
                        className="rounded-[var(--radius-input)] bg-elevated px-3 py-3"
                      >
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
                          {r.label}
                        </p>
                        <p className="mt-1 text-[20px] font-extrabold tabular-nums leading-none text-text-1">
                          {r.key === "1k"
                            ? `${fmtPace(displayPace(r.paceSecKm!))}`
                            : fmtDuration(r.timeSeconds!)}
                          {r.key === "1k" && (
                            <span className="text-[11px] font-semibold text-text-3"> {paceUnitLabel()}</span>
                          )}
                        </p>
                        {r.key !== "1k" && r.paceSecKm != null && (
                          <p className="mt-1 text-[11px] tabular-nums text-text-3">
                            {fmtPace(displayPace(r.paceSecKm))}{paceUnitLabel()}
                          </p>
                        )}
                      </div>
                    ))}
                </div>
                <p className="mt-3 text-[11px] leading-snug text-text-3">
                  Projected from your best sustained pace over each distance.
                </p>
              </section>
            )}

            {/* Achievements */}
            {perf.badges && perf.badges.length > 0 && (
              <section className="k-card p-4">
                <div className="flex items-center gap-2 mb-4">
                  <Trophy className="h-4 w-4 text-accent" strokeWidth={2} />
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                    Achievements
                  </p>
                  <span className="ml-auto text-[11px] tabular-nums text-text-3">
                    {perf.badges.filter((b) => b.earned).length}/{perf.badges.length}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {perf.badges.map((b, i) => (
                    <span
                      key={`${b.category}-${i}`}
                      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${
                        b.earned
                          ? "bg-accent/15 text-accent"
                          : "bg-elevated text-text-3"
                      }`}
                    >
                      {b.earned ? "✓ " : ""}
                      {b.label}
                    </span>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── Plan-derived stats (only with an active plan) ────────────── */}
        {plan && planStats && (
          <>
            {/* Plan progress */}
            <section className="k-card p-4">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                Plan progress
              </p>
              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-[var(--radius-input)] bg-elevated px-3 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-3">
                    Week
                  </p>
                  <p className="mt-1 text-[22px] font-extrabold tabular-nums text-accent">
                    {planStats.currentWeekIdx + 1}
                    <span className="text-text-3 text-xs font-semibold">
                      /{plan.planLengthWeeks}
                    </span>
                  </p>
                </div>
                <div className="rounded-[var(--radius-input)] bg-elevated px-3 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-3">
                    Total {distanceUnitLabel()}
                  </p>
                  <p className="mt-1 text-[22px] font-extrabold tabular-nums text-text-1">
                    {displayDistance(planStats.totalKm, 0)}
                  </p>
                </div>
                <div className="rounded-[var(--radius-input)] bg-elevated px-3 py-3 text-center">
                  <p className="text-[10px] uppercase tracking-wider text-text-3">
                    Workouts
                  </p>
                  <p className="mt-1 text-[22px] font-extrabold tabular-nums text-text-1">
                    {planStats.totalWorkouts}
                  </p>
                </div>
              </div>
              {/* Plan-level progress: one dash per week */}
              <div className="mt-4 flex gap-1.5">
                {Array.from({ length: plan.planLengthWeeks }, (_, i) => (
                  <div
                    key={i}
                    className="h-1.5 flex-1 rounded-full"
                    style={{ backgroundColor: i <= planStats.currentWeekIdx ? "var(--k-text-1)" : "var(--k-elevated)" }}
                  />
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-text-3 text-right">
                {planStats.planPct}% through plan
              </p>
            </section>

            {/* This week */}
            {planStats.currentWeek && (
              <section className="k-card p-4">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                  This week
                </p>
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[34px] font-extrabold tabular-nums leading-none text-text-1">
                      {planStats.completionPct}%
                    </p>
                    <p className="mt-1.5 text-[13px] text-text-3">Workouts done</p>
                  </div>
                  <div>
                    <p className="text-[34px] font-extrabold tabular-nums leading-none text-text-1">
                      {displayDistance(planStats.currentWeek.targetKm)}
                      <span className="text-[15px] font-semibold text-text-3"> {distanceUnitLabel()}</span>
                    </p>
                    <p className="mt-1.5 text-[13px] text-text-3">Planned volume</p>
                  </div>
                </div>
                <div className="mt-5 h-2 overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${planStats.completionPct}%` }}
                  />
                </div>
              </section>
            )}

            {/* Volume progression */}
            <section className="k-card p-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                  Volume progression
                </p>
                <p className="text-[11px] text-text-3">{distanceUnitLabel()} / week</p>
              </div>
              <VolumeChart weeks={plan.weeks} currentWeekIdx={planStats.currentWeekIdx} />
              <div className="mt-2 flex justify-between text-[11px] text-text-3">
                <span>Wk 1</span>
                <span>Wk {plan.planLengthWeeks}</span>
              </div>
            </section>

            {/* Workout type distribution */}
            <section className="k-card p-4">
              <p className="text-[13px] font-semibold uppercase tracking-wide text-text-3 mb-4">
                Workout distribution
              </p>
              <div className="flex flex-col gap-3">
                {(
                  Object.entries(planStats.typeCounts) as [WorkoutType, number][]
                )
                  .sort(([, a], [, b]) => b - a)
                  .map(([type, count]) => (
                    <WorkoutTypeBar
                      key={type}
                      label={WORKOUT_LABELS[type]}
                      count={count}
                      total={planStats.totalWorkouts}
                      color={WORKOUT_COLORS[type]}
                    />
                  ))}
              </div>
            </section>
          </>
        )}
      </div>

      <BottomNav active="stats" />
    </main>
  );
}
