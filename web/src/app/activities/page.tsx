"use client";

import { useState, useEffect } from "react";
import { ChevronRight, Activity as ActivityIcon, AlertCircle, Plus, CalendarDays } from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { BottomNav } from "@/components/BottomNav";
import { Segmented } from "@/components/ui/Segmented";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { haptic } from "@/lib/haptics";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { usePullToRefresh } from "@/lib/usePullToRefresh";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import { PullIndicator } from "@/components/ui/PullIndicator";

// ── Types ─────────────────────────────────────────────────────────────────────

interface WorkoutBlock {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
}

interface ActivityData {
  id: string;
  stravaId?: string;
  distanceKm?: number;
  durationSeconds?: number;
  avgPaceSecKm?: number;
  avgHr?: number;
  maxHr?: number;
}

interface ActivityWorkout {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
  distanceKm?: number | null;
  durationSeconds?: number | null;
  avgPaceSecKm?: number | null;
  status: string;
  date: string;
  dayOfWeek?: number;
  blocks: WorkoutBlock[];
  activity?: ActivityData | null;
}

interface ActivitiesApiResponse {
  activities?: ActivityWorkout[];
  workouts?: ActivityWorkout[];
  planName?: string;
}

interface PersonalRecord {
  id: string;
  distance: string;
  timeSeconds: number;
  date?: string | null;
  source: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function formatPaceSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const WORKOUT_COLORS: Record<string, string> = {
  easy: "#4ADE80",
  recovery: "#4ADE80",
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
  race: "#FF4D4D",
  run: "#60A5FA",
  strength: "#F472B6",
};

// ── Group workouts by month ───────────────────────────────────────────────────

interface MonthGroup {
  label: string;
  key: string;
  workouts: ActivityWorkout[];
  totalKm: number;
  totalDurationMinutes: number;
  activityCount: number;
}

function groupByMonth(workouts: ActivityWorkout[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>();

  for (const wo of workouts) {
    if (wo.type === "rest") continue;
    const d = new Date(wo.date);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

    if (!map.has(key)) {
      map.set(key, { label, key, workouts: [], totalKm: 0, totalDurationMinutes: 0, activityCount: 0 });
    }
    const group = map.get(key)!;
    group.workouts.push(wo);
    group.totalKm += wo.distanceKm ?? wo.activity?.distanceKm ?? wo.targetKm ?? 0;
    group.totalDurationMinutes += wo.durationSeconds ? wo.durationSeconds / 60 : (wo.activity?.durationSeconds ? wo.activity.durationSeconds / 60 : (wo.targetDurationMinutes ?? 0));
    group.activityCount++;
  }

  return Array.from(map.values());
}

// ── Compute weekly totals for bar chart ───────────────────────────────────────

interface WeekBar {
  label: string;
  km: number;
  startDate: Date;
}

function computeWeeklyBars(workouts: ActivityWorkout[], weekStart: Date): WeekBar[] {
  // Build 8-week window ending at weekStart + 7 days
  const bars: WeekBar[] = [];
  for (let i = -7; i <= 0; i++) {
    const start = new Date(weekStart);
    start.setDate(weekStart.getDate() + i * 7);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    end.setHours(23, 59, 59, 999);

    const km = workouts
      .filter((wo) => {
        const d = new Date(wo.date);
        return d >= start && d <= end && wo.type !== "rest";
      })
      .reduce((sum, wo) => sum + (wo.distanceKm ?? wo.activity?.distanceKm ?? wo.targetKm ?? 0), 0);

    const label = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    bars.push({ label, km: Math.round(km * 10) / 10, startDate: start });
  }
  return bars;
}

// ── PR badge hex colors ───────────────────────────────────────────────────────

const PR_DISPLAY: Record<string, { label: string; color: string; bgColor: string }> = {
  "5k":       { label: "5K",   color: "#FAFAFA", bgColor: "#1A3A3A" },
  "10k":      { label: "10K",  color: "#FAFAFA", bgColor: "#0F2E2E" },
  half:       { label: "HALF", color: "#FAFAFA", bgColor: "#2A1A3A" },
  marathon:   { label: "MAR",  color: "#FAFAFA", bgColor: "#1A1A3A" },
  mile:       { label: "MILE", color: "#FAFAFA", bgColor: "#3A2A1A" },
};

// ── Workout type filter options ───────────────────────────────────────────────

const FILTER_TYPES = ["All", "Easy", "Tempo", "Interval", "Long", "Race", "Strength"];
const FILTER_TYPE_MAP: Record<string, string[]> = {
  "All":      [],
  "Easy":     ["easy", "recovery"],
  "Tempo":    ["tempo"],
  "Interval": ["interval"],
  "Long":     ["long"],
  "Race":     ["race"],
  "Strength": ["strength"],
};

// ── Loading skeleton ──────────────────────────────────────────────────────────

function ActivitiesSkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Activities" large left={<ProfileAvatar />} />
      <div className="flex flex-col gap-3 px-4 pb-tabbar">
        <Skeleton className="h-10 w-full" />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-24 rounded-full" />)}
        </div>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
      <BottomNav active="activities" />
    </main>
  );
}

