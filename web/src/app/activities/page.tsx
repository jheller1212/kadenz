"use client";

import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react";
import { ChevronRight, Activity as ActivityIcon, AlertCircle, Plus, CalendarDays, Link2, Unlink, Check, Trash2, RotateCcw } from "lucide-react";
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
import { STRENGTH_COLOR, workoutColor, typeWash } from "@/lib/workout-colors";
import { displayDistance, distanceUnitLabel, displayPace, paceUnitLabel } from "@/lib/units";
import { formatPace } from "@/lib/plan-engine/pace-zones";
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

// Inline feed mini chart: per-km pace for a run, per-set tonnage (weight ×
// reps) for a strength session. Comes pre-compacted from /api/activities —
// see that route for why nothing bigger ever reaches the client.
interface ActivityChart {
  kind: "pace" | "volume";
  values: number[];
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
  avgHr?: number | null;
  elevationGain?: number | null;
  status: string;
  date: string;
  dayOfWeek?: number;
  blocks: WorkoutBlock[];
  activity?: ActivityData | null;
  // Unified-feed fields (runs + strength)
  kind?: string;
  stravaId?: string | null;
  workoutId?: string | null;
  strengthSessionId?: string | null;
  chart?: ActivityChart | null;
}

// Lets any WorkoutRow open the Link sheet without prop-threading.
const LinkContext = createContext<(a: ActivityWorkout) => void>(() => {});

// Edit mode (delete-to-trash) without prop-threading through MonthSection.
const EditContext = createContext<{
  editMode: boolean;
  onDelete: (a: ActivityWorkout) => void;
}>({ editMode: false, onDelete: () => {} });

interface TrashItem {
  id: string;
  deletedAt: string;
  name: string | null;
  date: string | null;
  distanceKm: number | null;
  sportType: string | null;
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

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatSeconds(seconds: number): string {
  // Never render a fractional/sub-second duration (a positive value < 1s → 1s).
  const total = seconds > 0 ? Math.max(1, Math.round(seconds)) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function formatPaceSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// Single source of truth for these hexes is lib/workout-colors.ts (kept in
// sync with the CSS --k-type-* twins) — no local hex duplicates here, that's
// exactly how the JS/CSS palettes drifted before.
function activityTypeColor(type: string): string {
  if (type === "strength") return STRENGTH_COLOR.solid;
  if (type === "run") return "#60A5FA";
  return workoutColor(type).solid;
}

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
    bars.push({ label, km: displayDistance(km), startDate: start });
  }
  return bars;
}

// Monthly mileage buckets for the longer ranges (YTD / last 12 months).
function computeMonthlyBars(workouts: ActivityWorkout[], months: number): WeekBar[] {
  const now = new Date();
  const bars: WeekBar[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const km = workouts
      .filter((wo) => {
        const d = new Date(wo.date);
        return d >= start && d < end && wo.type !== "rest";
      })
      .reduce((sum, wo) => sum + (wo.distanceKm ?? wo.activity?.distanceKm ?? wo.targetKm ?? 0), 0);
    bars.push({ label: start.toLocaleDateString("en-US", { month: "short" }), km: displayDistance(km), startDate: start });
  }
  return bars;
}

type PerfRange = "week" | "month" | "ytd" | "year";
const PERF_RANGE_OPTIONS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "ytd", label: "YTD" },
  { value: "year", label: "1 Year" },
];

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

// ── Feed window ────────────────────────────────────────────────────────────────
// The feed defaults to a rolling window rather than the athlete's whole
// history — /api/activities used to run four unbounded queries (including
// one pulling every run's splitsJson blob) on every load. Keep in sync with
// DEFAULT_WINDOW_MONTHS in api/activities/route.ts.

const DEFAULT_WINDOW_MONTHS = 12;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Year filter options. There's no cheap way to know the athlete's very first
// activity without the full-history scan this change removes, so this is a
// generous fixed lookback rather than a query — old enough to predate the
// app, recent enough not to clutter the picker.
const YEAR_OPTIONS_BACK = 6;

