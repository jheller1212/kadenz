"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

// ── Types ────────────────────────────────────────────────────────────────────

interface SpeedWorkout {
  date: string;
  type: string;
  targetPaceSecKm: number;
  minPaceSecKm: number;
  maxPaceSecKm: number;
  actualAvgPace: number | null;
}

interface LongWorkout {
  date: string;
  targetPaceSecKm: number;
  minPaceSecKm: number;
  maxPaceSecKm: number;
  actualAvgPace: number | null;
}

interface RaceTime {
  id: string;
  distance: string;
  timeSeconds: number;
  date: string | null;
  source: string;
}

interface NextSpeedWorkout {
  date: string;
  dayLabel: string;
  type: string;
  targetKm: number;
  color: string;
}

interface PaceInsightsData {
  activePlan: boolean;
  planName: string;
  vdot: number;
  updatedDate: string;
  paceStatus: "on_point" | "needs_work" | "no_data";
  statusMessage: string;
  nextSpeedWorkout: NextSpeedWorkout | null;
  paceZones: Record<string, { minPaceSecKm: number; targetPaceSecKm: number; maxPaceSecKm: number }>;
  speedWorkouts: SpeedWorkout[];
  longWorkouts: LongWorkout[];
  raceTimes: RaceTime[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatPace(secPerKm: number): string {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0)
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return `${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
}

function formatUpdatedDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getDate().toString().padStart(2, "0")}/${(d.getMonth() + 1).toString().padStart(2, "0")}`;
}

const workoutTypeColor: Record<string, string> = {
  tempo: "#FFB547",
  interval: "#C084FC",
  long: "#60A5FA",
};

const workoutTypeLabel: Record<string, string> = {
  tempo: "Tempo",
  interval: "Intervals",
  long: "Long Run",
};

// ── Tab Toggle ───────────────────────────────────────────────────────────────

function TabToggle({
  value,
  onChange,
}: {
  value: "speed" | "long";
  onChange: (v: "speed" | "long") => void;
}) {
  return (
    <div className="flex p-1 rounded-full bg-elevated border border-hairline">
      {(["speed", "long"] as const).map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className={`flex-1 px-4 py-2 rounded-full text-xs font-semibold transition-all ${
            value === tab
              ? "bg-text-1 text-bg shadow-sm"
              : "text-text-3"
          }`}
        >
          {tab === "speed" ? "Speed" : "Long run"}
        </button>
      ))}
    </div>
  );
}

// ── Status Card ───────────────────────────────────────────────────────────────