// ── WorkoutRow ────────────────────────────────────────────────────────────────

function WorkoutRow({ workout }: { workout: ActivityWorkout }) {
  const barColor = WORKOUT_COLORS[workout.type] ?? "#999";
  const date = new Date(workout.date);
  const dateStr = date.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const timeStr = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });

  const hasActivity = !!workout.activity;

  // Prefer actual activity data over planned targets
  const distKm = hasActivity && workout.activity!.distanceKm != null
    ? workout.activity!.distanceKm
    : workout.targetKm;
  const durationSec = hasActivity && workout.activity!.durationSeconds != null
    ? workout.activity!.durationSeconds
    : workout.targetDurationMinutes != null ? workout.targetDurationMinutes * 60 : null;
  const avgPaceSecKm = hasActivity && workout.activity!.avgPaceSecKm != null
    ? workout.activity!.avgPaceSecKm
    : (distKm && durationSec ? Math.round(durationSec / distKm) : null);

  const durationDisplay = durationSec != null
    ? (hasActivity ? formatSeconds(durationSec) : formatDuration(Math.round(durationSec / 60)))
    : null;

  const cardInner = (
    <div className="flex">
      {/* Colored left strip */}
      <div className="w-2.5 shrink-0 rounded-l-[var(--radius-card)]" style={{ backgroundColor: barColor }} />

      <div className="flex-1 p-4">
        {/* Top row */}
        <div className="flex items-start gap-3">
          {/* Running icon */}
          <div
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${barColor}22` }}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke={barColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="5" r="1.5" />
              <path d="M6 9l3 1.5 1.5 3.5L9 18" />
              <path d="M14.5 9.5L12 11l1 3 3.5 2" />
              <path d="M10 12l1.5 1 2-1" />
            </svg>
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-text-1">{workout.title}</p>
            <p className="mt-0.5 text-[13px] text-text-3">{dateStr} · {timeStr}</p>
          </div>

          {hasActivity && <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-text-3" strokeWidth={1.9} />}
        </div>

        {/* Stats row */}
        <div className="mt-3 flex items-center gap-4">
          {distKm != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Distance</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{distKm.toFixed(2)} km</p>
            </div>
          )}
          {durationDisplay != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Time</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{durationDisplay}</p>
            </div>
          )}
          {avgPaceSecKm != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Avg pace</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{formatPace(avgPaceSecKm)} /km</p>
            </div>
          )}
          {workout.activity?.avgHr != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Avg HR</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{workout.activity.avgHr} bpm</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (hasActivity) {
    return (
      <TransitionLink
        href={`/activity/${workout.activity!.id}`}
        aria-label={`View activity details for ${workout.title}`}
        className="press block overflow-hidden rounded-[var(--radius-card)] bg-surface"
      >
        {cardInner}
      </TransitionLink>
    );
  }

  return <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface">{cardInner}</div>;
}

// ── MonthSection ──────────────────────────────────────────────────────────────

function MonthSection({ group }: { group: MonthGroup }) {
  const totalSec = group.totalDurationMinutes * 60;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const durationStr = h > 0
    ? `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`
    : `${m}m ${s.toString().padStart(2, "0")}s`;

  return (
    <div className="flex flex-col gap-3">
      {/* Month header */}
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[17px] font-bold text-text-1">{group.label}</p>
          <p className="mt-0.5 text-[13px] text-text-3">
            {group.activityCount} {group.activityCount === 1 ? "activity" : "activities"} · {durationStr}
          </p>
        </div>
        <p className="pt-0.5 text-[15px] font-bold tabular-nums text-text-2">
          {Math.round(group.totalKm * 10) / 10} km
        </p>
      </div>

      {/* Workout cards */}
      {group.workouts.map((wo) => (
        <WorkoutRow key={wo.id} workout={wo} />
      ))}
    </div>
  );
}

// ── Workouts Tab ──────────────────────────────────────────────────────────────

function WorkoutsTab({ workouts }: { workouts: ActivityWorkout[] }) {
  const [typeFilter, setTypeFilter] = useState("All");
  const [yearFilter, setYearFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");

  const years = Array.from(
    new Set(workouts.map((wo) => new Date(wo.date).getFullYear().toString()))
  ).sort((a, b) => Number(b) - Number(a));

  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const filtered = workouts.filter((wo) => {
    if (wo.type === "rest") return false;
    const d = new Date(wo.date);
    const typeMatch =
      typeFilter === "All" || FILTER_TYPE_MAP[typeFilter]?.includes(wo.type);
    const yearMatch = yearFilter === "All" || d.getFullYear().toString() === yearFilter;
    const monthMatch = monthFilter === "All" || d.getMonth() === months.indexOf(monthFilter);
    return typeMatch && yearMatch && monthMatch;
  });

  const groups = groupByMonth(filtered);

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
        {/* Workout type */}
        <div className="relative shrink-0">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="press appearance-none rounded-full bg-elevated py-1.5 pl-3 pr-7 text-[13px] font-semibold text-text-1 focus:outline-none"
          >
            {FILTER_TYPES.map((t) => (
              <option key={t} value={t}>{t === "All" ? "Workout Type" : t}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Year */}
        <div className="relative shrink-0">
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="press appearance-none rounded-full bg-elevated py-1.5 pl-3 pr-7 text-[13px] font-semibold text-text-1 focus:outline-none"
          >
            <option value="All">Year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Month */}
        <div className="relative shrink-0">
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="press appearance-none rounded-full bg-elevated py-1.5 pl-3 pr-7 text-[13px] font-semibold text-text-1 focus:outline-none"
          >
            <option value="All">Month</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Month groups */}
      {groups.length === 0 ? (
        <EmptyState
          icon={<ActivityIcon className="h-10 w-10" strokeWidth={1.5} />}
          title="No activities yet"
          message="No workouts match the selected filters, or you haven't logged any activities yet."
        />
      ) : (
        groups.map((group) => <MonthSection key={group.key} group={group} />)
      )}
    </div>
  );
}

// ── Performance Tab ───────────────────────────────────────────────────────────

function WeeklyBarChart({ bars }: { bars: WeekBar[] }) {
  const maxKm = Math.max(...bars.map((b) => b.km), 1);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-20 items-end gap-1.5">
        {bars.map((bar, i) => {
          const pct = (bar.km / maxKm) * 100;
          const isCurrent = i === bars.length - 1;
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t-sm transition-all"
                style={{
                  height: `${Math.max(pct, bar.km > 0 ? 8 : 3)}%`,
                  backgroundColor: isCurrent ? "var(--k-accent)" : "var(--k-elevated)",
                  minHeight: bar.km > 0 ? 6 : 2,
                }}
                title={`${bar.label}: ${bar.km} km`}
              />
            </div>
          );
        })}
      </div>
      {/* X-axis labels — only first and last to avoid crowding */}
      <div className="flex justify-between px-0.5 text-[10px] tabular-nums text-text-3">
        <span>{bars[0]?.label}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function HexBadge({ pr }: { pr: PersonalRecord }) {
  const display = PR_DISPLAY[pr.distance];
  if (!display) return null;

  const dateStr = pr.date
    ? new Date(pr.date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
    : "—";

  return (
    <div className="flex flex-col items-center gap-2">
      {/* Hexagon */}
      <div
        className="flex h-16 w-16 items-center justify-center"
        style={{
          clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
          backgroundColor: display.bgColor,
        }}
        aria-hidden="true"
      >
        <span className="text-[10px] font-extrabold tracking-wider" style={{ color: display.color }}>
          {display.label}
        </span>
      </div>
      {/* Time */}
      <p className="text-center text-[15px] font-bold tabular-nums text-text-1">
        {formatPaceSeconds(pr.timeSeconds)}
      </p>
      {/* Date */}
      <p className="text-center text-[10px] leading-tight text-text-3">{dateStr}</p>
    </div>
  );
}

function PerformanceTab({ workouts }: { workouts: ActivityWorkout[] }) {
  const [prs, setPrs] = useState<PersonalRecord[]>([]);
  const [prsLoading, setPrsLoading] = useState(true);
  const [prsError, setPrsError] = useState(false);

  useEffect(() => {
    apiFetch("/api/race-times")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load personal records");
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) setPrs(data);
      })
      .catch(() => setPrsError(true))
      .finally(() => setPrsLoading(false));
  }, []);

  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay() + 1); // Monday
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const dateRangeLabel = `${weekStart.toLocaleDateString("en-US", { day: "numeric", month: "short" })} – ${weekEnd.toLocaleDateString("en-US", { day: "numeric", month: "short" })}`;

  const thisWeekWorkouts = workouts.filter((wo) => {
    const d = new Date(wo.date);
    return d >= weekStart && d <= weekEnd && wo.type !== "rest";
  });

  const thisWeekKm = thisWeekWorkouts.reduce((s, wo) => s + (wo.distanceKm ?? wo.activity?.distanceKm ?? wo.targetKm ?? 0), 0);
  const thisWeekSec = thisWeekWorkouts.reduce((s, wo) => s + (wo.durationSeconds ?? wo.activity?.durationSeconds ?? (wo.targetDurationMinutes ?? 0) * 60), 0);

  const bars = computeWeeklyBars(workouts, weekStart);

  return (
    <div className="flex flex-col gap-5">
      {/* Date range header */}
      <div className="flex items-center justify-between">
        <p className="text-[17px] font-bold text-text-1">{dateRangeLabel}</p>
        <span className="rounded-full bg-elevated px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
          This week
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "KILOMETERS", value: thisWeekKm > 0 ? thisWeekKm.toFixed(2) : "0.00" },
          { label: "TIME",       value: thisWeekSec > 0 ? formatSeconds(thisWeekSec) : "0s" },
          { label: "ACTIVITIES", value: thisWeekWorkouts.length.toString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-[var(--radius-input)] bg-surface p-3 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
            <p className="mt-1 text-[15px] font-extrabold leading-tight tabular-nums text-text-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Weekly mileage bar chart */}
      <div className="rounded-[var(--radius-card)] bg-surface p-4">
        <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-text-3">Weekly mileage</p>
        <WeeklyBarChart bars={bars} />
      </div>

      {/* Personal Records */}
      <div className="rounded-[var(--radius-card)] bg-surface p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Personal Records</p>
          <TransitionLink href="/settings" className="text-[12px] font-semibold text-accent">Edit</TransitionLink>
        </div>

        {prsLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <Skeleton className="h-16 w-16 rounded-full" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
        ) : prsError ? (
          <p className="flex items-center justify-center gap-1.5 py-4 text-center text-[13px] text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.9} />
            Couldn&apos;t load personal records.
          </p>
        ) : prs.length === 0 ? (
          <p className="py-4 text-center text-[14px] text-text-3">
            No personal records yet.{" "}
            <TransitionLink href="/settings" className="font-semibold text-accent">Add one</TransitionLink>
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {prs.map((pr) => (
              <HexBadge key={pr.id} pr={pr} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

type ActiveTab = "workouts" | "performance";

export default function ActivitiesPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("workouts");
  const [workouts, setWorkouts] = useState<ActivityWorkout[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  async function load() {
    try {
      const r = await apiFetch("/api/activities");
      if (!r.ok) throw new Error("Failed to load activities");
      const data: ActivitiesApiResponse = await r.json();
      // Use activities (real Strava data) if available, fall back to workouts
      setWorkouts(data.activities ?? data.workouts ?? []);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const { pull, refreshing } = usePullToRefresh(load);
  useScrollRestoration(!loading);
  const [addOpen, setAddOpen] = useState(false);

  if (loading) return <ActivitiesSkeleton />;

  return (
    <main className="min-h-dvh bg-bg">
      <PullIndicator pull={pull} refreshing={refreshing} />
      <NavBar
        title="Activities"
        large={false}
        centerAlways
        left={<ProfileAvatar />}
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { haptic("light"); setAddOpen(true); }}
              aria-label="Add manual activity"
              className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
            >
              <Plus className="h-4 w-4 text-text-2" strokeWidth={2} />
            </button>
            <TransitionLink
              href="/plan"
              aria-label="Calendar"
              className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
            >
              <CalendarDays className="h-4 w-4 text-text-2" strokeWidth={1.9} />
            </TransitionLink>
          </div>
        }
      />

      <div className="flex flex-col gap-4 px-4 pb-tabbar">
        {error && (
          <p className="flex items-center gap-1.5 rounded-[var(--radius-input)] bg-danger/10 px-3 py-2 text-[13px] text-danger">
            <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.9} />
            Couldn&apos;t load your activities. Pull to refresh or try again later.
          </p>
        )}

        {/* Tab control — Benchmark underline style */}
        <div className="relative -mx-4 flex border-b border-hairline">
          {([["workouts", "Workouts"], ["performance", "Performance"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => { haptic("light"); setActiveTab(value); }}
              className={`press relative flex-1 pb-3 pt-1 text-center text-[16px] font-bold transition-colors ${
                activeTab === value ? "text-text-1" : "text-text-2"
              }`}
            >
              {label}
              {activeTab === value && (
                <span className="absolute inset-x-6 bottom-[-1px] h-[3px] rounded-full bg-text-1" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "workouts" ? (
          <WorkoutsTab workouts={workouts} />
        ) : (
          <PerformanceTab workouts={workouts} />
        )}
      </div>

      <AddActivitySheet open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />

      <BottomNav active="activities" />
    </main>
  );
}

// ── Manual activity entry ─────────────────────────────────────────────────────

function AddActivitySheet({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [distance, setDistance] = useState("");
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    const distanceKm = parseFloat(distance.replace(",", "."));
    const durationSeconds = hours * 3600 + minutes * 60 + seconds;
    if (!name.trim()) return setFormError("Give the activity a name.");
    if (!Number.isFinite(distanceKm) || distanceKm <= 0) return setFormError("Enter a distance.");
    if (durationSeconds <= 0) return setFormError("Enter a duration.");
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/activities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          date: new Date(`${date}T12:00:00`).toISOString(),
          distanceKm,
          durationSeconds,
        }),
      });
      if (res.ok) {
        haptic("success");
        setName("");
        setDistance("");
        setHours(0); setMinutes(0); setSeconds(0);
        onSaved();
        onClose();
      } else {
        haptic("warning");
        setFormError("Couldn't save the activity.");
      }
    } catch {
      setFormError("Network error — couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full rounded-[var(--radius-input)] bg-elevated px-3.5 py-3 text-[16px] text-text-1 outline-none focus:ring-2 focus:ring-accent/40";
  const numCls =
    "w-16 rounded-[var(--radius-input)] bg-elevated px-2 py-2.5 text-center text-[16px] font-semibold text-text-1 outline-none tabular-nums focus:ring-2 focus:ring-accent/40";

  return (
    <Sheet open={open} onClose={onClose} title="Add activity">
      <div className="flex flex-col gap-4 pb-2">
        <input
          type="text"
          placeholder="Name (e.g. Evening run)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          <div className="flex shrink-0 items-center gap-1.5">
            <input
              type="number" inputMode="decimal" step="0.01" min={0} placeholder="0.0"
              value={distance} onChange={(e) => setDistance(e.target.value)}
              className="w-20 rounded-[var(--radius-input)] bg-elevated px-2 py-3 text-center text-[16px] font-semibold text-text-1 outline-none tabular-nums focus:ring-2 focus:ring-accent/40"
            />
            <span className="text-[13px] text-text-3">km</span>
          </div>
        </div>
        <div className="flex items-center justify-center gap-2">
          {([["h", hours, setHours, 23], ["m", minutes, setMinutes, 59], ["s", seconds, setSeconds, 59]] as const).map(
            ([key, value, set, max], i) => (
              <div key={key} className="flex items-center gap-2">
                <input
                  type="number" inputMode="numeric" min={0} max={max} value={value}
                  onChange={(e) => set(Math.max(0, Math.min(max, parseInt(e.target.value) || 0)))}
                  className={numCls}
                />
                {i < 2 && <span className="text-[17px] font-bold text-text-3">:</span>}
              </div>
            )
          )}
          <span className="ml-1 text-[12px] text-text-3">h : m : s</span>
        </div>
        {formError && <p className="text-center text-[13px] text-danger">{formError}</p>}
        <Button full onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Add activity"}
        </Button>
      </div>
    </Sheet>
  );
}