/**
 * Turn the year/month filters into the from/to window sent to /api/activities.
 * - Year picked (any month): that whole calendar year.
 * - Year + month picked: that single month.
 * - Month picked, no year: that month in the current year — the natural
 *   reading of "March" with nothing else selected.
 * - Neither: the default rolling window, open-ended so nothing that just
 *   synced a moment in the future gets excluded.
 */
function computeWindow(yearFilter: string, monthFilter: string): { from: string; to: string | null } {
  const now = new Date();
  const monthIndex = monthFilter === "All" ? null : MONTHS.indexOf(monthFilter);

  if (yearFilter !== "All") {
    const year = Number(yearFilter);
    if (monthIndex != null) {
      return {
        from: new Date(year, monthIndex, 1).toISOString(),
        to: new Date(year, monthIndex + 1, 1).toISOString(),
      };
    }
    return {
      from: new Date(year, 0, 1).toISOString(),
      to: new Date(year + 1, 0, 1).toISOString(),
    };
  }

  if (monthIndex != null) {
    const year = now.getFullYear();
    return {
      from: new Date(year, monthIndex, 1).toISOString(),
      to: new Date(year, monthIndex + 1, 1).toISOString(),
    };
  }

  const from = new Date(now.getFullYear(), now.getMonth() - (DEFAULT_WINDOW_MONTHS - 1), 1);
  return { from: from.toISOString(), to: null };
}

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

// ── Inline feed mini chart ──────────────────────────────────────────────────
// Plain flex/div bars, not SVG or a charting dependency — this renders once
// per card in a feed that can be long, and divs are cheap to lay out at that
// scale (same pattern WeeklyBarChart already uses below). Degrades to
// nothing when the card has no real chart data — see the `chart` null checks
// at each call site, never an empty frame.

function MiniFeedChart({ chart, color }: { chart: ActivityChart; color: string }) {
  const { kind, values } = chart;
  // Pace: faster (lower sec/km) reads as a taller bar, matching PaceChart's
  // "intensity" convention on the workout detail page. Volume: heavier sets
  // read taller directly.
  const heights =
    kind === "pace"
      ? (() => {
          const min = Math.min(...values);
          const max = Math.max(...values);
          const range = max - min || 1;
          return values.map((v) => 0.25 + ((max - v) / range) * 0.75);
        })()
      : (() => {
          const max = Math.max(...values);
          return values.map((v) => 0.2 + (v / (max || 1)) * 0.8);
        })();

  return (
    <div className="mt-2.5 flex h-6 items-end gap-[3px]" aria-hidden="true">
      {heights.map((h, i) => (
        <div
          key={i}
          className="flex-1 rounded-[1.5px]"
          style={{ height: `${Math.max(h, 0.12) * 100}%`, backgroundColor: color, opacity: 0.55 }}
        />
      ))}
    </div>
  );
}

// ── WorkoutRow ────────────────────────────────────────────────────────────────

