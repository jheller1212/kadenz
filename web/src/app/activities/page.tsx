"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components/BottomNav";

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
  status: string;
  date: string;
  dayOfWeek: number;
  blocks: WorkoutBlock[];
  activity?: ActivityData | null;
}

interface ActivitiesApiResponse {
  workouts: ActivityWorkout[];
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
};

const TYPE_LABEL: Record<string, string> = {
  easy: "Easy Run",
  recovery: "Recovery Run",
  tempo: "Tempo Run",
  interval: "Intervals",
  long: "Long Run",
  race: "Race",
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
    group.totalKm += wo.targetKm ?? 0;
    group.totalDurationMinutes += wo.targetDurationMinutes ?? 0;
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
      .reduce((sum, wo) => sum + (wo.targetKm ?? 0), 0);

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

const FILTER_TYPES = ["All", "Easy", "Tempo", "Interval", "Long", "Race"];
const FILTER_TYPE_MAP: Record<string, string[]> = {
  "All":      [],
  "Easy":     ["easy", "recovery"],
  "Tempo":    ["tempo"],
  "Interval": ["interval"],
  "Long":     ["long"],
  "Race":     ["race"],
};

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-8 pb-28 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="w-28 h-7 rounded bg-elevated animate-pulse" />
          <div className="flex gap-2">
            <div className="w-8 h-8 rounded-lg bg-elevated animate-pulse" />
            <div className="w-8 h-8 rounded-lg bg-elevated animate-pulse" />
          </div>
        </div>
        <div className="flex gap-0.5 h-10 rounded-[var(--radius-input)] bg-elevated animate-pulse" />
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-8 w-24 rounded-full bg-elevated animate-pulse" />)}
        </div>
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[var(--radius-card)] border border-hairline bg-surface h-24 animate-pulse" />
        ))}
      </main>
      <BottomNav active="activities" />
    </div>
  );
}

// ── WorkoutRow ────────────────────────────────────────────────────────────────