function StatusCard({
  paceStatus,
  statusMessage,
}: {
  paceStatus: "on_point" | "needs_work" | "no_data";
  statusMessage: string;
}) {
  if (paceStatus === "no_data") {
    return (
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-base font-bold text-text-1">No data yet</p>
        </div>
        <p className="text-sm text-text-2 leading-relaxed">
          Complete your first speed workout to see pace insights.
        </p>
      </div>
    );
  }

  const isOnPoint = paceStatus === "on_point";

  return (
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-5">
      {/* Target icon */}
      <div className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center mb-4">
        <svg className="w-5 h-5 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1" fill="currentColor" />
        </svg>
      </div>

      <p className="text-base font-bold text-text-1 mb-1">
        {isOnPoint ? "Pace on point" : "Pace needs work"}
      </p>
      <p className="text-sm text-text-2 leading-relaxed mb-6">{statusMessage}</p>

      {/* Glowing checkmark / warning illustration */}
      <div className="flex items-center justify-center py-4">
        <div className="relative flex items-center justify-center">
          {/* Radial glow */}
          <div
            className="absolute w-28 h-28 rounded-full blur-2xl opacity-30"
            style={{ backgroundColor: isOnPoint ? "#22c55e" : "#FFB547" }}
          />
          {/* Outer ring */}
          <div
            className="relative w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: isOnPoint ? "rgba(34,197,94,0.12)" : "rgba(255,181,71,0.12)",
              border: `2px solid ${isOnPoint ? "rgba(34,197,94,0.3)" : "rgba(255,181,71,0.3)"}`,
            }}
          >
            {isOnPoint ? (
              <svg
                className="w-9 h-9"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#22c55e"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg
                className="w-9 h-9"
                fill="none"
                viewBox="0 0 24 24"
                stroke="#FFB547"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pace Chart (SVG) ──────────────────────────────────────────────────────────

interface PaceChartWorkout {
  date: string;
  type?: string;
  minPaceSecKm: number;
  maxPaceSecKm: number;
  actualAvgPace: number | null;
}

function PaceInsightChart({ workouts }: { workouts: PaceChartWorkout[] }) {
  if (workouts.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-sm text-text-3">
        No pace data yet
      </div>
    );
  }

  const SVG_W = 320;
  const SVG_H = 120;
  const PAD_LEFT = 10;
  const PAD_RIGHT = 10;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 28;
  const chartW = SVG_W - PAD_LEFT - PAD_RIGHT;
  const chartH = SVG_H - PAD_TOP - PAD_BOTTOM;

  // Y-axis: pace range across all workouts (inverted — faster=smaller value=higher on chart)
  const allPaces: number[] = workouts.flatMap((w) => [
    w.minPaceSecKm,
    w.maxPaceSecKm,
    ...(w.actualAvgPace != null ? [w.actualAvgPace] : []),
  ]);
  const globalMin = Math.min(...allPaces) - 20;
  const globalMax = Math.max(...allPaces) + 20;
  const paceRange = globalMax - globalMin;

  function paceToY(pace: number): number {
    // Faster pace (lower number) -> top of chart
    return PAD_TOP + ((pace - globalMin) / paceRange) * chartH;
  }

  // X positions
  const n = workouts.length;
  function workoutX(i: number): number {
    if (n === 1) return PAD_LEFT + chartW / 2;
    return PAD_LEFT + (i / (n - 1)) * chartW;
  }

  // The zone band: we use the average target zone across workouts (rough band)
  const zonePaces = workouts.map((w) => ({ min: w.minPaceSecKm, max: w.maxPaceSecKm }));
  const bandMinPace = Math.min(...zonePaces.map((z) => z.min));
  const bandMaxPace = Math.max(...zonePaces.map((z) => z.max));
  const bandTop = paceToY(bandMinPace); // faster pace = top
  const bandBottom = paceToY(bandMaxPace);

  return (
    <div className="w-full overflow-hidden">
      {/* Y-axis labels */}
      <div className="flex flex-col justify-between h-[120px] absolute pointer-events-none" style={{ top: PAD_TOP, left: 0 }}>
      </div>

      <div className="relative">
        {/* Y-axis labels */}
        <div
          className="absolute left-0 flex flex-col justify-between pointer-events-none"
          style={{ top: PAD_TOP, height: chartH }}
        >
          <span className="text-[10px] text-text-3 leading-none">Faster</span>
          <span className="text-[10px] text-text-3 leading-none">Slower</span>
        </div>

        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full"
          style={{ height: SVG_H }}
          aria-hidden="true"
        >
          {/* Target zone band */}
          <rect
            x={PAD_LEFT}
            y={bandTop}
            width={chartW}
            height={Math.max(2, bandBottom - bandTop)}
            fill="rgba(255,255,255,0.06)"
            rx={4}
          />
          <rect
            x={PAD_LEFT}
            y={bandTop}
            width={chartW}
            height={Math.max(2, bandBottom - bandTop)}
            fill="none"
            stroke="rgba(255,255,255,0.12)"
            strokeWidth={1}
            rx={4}
          />

          {/* Per-workout lines and dots */}
          {workouts.map((wo, i) => {
            if (wo.actualAvgPace == null) return null;
            const x = workoutX(i);
            const dotColor = wo.type ? (workoutTypeColor[wo.type] ?? "#9A9A9F") : "#9A9A9F";
            const fastY = paceToY(wo.minPaceSecKm);
            const slowY = paceToY(wo.maxPaceSecKm);
            const avgY = paceToY(wo.actualAvgPace);

            return (
              <g key={i}>
                {/* Vertical line: fastest to slowest */}
                <line
                  x1={x}
                  y1={fastY}
                  x2={x}
                  y2={slowY}
                  stroke={dotColor}
                  strokeWidth={2}
                  strokeLinecap="round"
                  opacity={0.6}
                />
                {/* Fastest dot (top = smaller pace value) */}
                <circle cx={x} cy={fastY} r={4} fill={dotColor} />
                {/* Slowest dot */}
                <circle cx={x} cy={slowY} r={4} fill={dotColor} />
                {/* Avg pace tick */}
                <circle cx={x} cy={avgY} r={2.5} fill="white" opacity={0.9} />
              </g>
            );
          })}

          {/* X-axis date labels */}
          {workouts.map((wo, i) => {
            const x = workoutX(i);
            // Only show every other label when crowded
            if (n > 6 && i % 2 !== 0) return null;
            return (
              <text
                key={i}
                x={x}
                y={SVG_H - 4}
                textAnchor="middle"
                fontSize={9}
                fill="var(--k-text-3)"
                fontFamily="Inter, system-ui, sans-serif"
              >
                {formatDateShort(wo.date)}
              </text>
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-white/10 border border-white/20" />
          <span className="text-[10px] text-text-3">Target zone</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-text-1" />
          <span className="text-[10px] text-text-3">Fastest/slowest rep pace</span>
        </div>
      </div>
    </div>
  );
}

// ── Expandable Section ────────────────────────────────────────────────────────

function ExpandableSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-hairline pt-3 mt-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <span className="text-sm font-semibold text-text-2">{title}</span>
        <svg
          className={`w-4 h-4 text-text-3 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="mt-3 text-sm text-text-2 leading-relaxed">{children}</div>
      )}
    </div>
  );
}

// ── Race Time Card ────────────────────────────────────────────────────────────

function HexBadge({ label }: { label: string }) {
  return (
    <div className="relative w-10 h-10 flex items-center justify-center shrink-0">
      <svg viewBox="0 0 40 40" className="absolute inset-0 w-full h-full" aria-hidden="true">
        <polygon
          points="20,2 38,11 38,29 20,38 2,29 2,11"
          fill="var(--k-elevated)"
          stroke="var(--k-hairline)"
          strokeWidth="1.5"
        />
      </svg>
      <span className="relative text-[9px] font-bold text-text-1 text-center leading-tight">
        {label}
      </span>
    </div>
  );
}

function distanceCategory(distance: string): "short" | "long" {
  const lower = distance.toLowerCase();
  if (lower.includes("5k") || lower.includes("10k") || lower.includes("5 k") || lower.includes("10 k")) {
    return "short";
  }
  return "long";
}

function RaceTimesSection({
  raceTimes,
  onAddTime,
}: {
  raceTimes: RaceTime[];
  onAddTime: (category: "short" | "long") => void;
}) {
  const shortTime = raceTimes.find((r) => distanceCategory(r.distance) === "short") ?? null;
  const longTime = raceTimes.find((r) => distanceCategory(r.distance) === "long") ?? null;

  return (
    <section className="mt-6">
      <h2 className="text-lg font-bold text-text-1 mb-1">Current race times</h2>
      <p className="text-sm text-text-2 leading-relaxed mb-4">
        Include a shorter distance and a longer distance time for more accurate paces in your plan.
      </p>

      <div className="flex flex-col gap-3">
        {/* Long distance */}
        {longTime ? (
          <button
            onClick={() => onAddTime("long")}
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 active:opacity-80 transition-opacity text-left"
          >
            <HexBadge label={longTime.distance} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-3">Half/full marathon time</p>
              <p className="text-sm font-bold text-text-1 tabular-nums mt-0.5">
                {formatTime(longTime.timeSeconds)}
              </p>
            </div>
            <svg className="w-5 h-5 text-text-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => onAddTime("long")}
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-hairline bg-surface/50 p-4 active:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 rounded-full bg-elevated border border-hairline flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-2">Add a half/marathon time</p>
              <p className="text-xs text-text-3 mt-0.5">Half marathon, marathon</p>
            </div>
          </button>
        )}

        {/* Short distance */}
        {shortTime ? (
          <button
            onClick={() => onAddTime("short")}
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] border border-hairline bg-surface p-4 active:opacity-80 transition-opacity text-left"
          >
            <HexBadge label={shortTime.distance} />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-text-3">Short distance time</p>
              <p className="text-sm font-bold text-text-1 tabular-nums mt-0.5">
                {formatTime(shortTime.timeSeconds)}
              </p>
            </div>
            <svg className="w-5 h-5 text-text-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        ) : (
          <button
            onClick={() => onAddTime("short")}
            className="w-full flex items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-hairline bg-surface/50 p-4 active:opacity-80 transition-opacity"
          >
            <div className="w-10 h-10 rounded-full bg-elevated border border-hairline flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-2">Add a 5k/10k time</p>
              <p className="text-xs text-text-3 mt-0.5">5k, 10k</p>
            </div>
          </button>
        )}
      </div>
    </section>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export default function PaceInsightsPage() {
  const router = useRouter();
  const [data, setData] = useState<PaceInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"speed" | "long">("speed");

  useEffect(() => {
    fetch("/api/pace-insights")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function handleAddTime(category: "short" | "long") {
    // TODO: open race time entry modal/sheet
    alert(`Add ${category} race time — coming soon`);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!data?.activePlan) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-text-2">No active plan</p>
        <button
          onClick={() => router.back()}
          className="text-accent text-sm font-semibold"
        >
          Go back
        </button>
      </div>
    );
  }

  const speedWorkouts = data.speedWorkouts ?? [];
  const longWorkouts = data.longWorkouts ?? [];
  const activeWorkouts = activeTab === "speed" ? speedWorkouts : longWorkouts;

  // Date range for the section header
  function getSectionDateRange(workouts: Array<{ date: string }>) {
    if (workouts.length === 0) return null;
    const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date));
    const first = new Date(sorted[0].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    const last = new Date(sorted[sorted.length - 1].date).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    if (sorted.length === 1) return first;
    return `${first} – ${last}`;
  }

  const sectionDateRange = getSectionDateRange(activeWorkouts);

  return (
    <div className="min-h-screen bg-bg">
      <main className="max-w-md mx-auto w-full px-4 pt-10 pb-16">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center"
            aria-label="Back"
          >
            <svg
              className="w-5 h-5 text-text-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center"
            aria-label="Info"
          >
            <svg
              className="w-5 h-5 text-text-2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>

        {/* Title row */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-extrabold text-text-1">Pace Insights</h1>
          <div className="flex items-center gap-1.5 text-xs text-text-3">
            <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span>Updated: {formatUpdatedDate(data.updatedDate)}</span>
          </div>
        </div>

        {/* Status card */}
        <StatusCard paceStatus={data.paceStatus} statusMessage={data.statusMessage} />

        {/* Divider */}
        <div className="h-px bg-hairline my-5" />

        {/* Next speed workout */}
        {data.nextSpeedWorkout && (
          <div className="mb-5">
            <p className="text-xs text-text-3 mb-2 font-semibold uppercase tracking-wide">
              Next speed workout:{" "}
              {new Date(data.nextSpeedWorkout.date).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}
            </p>
            <div className="flex items-center gap-2">
              <div
                className="w-2 h-2 rounded-sm shrink-0"
                style={{ backgroundColor: data.nextSpeedWorkout.color }}
              />
              <span className="text-sm font-semibold text-text-2">
                {data.nextSpeedWorkout.dayLabel}
              </span>
              <span className="text-text-3">·</span>
              <span className="text-sm text-text-2">
                {workoutTypeLabel[data.nextSpeedWorkout.type] ?? data.nextSpeedWorkout.type}
              </span>
              <span className="text-text-3">·</span>
              <span className="text-sm text-text-2">{data.nextSpeedWorkout.targetKm}km</span>
            </div>
          </div>
        )}

        {/* Speed / Long tab toggle */}
        <TabToggle value={activeTab} onChange={setActiveTab} />

        {/* Pace on point section */}
        <section className="mt-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold text-text-1">
                {activeTab === "speed" ? "Speed run pace" : "Long run pace"}
              </h2>
              {sectionDateRange && (
                <p className="text-xs text-text-3 mt-0.5">{sectionDateRange}</p>
              )}
            </div>
            <button className="w-7 h-7 rounded-full flex items-center justify-center" aria-label="Info">
              <svg className="w-4 h-4 text-text-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>

          {activeWorkouts.length > 0 ? (
            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
              <PaceInsightChart
                workouts={activeWorkouts.map((wo) => ({
                  date: wo.date,
                  type: "type" in wo ? (wo as SpeedWorkout).type : "long",
                  minPaceSecKm: wo.minPaceSecKm,
                  maxPaceSecKm: wo.maxPaceSecKm,
                  actualAvgPace: wo.actualAvgPace,
                }))}
              />
            </div>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-6 text-center">
              <p className="text-sm text-text-3">No pace data yet</p>
              <p className="text-xs text-text-3 mt-1">
                {activeTab === "speed"
                  ? "Complete a speed workout to see your pace chart."
                  : "Complete a long run to see your pace chart."}
              </p>
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="h-px bg-hairline my-5" />

        {/* Explanation section */}
        <section>
          {activeTab === "speed" ? (
            <div>
              <h2 className="text-base font-bold text-text-1 mb-2">Speed run pace</h2>
              <p className="text-sm text-text-2 leading-relaxed">
                We monitor your pace in speed runs to understand how fast you can run over shorter distances.
              </p>
              <ExpandableSection title="Types of speed runs">
                <ul className="flex flex-col gap-2 text-sm text-text-2 list-none">
                  <li>
                    <span className="font-semibold" style={{ color: workoutTypeColor.tempo }}>Tempo runs</span>
                    {" "}— Sustained effort at a comfortably hard pace, typically 20–40 minutes.
                  </li>
                  <li>
                    <span className="font-semibold" style={{ color: workoutTypeColor.interval }}>Interval runs</span>
                    {" "}— Repeated hard efforts with recovery jogs in between to build speed and VO2 max.
                  </li>
                </ul>
              </ExpandableSection>
            </div>
          ) : (
            <div>
              <h2 className="text-base font-bold text-text-1 mb-2">Long run pace</h2>
              <p className="text-sm text-text-2 leading-relaxed">
                We monitor your pace in long runs to understand your endurance over longer distances.
              </p>
              <ExpandableSection title="Incompatible runs">
                <p className="text-sm text-text-2 leading-relaxed">
                  Runs with GPS signal issues, incomplete recordings, or distances under 10km are excluded from the long run pace chart to keep the data reliable.
                </p>
              </ExpandableSection>
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="h-px bg-hairline my-5" />

        {/* Race times */}
        <RaceTimesSection raceTimes={data.raceTimes} onAddTime={handleAddTime} />
      </main>
    </div>
  );
}