function WorkoutRow({ workout }: { workout: ActivityWorkout }) {
  const requestLink = useContext(LinkContext);
  const { editMode, onDelete } = useContext(EditContext);
  const isRecorded = !!workout.stravaId || !!workout.activity;
  const isLinked = !!workout.workoutId || !!workout.strengthSessionId;
  const canLink = isRecorded && !isLinked;
  const barColor = activityTypeColor(workout.type);
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

  const avgHr = workout.activity?.avgHr ?? workout.avgHr ?? null;
  const elevation = workout.elevationGain;

  const cardInner = (
    <div className="flex">
      {/* Colored left strip — 5px, matches the Volt feed card */}
      <div className="w-[5px] shrink-0 rounded-l-[var(--radius-card)]" style={{ backgroundColor: barColor }} />

      <div className="flex-1 p-4">
        {/* Top row: title + day-of-week */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-[16px] font-extrabold text-text-1">{workout.title}</p>
          <div className="flex shrink-0 items-center gap-2">
            <p className="text-[11px] font-bold uppercase text-text-3">
              {date.toLocaleDateString("en-US", { weekday: "short" })}
            </p>
            {editMode && (hasActivity || workout.strengthSessionId) && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(workout); }}
                aria-label={`Delete ${workout.title}`}
                className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger/10"
              >
                <Trash2 className="h-4 w-4 text-danger" strokeWidth={2} />
              </button>
            )}
            {!editMode && canLink && (
              <button
                type="button"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); haptic("light"); requestLink(workout); }}
                className="press flex shrink-0 items-center gap-1 rounded-full bg-elevated px-2.5 py-1 text-[12px] font-semibold text-text-2"
              >
                <Link2 className="h-3.5 w-3.5" strokeWidth={2} />
                Link
              </button>
            )}
            {!editMode && hasActivity && !canLink && <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.9} />}
          </div>
        </div>
        <p className="mt-0.5 text-[12px] text-text-3">{dateStr} · {timeStr}</p>

        {/* Headline Anton value: distance · duration (runs), duration alone (strength) */}
        {(distKm != null || durationDisplay != null) && (
          <p className="mt-1.5 font-display text-[28px] leading-none text-text-1">
            {distKm != null ? (
              <>
                {displayDistance(distKm, 2).toFixed(2)}
                <span className="text-[13px] font-sans font-semibold text-text-3"> {distanceUnitLabel()}</span>
                {durationDisplay != null && <span className="text-[16px] font-sans font-bold text-text-2"> · {durationDisplay}</span>}
              </>
            ) : (
              durationDisplay
            )}
          </p>
        )}

        {/* Small metrics row: pace, HR, elevation */}
        {(avgPaceSecKm != null || avgHr != null || elevation != null) && (
          <div className="mt-2 flex items-center gap-3.5 text-[12px] font-semibold text-text-3">
            {avgPaceSecKm != null && <span className="tabular-nums">{formatPace(displayPace(avgPaceSecKm))} {paceUnitLabel()}</span>}
            {avgHr != null && <span className="tabular-nums">{avgHr} bpm</span>}
            {elevation != null && <span className="tabular-nums">+{Math.round(elevation)} m</span>}
          </div>
        )}

        {/* Inline split/tonnage mini chart — only when real data exists */}
        {workout.chart && <MiniFeedChart chart={workout.chart} color={barColor} />}
      </div>
    </div>
  );

  // Every feed card carries a quiet 5% radial wash of its own type color as
  // the whole card's background, with the card's text and graphics rendered
  // directly on top of it (see lib/workout-colors.ts typeWash()). Contrast
  // was measured against the wash and stays AA-compliant down to 4.83:1 in
  // the worst case, so don't push the tint darker without re-checking that.
  const washStyle = { backgroundImage: typeWash(barColor) };

  if (hasActivity) {
    return (
      <TransitionLink
        href={`/activity/${workout.activity!.id}`}
        aria-label={`View activity details for ${workout.title}`}
        className="press block overflow-hidden k-card"
        style={washStyle}
      >
        {cardInner}
      </TransitionLink>
    );
  }

  // Standalone in-app strength session → read-only session summary
  if (workout.strengthSessionId) {
    return (
      <TransitionLink
        href={`/strength/session/${workout.strengthSessionId}`}
        aria-label={`View strength session ${workout.title}`}
        className="press block overflow-hidden k-card"
        style={washStyle}
      >
        {cardInner}
      </TransitionLink>
    );
  }

  return <div className="overflow-hidden k-card" style={washStyle}>{cardInner}</div>;
}

// ── MonthSection ──────────────────────────────────────────────────────────────