function WorkoutRow({ workout }: { workout: ActivityWorkout }) {
  const router = useRouter();
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

  function handleClick() {
    if (hasActivity) {
      router.push(`/activity/${workout.activity!.id}`);
    }
  }

  const cardProps = hasActivity
    ? {
        role: "button" as const,
        tabIndex: 0,
        onClick: handleClick,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") handleClick(); },
        className: "rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden cursor-pointer active:opacity-70 transition-opacity",
        "aria-label": `View activity details for ${workout.title}`,
      }
    : {
        className: "rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden",
      };

  return (
    <div {...cardProps}>
      <div className="flex">
        {/* Colored left strip */}
        <div className="w-1.5 shrink-0 rounded-l-[var(--radius-card)]" style={{ backgroundColor: barColor }} />

        <div className="flex-1 p-4">
          {/* Top row */}
          <div className="flex items-start gap-3">
            {/* Running icon */}
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ backgroundColor: `${barColor}22` }}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke={barColor} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="5" r="1.5" />
                <path d="M6 9l3 1.5 1.5 3.5L9 18" />
                <path d="M14.5 9.5L12 11l1 3 3.5 2" />
                <path d="M10 12l1.5 1 2-1" />
              </svg>
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-text-1 truncate">{workout.title}</p>
              <p className="text-xs text-text-3 mt-0.5">{dateStr} · {timeStr}</p>
            </div>

            {hasActivity && (
              <svg className="w-4 h-4 text-text-3 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 18l6-6-6-6" />
              </svg>
            )}
          </div>

          {/* Stats row */}
          <div className="mt-3 flex items-center gap-4">
            {distKm != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-3">Distance</p>
                <p className="text-sm font-bold text-text-1 tabular-nums">{distKm.toFixed(2)} km</p>
              </div>
            )}
            {durationDisplay != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-3">Time</p>
                <p className="text-sm font-bold text-text-1 tabular-nums">{durationDisplay}</p>
              </div>
            )}
            {avgPaceSecKm != null && (
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-3">Avg pace</p>
                <p className="text-sm font-bold text-text-1 tabular-nums">{formatPace(avgPaceSecKm)} /km</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
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
          <p className="text-base font-bold text-text-1">{group.label}</p>
          <p className="text-xs text-text-3 mt-0.5">
            {group.activityCount} {group.activityCount === 1 ? "activity" : "activities"} · {durationStr}
          </p>
        </div>
        <p className="text-sm font-bold text-text-2 tabular-nums pt-0.5">
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
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        {/* Workout type */}
        <div className="relative shrink-0">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-hairline bg-surface text-xs font-semibold text-text-1 cursor-pointer focus:outline-none"
          >
            {FILTER_TYPES.map((t) => (
              <option key={t} value={t}>{t === "All" ? "Workout Type" : t}</option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Year */}
        <div className="relative shrink-0">
          <select
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-hairline bg-surface text-xs font-semibold text-text-1 cursor-pointer focus:outline-none"
          >
            <option value="All">Year</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>

        {/* Month */}
        <div className="relative shrink-0">
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-full border border-hairline bg-surface text-xs font-semibold text-text-1 cursor-pointer focus:outline-none"
          >
            <option value="All">Month</option>
            {months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Month groups */}
      {groups.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-8 text-center">
          <p className="text-sm text-text-3">No workouts match the selected filters.</p>
        </div>
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
      <div className="flex items-end gap-1.5 h-20">
        {bars.map((bar, i) => {
          const pct = (bar.km / maxKm) * 100;
          const isCurrent = i === bars.length - 1;
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
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
      <div className="flex justify-between text-[10px] text-text-3 tabular-nums px-0.5">
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
        className="w-16 h-16 flex items-center justify-center"
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
      <p className="text-sm font-bold text-text-1 tabular-nums text-center">
        {formatPaceSeconds(pr.timeSeconds)}
      </p>
      {/* Date */}
      <p className="text-[10px] text-text-3 text-center leading-tight">{dateStr}</p>
    </div>
  );
}

function PerformanceTab({ workouts }: { workouts: ActivityWorkout[] }) {
  const [viewBy] = useState<"week">("week");
  const [prs, setPrs] = useState<PersonalRecord[]>([]);
  const [prsLoading, setPrsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/race-times")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPrs(data);
      })
      .catch(() => {})
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

  const thisWeekKm = thisWeekWorkouts.reduce((s, wo) => s + (wo.targetKm ?? 0), 0);
  const thisWeekSec = thisWeekWorkouts.reduce((s, wo) => s + (wo.targetDurationMinutes ?? 0) * 60, 0);

  const bars = computeWeeklyBars(workouts, weekStart);

  return (
    <div className="flex flex-col gap-5">
      {/* Date range header */}
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-text-1">{dateRangeLabel}</p>
        <div className="flex items-center gap-1 px-3 py-1.5 rounded-full border border-hairline bg-surface">
          <p className="text-[10px] font-semibold text-text-3 uppercase tracking-wide">View by:</p>
          <p className="text-[10px] font-bold text-text-1 uppercase tracking-wide">{viewBy}</p>
          <svg className="w-3 h-3 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "KILOMETERS", value: thisWeekKm > 0 ? thisWeekKm.toFixed(2) : "0.00" },
          { label: "TIME",       value: thisWeekSec > 0 ? formatSeconds(thisWeekSec) : "0s" },
          { label: "ACTIVITIES", value: thisWeekWorkouts.length.toString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-[var(--radius-input)] bg-surface border border-hairline p-3 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
            <p className="mt-1 text-sm font-extrabold text-text-1 tabular-nums leading-tight">{value}</p>
          </div>
        ))}
      </div>

      {/* Weekly mileage bar chart */}
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-text-3 mb-4">Weekly mileage</p>
        <WeeklyBarChart bars={bars} />
      </div>

      {/* Personal Records */}
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-text-3">Personal Records</p>
          <a href="/settings" className="text-[10px] font-semibold text-accent">Edit</a>
        </div>

        {prsLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex flex-col items-center gap-2">
                <div className="w-16 h-16 rounded-full bg-elevated animate-pulse" />
                <div className="h-4 w-12 rounded bg-elevated animate-pulse" />
                <div className="h-3 w-16 rounded bg-elevated animate-pulse" />
              </div>
            ))}
          </div>
        ) : prs.length === 0 ? (
          <p className="text-sm text-text-3 text-center py-4">
            No personal records yet.{" "}
            <a href="/settings" className="text-accent font-semibold">Add one</a>
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

  useEffect(() => {
    fetch("/api/activities")
      .then((r) => r.json())
      .then((data: ActivitiesApiResponse) => {
        setWorkouts(data.workouts ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Skeleton />;

  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-8 pb-28 flex flex-col gap-4">
        {/* Header */}
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-extrabold text-text-1">Activities</h1>
          <div className="flex items-center gap-2">
            {/* Add button */}
            <button
              className="w-9 h-9 rounded-lg bg-elevated border border-hairline flex items-center justify-center active:opacity-70 transition-opacity"
              aria-label="Add activity"
            >
              <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </button>
            {/* Grid / list toggle */}
            <button
              className="w-9 h-9 rounded-lg bg-elevated border border-hairline flex items-center justify-center active:opacity-70 transition-opacity"
              aria-label="Toggle view"
            >
              <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </button>
          </div>
        </header>

        {/* Tab bar */}
        <div className="flex border-b border-hairline">
          {(["workouts", "performance"] as ActiveTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 pb-2.5 text-sm font-semibold capitalize transition-colors ${
                activeTab === tab
                  ? "text-text-1 border-b-2 border-text-1 -mb-px"
                  : "text-text-3"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "workouts" ? (
          <WorkoutsTab workouts={workouts} />
        ) : (
          <PerformanceTab workouts={workouts} />
        )}
      </main>

      <BottomNav active="activities" />
    </div>
  );
}