function MonthSection({ group }: { group: MonthGroup }) {
  const totalSec = Math.round(group.totalDurationMinutes * 60);
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
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-text-3">{group.label}</p>
          <p className="mt-1 text-[13px] text-text-3">
            {group.activityCount} {group.activityCount === 1 ? "activity" : "activities"} · {durationStr}
          </p>
        </div>
        <p className="pt-0.5 text-[15px] font-bold tabular-nums text-text-2">
          {displayDistance(group.totalKm)} {distanceUnitLabel()}
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

function WorkoutsTab({
  workouts,
  trashCount,
  onOpenTrash,
  yearFilter,
  setYearFilter,
  monthFilter,
  setMonthFilter,
}: {
  workouts: ActivityWorkout[];
  trashCount: number;
  onOpenTrash: () => void;
  yearFilter: string;
  setYearFilter: (v: string) => void;
  monthFilter: string;
  setMonthFilter: (v: string) => void;
}) {
  const [typeFilter, setTypeFilter] = useState("All");

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: YEAR_OPTIONS_BACK }, (_, i) => (currentYear - i).toString());

  // The server already scopes `workouts` to the year/month window (see
  // computeWindow) — only the type filter still needs to run client-side.
  const filtered = workouts.filter((wo) => {
    if (wo.type === "rest") return false;
    return typeFilter === "All" || FILTER_TYPE_MAP[typeFilter]?.includes(wo.type);
  });

  const groups = groupByMonth(filtered);

  const windowCaption =
    yearFilter !== "All"
      ? monthFilter !== "All"
        ? `Showing ${monthFilter} ${yearFilter}.`
        : `Showing all of ${yearFilter}.`
      : monthFilter !== "All"
      ? `Showing ${monthFilter} ${currentYear}.`
      : `Showing the last ${DEFAULT_WINDOW_MONTHS} months. Pick a year for older training.`;

  return (
    <div className="flex flex-col gap-5">
      {/* Filters */}
      <div className="scrollbar-none flex gap-2 overflow-x-auto pb-1">
        {/* Workout type — pill chips, Volt filter-row pattern */}
        {FILTER_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => { haptic("light"); setTypeFilter(t); }}
            className={`press shrink-0 rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors ${
              typeFilter === t ? "bg-accent text-on-accent" : "bg-elevated text-text-1"
            }`}
          >
            {t}
          </button>
        ))}

        {/* Year */}
        <div className="relative shrink-0">
          <select
            value={yearFilter}
            onChange={(e) => { haptic("light"); setYearFilter(e.target.value); }}
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
            onChange={(e) => { haptic("light"); setMonthFilter(e.target.value); }}
            className="press appearance-none rounded-full bg-elevated py-1.5 pl-3 pr-7 text-[13px] font-semibold text-text-1 focus:outline-none"
          >
            <option value="All">Month</option>
            {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>

      {/* Windowed-feed indicator — the feed is scoped by default, this says so
          rather than letting older training look like it disappeared. */}
      <p className="-mt-2 text-[12px] text-text-3">{windowCaption}</p>

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

      {/* Recently deleted */}
      {trashCount > 0 && (
        <button
          type="button"
          onClick={() => { haptic("light"); onOpenTrash(); }}
          className="press k-card flex items-center gap-3 px-4 py-3.5 text-left"
        >
          <Trash2 className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.9} />
          <span className="flex-1 text-[15px] font-semibold text-text-1">
            Recently deleted ({trashCount})
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={1.9} />
        </button>
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
                title={`${bar.label}: ${bar.km} ${distanceUnitLabel()}`}
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

  const [range, setRange] = useState<PerfRange>("week");

  const now = new Date();
  const weekStart = new Date(now);
  // Days since Monday: Mon=0 … Sun=6. Using getDay() directly would make Sunday
  // (getDay()===0) jump to NEXT Monday, emptying the whole "Week" range every
  // Sunday. ((getDay()+6)%7) anchors Sunday to the current week's Monday.
  weekStart.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  weekStart.setHours(0, 0, 0, 0);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999); // through end of Sunday, not its midnight

  // Range start/end + label for the selected timeframe.
  let rangeStart: Date;
  let rangeEnd: Date = now;
  let dateRangeLabel: string;
  if (range === "week") {
    rangeStart = weekStart;
    rangeEnd = weekEnd;
    dateRangeLabel = `${weekStart.toLocaleDateString("en-US", { day: "numeric", month: "short" })} – ${weekEnd.toLocaleDateString("en-US", { day: "numeric", month: "short" })}`;
  } else if (range === "month") {
    rangeStart = new Date(now.getFullYear(), now.getMonth(), 1);
    dateRangeLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  } else if (range === "ytd") {
    rangeStart = new Date(now.getFullYear(), 0, 1);
    dateRangeLabel = `${now.getFullYear()} to date`;
  } else {
    rangeStart = new Date(now);
    rangeStart.setFullYear(now.getFullYear() - 1);
    dateRangeLabel = "Last 12 months";
  }

  const inRange = workouts.filter((wo) => {
    const d = new Date(wo.date);
    return d >= rangeStart && d <= rangeEnd && wo.type !== "rest";
  });

  const rangeKm = inRange.reduce((s, wo) => s + (wo.distanceKm ?? wo.activity?.distanceKm ?? wo.targetKm ?? 0), 0);
  const rangeSec = inRange.reduce((s, wo) => s + (wo.durationSeconds ?? wo.activity?.durationSeconds ?? (wo.targetDurationMinutes ?? 0) * 60), 0);

  // Weekly bars for short ranges, monthly for the long ones.
  const bars =
    range === "week" || range === "month"
      ? computeWeeklyBars(workouts, weekStart)
      : computeMonthlyBars(workouts, range === "ytd" ? now.getMonth() + 1 : 12);

  return (
    <div className="flex flex-col gap-5">
      {/* Range selector */}
      <Segmented
        options={PERF_RANGE_OPTIONS}
        value={range}
        onChange={(v) => setRange(v as PerfRange)}
      />

      {/* Date range header */}
      <div className="flex items-center justify-between">
        <p className="text-[17px] font-bold text-text-1">{dateRangeLabel}</p>
        <span className="rounded-full bg-elevated px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-text-3">
          {PERF_RANGE_OPTIONS.find((o) => o.value === range)?.label}
        </span>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: "KILOMETERS", value: rangeKm > 0 ? rangeKm.toFixed(2) : "0.00" },
          { label: "TIME",       value: rangeSec > 0 ? formatSeconds(rangeSec) : "0s" },
          { label: "ACTIVITIES", value: inRange.length.toString() },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-[var(--radius-input)] bg-surface p-3 text-center">
            <p className="text-[9px] font-semibold uppercase tracking-wider text-text-3">{label}</p>
            <p className="mt-1 text-[15px] font-extrabold leading-tight tabular-nums text-text-1">{value}</p>
          </div>
        ))}
      </div>

      {/* Weekly mileage bar chart */}
      <div className="k-card p-4">
        <p className="mb-4 text-[13px] font-semibold uppercase tracking-wider text-text-3">
          {range === "ytd" || range === "year" ? "Monthly mileage" : "Weekly mileage"}
        </p>
        <WeeklyBarChart bars={bars} />
      </div>

      {/* Personal Records */}
      <div className="k-card p-4">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[13px] font-semibold uppercase tracking-wider text-text-3">Personal Records</p>
          <TransitionLink href="/settings" className="text-[12px] font-semibold text-accent-fg">Edit</TransitionLink>
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
            <TransitionLink href="/settings" className="font-semibold text-accent-fg">Add one</TransitionLink>
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

  // Owned here (not inside WorkoutsTab) because the window they imply is a
  // server request, not a client-side filter — see computeWindow.
  const [yearFilter, setYearFilter] = useState("All");
  const [monthFilter, setMonthFilter] = useState("All");

  async function load() {
    try {
      const { from, to } = computeWindow(yearFilter, monthFilter);
      const qs = new URLSearchParams({ from, ...(to ? { to } : {}) });
      const r = await apiFetch(`/api/activities?${qs.toString()}`);
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

  // Re-fetches whenever the year/month filter changes — selecting an older
  // year asks the server for that period rather than filtering a list that
  // was never sent in the first place.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [yearFilter, monthFilter]);

  // Garmin has no activity webhook (unlike Strava), so nothing pushes new watch
  // activities in. Pull them in the background when this screen opens — throttled
  // so we don't wake the worker on every navigation — and refresh the list if
  // anything new arrived, so the athlete never has to import by hand.
  useEffect(() => {
    const KEY = "kadenz_garmin_import_at";
    const THROTTLE_MS = 3 * 60_000;
    let last = 0;
    try { last = Number(localStorage.getItem(KEY) || 0); } catch { /* no storage */ }
    if (Date.now() - last < THROTTLE_MS) return;
    try { localStorage.setItem(KEY, String(Date.now())); } catch { /* no storage */ }
    let alive = true;
    apiFetch("/api/garmin/import", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (alive && res && (res.imported ?? 0) > 0) load();
      })
      .catch(() => { /* not connected / offline — silent */ });
    return () => { alive = false; };
  }, []);

  const { pull, refreshing } = usePullToRefresh(load);
  useScrollRestoration(!loading);
  const [addOpen, setAddOpen] = useState(false);
  const [linkTarget, setLinkTarget] = useState<ActivityWorkout | null>(null);

  // ── Delete to trash / recently deleted ──────────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [undoId, setUndoId] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refreshTrash = useCallback(async () => {
    try {
      const r = await apiFetch("/api/activities/trash");
      if (r.ok) {
        const data = await r.json();
        if (Array.isArray(data)) setTrashItems(data);
      }
    } catch {
      /* non-critical */
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load, not a render cascade
  useEffect(() => { refreshTrash(); }, [refreshTrash]);
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);

  const handleDelete = useCallback(async (a: ActivityWorkout) => {
    const actId = a.activity?.id ?? a.strengthSessionId;
    if (!actId) return;
    haptic("warning");
    // Optimistic removal — recoverable, so no confirm.
    setWorkouts((prev) =>
      prev.filter((w) => (w.activity?.id ?? w.strengthSessionId) !== actId)
    );
    const r = a.activity?.id
      ? await apiFetch(`/api/activities/${actId}`, { method: "DELETE" })
      : await apiFetch(`/api/strength/sessions/${actId}/trash`, { method: "POST" });
    if (r.ok) {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoId(actId);
      undoTimer.current = setTimeout(() => setUndoId(null), 5000);
      refreshTrash();
    } else {
      load(); // put the row back
    }
  }, [refreshTrash]);

  async function undoDelete() {
    if (!undoId) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoId(null);
    const r = await apiFetch(`/api/activities/trash/${undoId}/restore`, { method: "POST" });
    if (r.ok) haptic("success");
    load();
    refreshTrash();
  }

  if (loading) return <ActivitiesSkeleton />;

  return (
    <LinkContext.Provider value={setLinkTarget}>
    <main className="min-h-dvh bg-bg">
      <PullIndicator pull={pull} refreshing={refreshing} />
      <NavBar
        title="Activities"
        large={false}
        centerAlways
        left={<ProfileAvatar />}
        right={
          <div className="flex items-center gap-2">
            {activeTab === "workouts" && (
              <button
                type="button"
                onClick={() => { haptic("light"); setEditMode((v) => !v); }}
                className="press flex h-9 items-center rounded-lg bg-elevated px-3 text-[13px] font-semibold text-text-2"
              >
                {editMode ? "Done" : "Edit"}
              </button>
            )}
            <button
              type="button"
              onClick={() => { haptic("light"); setAddOpen(true); }}
              aria-label="Add manual activity"
              className="press flex h-9 w-9 items-center justify-center rounded-lg bg-elevated"
            >
              <Plus className="h-4 w-4 text-text-2" strokeWidth={2} />
            </button>
            <TransitionLink
              href="/plan/rearrange"
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

        {/* Tab control — underline style */}
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

        {/* Undo strip after moving an activity to the trash */}
        {undoId && (
          <div className="flex items-center justify-between rounded-[var(--radius-input)] bg-elevated px-3 py-2">
            <p className="text-[13px] text-text-2">Moved to Recently deleted</p>
            <button
              type="button"
              onClick={undoDelete}
              className="press text-[13px] font-semibold text-accent-fg"
            >
              Undo
            </button>
          </div>
        )}

        {/* Tab content */}
        {activeTab === "workouts" ? (
          <EditContext.Provider value={{ editMode, onDelete: handleDelete }}>
            <WorkoutsTab
              workouts={workouts}
              trashCount={trashItems.length}
              onOpenTrash={() => setTrashOpen(true)}
              yearFilter={yearFilter}
              setYearFilter={setYearFilter}
              monthFilter={monthFilter}
              setMonthFilter={setMonthFilter}
            />
          </EditContext.Provider>
        ) : (
          <PerformanceTab workouts={workouts} />
        )}
      </div>

      <TrashSheet
        open={trashOpen}
        items={trashItems}
        onClose={() => setTrashOpen(false)}
        onChanged={() => { refreshTrash(); load(); }}
      />
      <AddActivitySheet open={addOpen} onClose={() => setAddOpen(false)} onSaved={load} />
      <LinkActivitySheet
        activity={linkTarget}
        onClose={() => setLinkTarget(null)}
        onLinked={() => { setLinkTarget(null); load(); }}
      />

      <BottomNav active="activities" />
    </main>
    </LinkContext.Provider>
  );
}

// ── Recently deleted (trash) sheet ────────────────────────────────────────────

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function TrashSheet({
  open,
  items,
  onClose,
  onChanged,
}: {
  open: boolean;
  items: TrashItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  async function restore(id: string) {
    setBusyId(id);
    try {
      const r = await apiFetch(`/api/activities/trash/${id}/restore`, { method: "POST" });
      if (r.ok) { haptic("success"); onChanged(); }
      else haptic("warning");
    } finally {
      setBusyId(null);
    }
  }

  async function purge(id: string) {
    // Two-tap confirm: first tap arms, second tap deletes forever.
    if (confirmId !== id) {
      haptic("warning");
      setConfirmId(id);
      return;
    }
    setConfirmId(null);
    setBusyId(id);
    try {
      const r = await apiFetch(`/api/activities/trash/${id}`, { method: "DELETE" });
      if (r.ok) { haptic("success"); onChanged(); }
      else haptic("warning");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Sheet open={open} onClose={() => { setConfirmId(null); onClose(); }} title="Recently deleted">
      <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto px-1 pb-2">
        <p className="text-[13px] text-text-3">
          Deleted activities are kept for 30 days, then removed forever.
        </p>

        {items.length === 0 ? (
          <p className="py-4 text-center text-[14px] text-text-3">Nothing here.</p>
        ) : (
          items.map((item) => {
            const dateStr = item.date
              ? new Date(item.date).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
              : null;
            return (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded-[var(--radius-input)] bg-surface px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-text-1">
                    {item.name ?? (item.sportType === "strength" ? "Strength session" : "Run")}
                  </p>
                  <p className="text-[12px] text-text-3">
                    {dateStr ? `${dateStr} · ` : ""}
                    {item.distanceKm != null ? `${displayDistance(item.distanceKm, 2).toFixed(2)} ${distanceUnitLabel()} · ` : ""}
                    deleted {timeAgo(item.deletedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => restore(item.id)}
                  className="press flex shrink-0 items-center gap-1 rounded-full bg-elevated px-2.5 py-1.5 text-[12px] font-semibold text-text-1 disabled:opacity-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                  Restore
                </button>
                <button
                  type="button"
                  disabled={busyId === item.id}
                  onClick={() => purge(item.id)}
                  aria-label={confirmId === item.id ? "Tap again to delete forever" : "Delete forever"}
                  className={`press flex h-8 shrink-0 items-center justify-center rounded-lg disabled:opacity-50 ${
                    confirmId === item.id
                      ? "bg-danger px-2 text-[11px] font-semibold text-white"
                      : "w-8 bg-danger/10"
                  }`}
                >
                  {confirmId === item.id ? "Sure?" : <Trash2 className="h-4 w-4 text-danger" strokeWidth={2} />}
                </button>
              </div>
            );
          })
        )}
      </div>
    </Sheet>
  );
}

// ── Link activity → run workout or strength session ───────────────────────────

interface LinkCandidateRun {
  id: string;
  date: string;
  type: string;
  title: string;
  targetKm: number | null;
}
interface LinkCandidateStrength {
  id: string;
  date: string;
  type: string;
  title: string;
  status: string;
  linked: boolean;
}

function LinkActivitySheet({
  activity,
  onClose,
  onLinked,
}: {
  activity: ActivityWorkout | null;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [runs, setRuns] = useState<LinkCandidateRun[]>([]);
  const [strength, setStrength] = useState<LinkCandidateStrength[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const activityId = activity?.activity?.id ?? activity?.id ?? null;

  useEffect(() => {
    if (!activityId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    (async () => {
      try {
        const r = await apiFetch(`/api/activities/${activityId}/candidates`);
        if (r.ok && !cancelled) {
          const d = await r.json();
          setRuns(d.runs ?? []);
          setStrength(d.strength ?? []);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activityId]);

  async function link(body: Record<string, unknown>) {
    if (!activityId) return;
    setBusy(true);
    try {
      const r = await apiFetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) { haptic("success"); onLinked(); }
      else haptic("warning");
    } finally {
      setBusy(false);
    }
  }

  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "short" });

  return (
    <Sheet open={!!activity} onClose={onClose} title="Link this activity">
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-1 pb-2">
        <p className="text-[13px] text-text-3">
          Attach this recorded activity — with its HR — to a planned session, so it counts toward your plan.
        </p>

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <>
            {runs.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">Runs</p>
                <div className="flex flex-col gap-1.5">
                  {runs.map((w) => (
                    <button
                      key={w.id}
                      disabled={busy}
                      onClick={() => link({ workoutId: w.id })}
                      className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-surface px-3 py-2.5 text-left disabled:opacity-50"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: activityTypeColor(w.type) }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-text-1">{w.title}</span>
                        <span className="block text-[12px] text-text-3">{fmtDay(w.date)}{w.targetKm ? ` · ${displayDistance(w.targetKm)} ${distanceUnitLabel()}` : ""}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {strength.length > 0 && (
              <div>
                <p className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-text-3">Strength</p>
                <div className="flex flex-col gap-1.5">
                  {strength.map((s) => (
                    <button
                      key={s.id}
                      disabled={busy || s.linked}
                      onClick={() => link({ strengthSessionId: s.id })}
                      className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-surface px-3 py-2.5 text-left disabled:opacity-40"
                    >
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: STRENGTH_COLOR.solid }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-semibold text-text-1">{s.title}</span>
                        <span className="block text-[12px] text-text-3">{fmtDay(s.date)}{s.linked ? " · already linked" : ""}</span>
                      </span>
                      {s.linked && <Check className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {runs.length === 0 && strength.length === 0 && (
              <p className="text-[13px] text-text-2">No planned sessions near this date to link to.</p>
            )}
          </>
        )}

        {(activity?.workoutId || activity?.strengthSessionId) && (
          <Button variant="danger" size="md" full busy={busy} onClick={() => link({ unlink: true })}>
            <Unlink className="mr-1.5 inline h-4 w-4" strokeWidth={2} /> Unlink
          </Button>
        )}
      </div>
    </Sheet>
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
  const [kind, setKind] = useState<"run" | "strength">("run");
  const [name, setName] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [distance, setDistance] = useState("");
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function save() {
    const isStrength = kind === "strength";
    const distanceKm = parseFloat(distance.replace(",", "."));
    const durationSeconds = hours * 3600 + minutes * 60 + seconds;
    if (!name.trim()) return setFormError("Give the activity a name.");
    if (!isStrength && (!Number.isFinite(distanceKm) || distanceKm <= 0))
      return setFormError("Enter a distance.");
    if (durationSeconds <= 0) return setFormError("Enter a duration.");
    setSaving(true);
    setFormError(null);
    try {
      const res = await apiFetch("/api/activities/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          name: name.trim(),
          date: new Date(`${date}T12:00:00`).toISOString(),
          ...(isStrength ? {} : { distanceKm }),
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
    <Sheet open={open} onClose={onClose} title="Log activity">
      <div className="flex flex-col gap-4 pb-2">
        <Segmented
          value={kind}
          onChange={(v) => { setKind(v); setFormError(null); }}
          options={[
            { value: "run", label: "Run" },
            { value: "strength", label: "Strength" },
          ]}
        />
        <input
          type="text"
          placeholder={kind === "strength" ? "Name (e.g. Gym session)" : "Name (e.g. Evening run)"}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />
        <div className="flex items-center gap-3">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
          {kind === "run" && (
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                type="number" inputMode="decimal" step="0.01" min={0} placeholder="0.0"
                value={distance} onChange={(e) => setDistance(e.target.value)}
                className="w-20 rounded-[var(--radius-input)] bg-elevated px-2 py-3 text-center text-[16px] font-semibold text-text-1 outline-none tabular-nums focus:ring-2 focus:ring-accent/40"
              />
              <span className="text-[13px] text-text-3">km</span>
            </div>
          )}
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
          {saving ? "Saving…" : kind === "strength" ? "Log strength session" : "Log run"}
        </Button>
      </div>
    </Sheet>
  );
}
