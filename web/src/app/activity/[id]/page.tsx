"use client";

import { useState, useEffect, useMemo, useRef, use } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Zap,
  AlertCircle,
  Activity as ActivityIcon,
  Share2,
  Sparkles,
  RefreshCw,
  Footprints,
  Watch,
} from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { displayDistance, distanceUnitLabel, displayPace, paceUnitLabel } from "@/lib/units";
import { apiFetch } from "@/lib/api";
import { useSwipeBack } from "@/lib/useSwipeBack";
import { getUserZoneBounds, computeZoneSeconds, formatZoneTime } from "@/lib/hr-zone-time";
import { decodePolyline, polylineToPath } from "@/lib/polyline";
import { workoutColor } from "@/lib/workout-colors";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PlannedWorkoutBlock {
  type: string;
  distanceKm?: number;
  durationMinutes?: number;
  targetPaceSecKm?: number;
  reps?: number;
  repDistanceKm?: number;
}

interface ActivityDetail {
  id: string;
  stravaId: string;
  source: "strava" | "garmin" | "manual";
  name: string;
  date: string;
  distanceKm: number;
  durationSeconds: number;
  avgPaceSecKm: number;
  maxPaceSecKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  elevationGain: number | null;
  maxElevation: number | null;
  polyline: string | null;
  cadenceSpm: number | null;
  calories: number | null;
  deviceName: string | null;
  gearName: string | null;
  aiInsight: string | null;
  splits: Array<{ km: number; paceSecKm: number; elevationDiff: number; avgHr?: number }>;
  laps: Array<{ index: number; distanceKm: number; durationSeconds: number; paceSecKm: number; avgHr?: number; maxHr?: number }>;
  streams: {
    distance: number[];
    heartrate?: number[];
    velocity?: number[];
    altitude?: number[];
    time: number[];
  } | null;
  bestEfforts: Array<{ name: string; distance: number; elapsedTime: number; movingTime: number }>;
  plannedWorkout: {
    id: string;
    type: string;
    title: string;
    blocks: PlannedWorkoutBlock[];
  } | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatPace(secPerKm: number): string {
  if (!secPerKm || secPerKm <= 0) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  if (m > 0) return `${m}m ${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

function formatEffortTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

// ── Smooth area chart via SVG ─────────────────────────────────────────────────

interface AreaChartProps {
  data: number[];
  xData?: number[];
  width?: number;
  height?: number;
  fillColor: string;
  lineColor: string;
  gradientId: string;
  invertY?: boolean;
  yLabel?: string;
  xLabel?: string;
  xTickCount?: number;
  yTickCount?: number;
  xFormatter?: (v: number) => string;
  yFormatter?: (v: number) => string;
}

function AreaChart({
  data,
  xData,
  height = 120,
  fillColor,
  lineColor,
  gradientId,
  invertY = false,
  xTickCount = 5,
  yTickCount = 4,
  xFormatter = (v) => v.toFixed(1),
  yFormatter = (v) => v.toFixed(0),
}: AreaChartProps) {
  if (!data || data.length < 2) {
    return (
      <div className="flex h-28 items-center justify-center text-[13px] text-text-3">
        No data
      </div>
    );
  }

  // Downsample for performance — max 200 points
  const maxPoints = 200;
  const step = Math.max(1, Math.floor(data.length / maxPoints));
  const sampled = data.filter((_, i) => i % step === 0);
  const sampledX = xData ? xData.filter((_, i) => i % step === 0) : sampled.map((_, i) => i);

  const minY = Math.min(...sampled);
  const maxY = Math.max(...sampled);
  const rangeY = maxY - minY || 1;
  const minX = sampledX[0];
  const maxX = sampledX[sampledX.length - 1];
  const rangeX = maxX - minX || 1;

  const PAD_LEFT = 36;
  const PAD_RIGHT = 8;
  const PAD_TOP = 8;
  const PAD_BOT = 22;
  const W = 320;
  const H = height;
  const chartW = W - PAD_LEFT - PAD_RIGHT;
  const chartH = H - PAD_TOP - PAD_BOT;

  function toX(xv: number) {
    return PAD_LEFT + ((xv - minX) / rangeX) * chartW;
  }

  function toY(yv: number) {
    const norm = (yv - minY) / rangeY;
    return invertY
      ? PAD_TOP + norm * chartH        // lower value = higher on chart
      : PAD_TOP + (1 - norm) * chartH; // higher value = higher on chart
  }

  // Build polyline path
  const pts = sampled.map((y, i) => `${toX(sampledX[i]).toFixed(1)},${toY(y).toFixed(1)}`);
  const linePath = `M ${pts.join(" L ")}`;

  const firstX = toX(sampledX[0]).toFixed(1);
  const lastX = toX(sampledX[sampledX.length - 1]).toFixed(1);
  const baseY = (PAD_TOP + chartH).toFixed(1);
  const areaPath = `${linePath} L ${lastX},${baseY} L ${firstX},${baseY} Z`;

  // Y gridlines
  const yTicks: number[] = [];
  for (let i = 0; i <= yTickCount; i++) {
    yTicks.push(minY + (rangeY / yTickCount) * i);
  }

  // X ticks
  const xTicks: number[] = [];
  for (let i = 0; i <= xTickCount; i++) {
    xTicks.push(minX + (rangeX / xTickCount) * i);
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      aria-hidden="true"
      style={{ overflow: "visible" }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={fillColor} stopOpacity="0.35" />
          <stop offset="100%" stopColor={fillColor} stopOpacity="0.02" />
        </linearGradient>
        <clipPath id={`clip-${gradientId}`}>
          <rect x={PAD_LEFT} y={PAD_TOP} width={chartW} height={chartH} />
        </clipPath>
      </defs>

      {/* Gridlines */}
      {yTicks.map((tick, i) => {
        const y = toY(tick);
        return (
          <g key={i}>
            <line
              x1={PAD_LEFT}
              y1={y}
              x2={PAD_LEFT + chartW}
              y2={y}
              stroke="var(--k-hairline)"
              strokeWidth="0.5"
            />
            <text
              x={PAD_LEFT - 4}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="9"
              fill="var(--k-text-3)"
            >
              {yFormatter(tick)}
            </text>
          </g>
        );
      })}

      {/* Area fill */}
      <path
        d={areaPath}
        fill={`url(#${gradientId})`}
        clipPath={`url(#clip-${gradientId})`}
      />

      {/* Line */}
      <path
        d={linePath}
        fill="none"
        stroke={lineColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        clipPath={`url(#clip-${gradientId})`}
      />

      {/* X axis labels */}
      {xTicks.map((tick, i) => {
        const x = toX(tick);
        return (
          <text
            key={i}
            x={x}
            y={H - 4}
            textAnchor="middle"
            fontSize="9"
            fill="var(--k-text-3)"
          >
            {xFormatter(tick)}
          </text>
        );
      })}
    </svg>
  );
}

// ── Route Map Hero ────────────────────────────────────────────────────────────
// Benchmark-style minimal route thumbnail: the decoded summary polyline drawn as
// an inline SVG — no tile servers, works offline and inside the PWA's CSP.

function RouteMap({ polyline, color }: { polyline: string; color: string }) {
  const projected = useMemo(() => {
    const points = decodePolyline(polyline);
    return polylineToPath(points, 320, 200, 16);
  }, [polyline]);

  if (!projected) return null;
  const { path, start, end } = projected;

  return (
    <div className="k-card overflow-hidden">
      <svg viewBox="0 0 320 200" width="100%" height="200" aria-label="Route map" role="img">
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeOpacity="0.25"
          strokeWidth="6"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Start: hollow dot · Finish: solid dot */}
        <circle cx={start[0]} cy={start[1]} r="5" fill="var(--k-surface)" stroke={color} strokeWidth="2.5" />
        <circle cx={end[0]} cy={end[1]} r="5" fill={color} stroke="var(--k-surface)" strokeWidth="2" />
      </svg>
    </div>
  );
}

// ── Summary Stats ─────────────────────────────────────────────────────────────

function SummaryStats({ activity }: { activity: ActivityDetail }) {
  const secondRow: Array<{ label: string; value: string; unit?: string }> = [];
  if (activity.avgHr != null)
    secondRow.push({ label: "Avg HR", value: `${Math.round(activity.avgHr)}`, unit: "bpm" });
  if (activity.cadenceSpm != null)
    secondRow.push({ label: "Cadence", value: `${activity.cadenceSpm}`, unit: "spm" });
  if (activity.calories != null)
    secondRow.push({ label: "Calories", value: `${activity.calories}`, unit: "kcal" });
  if (secondRow.length < 3 && activity.elevationGain != null)
    secondRow.push({ label: "Elev Gain", value: `${Math.round(activity.elevationGain)}`, unit: "m" });

  return (
    <div className="k-card p-4">
      <div className="grid grid-cols-3 divide-x divide-hairline">
        <div className="pr-3 text-center">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">Distance</p>
          <p className="text-[22px] font-extrabold tabular-nums text-text-1">{displayDistance(activity.distanceKm, 2).toFixed(2)}</p>
          <p className="text-[10px] text-text-3">{distanceUnitLabel()}</p>
        </div>
        <div className="px-3 text-center">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">Time</p>
          <p className="text-[22px] font-extrabold leading-none tabular-nums text-text-1">{formatDuration(activity.durationSeconds)}</p>
        </div>
        <div className="pl-3 text-center">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">Avg Pace</p>
          <p className="text-[22px] font-extrabold tabular-nums text-text-1">{formatPace(displayPace(activity.avgPaceSecKm))}</p>
          <p className="text-[10px] text-text-3">{paceUnitLabel()}</p>
        </div>
      </div>
      {secondRow.length > 0 && (
        <div
          className="mt-4 grid divide-x divide-hairline border-t border-hairline pt-4"
          style={{ gridTemplateColumns: `repeat(${secondRow.length}, minmax(0, 1fr))` }}
        >
          {secondRow.map((stat) => (
            <div key={stat.label} className="px-2 text-center first:pl-0 last:pr-0">
              <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">{stat.label}</p>
              <p className="text-[17px] font-bold tabular-nums text-text-1">{stat.value}</p>
              {stat.unit && <p className="text-[10px] text-text-3">{stat.unit}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Share ─────────────────────────────────────────────────────────────────────

function ShareButton({ activity }: { activity: ActivityDetail }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    haptic("light");
    const dateStr = new Date(activity.date).toLocaleDateString("en-US", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    const text = `${activity.name} — ${displayDistance(activity.distanceKm, 2).toFixed(2)} ${distanceUnitLabel()} in ${formatDuration(activity.durationSeconds)} (${formatPace(displayPace(activity.avgPaceSecKm))}${paceUnitLabel()}) · ${dateStr}`;
    const url = window.location.href;

    if (navigator.share) {
      try {
        await navigator.share({ title: activity.name, text, url });
      } catch {
        // User cancelled the share sheet — not an error.
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      haptic("success");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      haptic("warning");
    }
  }

  return (
    <Button variant="secondary" full onClick={share}>
      <span className="flex items-center justify-center gap-2">
        <Share2 className="h-4 w-4" strokeWidth={2} />
        {copied ? "Copied" : "Share run"}
      </span>
    </Button>
  );
}

// ── AI Workout Insights ───────────────────────────────────────────────────────
// Generated once server-side (cached on the activity row); hidden entirely
// when the server has no API key configured (501).

function InsightsCard({
  activityId,
  initialInsight,
  hrZones,
}: {
  activityId: string;
  initialInsight: string | null;
  hrZones: Array<{ label: string; pct: number }>;
}) {
  const [insight, setInsight] = useState<string | null>(initialInsight);
  const [generating, setGenerating] = useState(!initialInsight);
  const [hidden, setHidden] = useState(false);
  const requested = useRef(false);

  async function generate(regenerate: boolean) {
    setGenerating(true);
    try {
      const res = await apiFetch(`/api/activities/${activityId}/insights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate, hrZones }),
      });
      if (res.status === 501) {
        setHidden(true);
        return;
      }
      if (!res.ok) throw new Error();
      const data: { insight: string } = await res.json();
      setInsight(data.insight);
    } catch {
      // Keep whatever we had; if nothing, hide rather than show a broken card.
      if (!insight) setHidden(true);
    } finally {
      setGenerating(false);
    }
  }

  useEffect(() => {
    if (initialInsight || requested.current) return;
    requested.current = true;
    generate(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityId]);

  if (hidden) return null;

  return (
    <div className="k-card relative overflow-hidden p-4">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden="true"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--k-accent) 16%, transparent), transparent 65%)",
        }}
      />
      <div className="relative">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" strokeWidth={2} />
            <h2 className="text-[15px] font-bold text-text-1">Workout Insights</h2>
          </div>
          {insight && (
            <button
              onClick={() => {
                haptic("light");
                generate(true);
              }}
              disabled={generating}
              className="press flex h-8 w-8 items-center justify-center rounded-full text-text-3 disabled:opacity-50"
              aria-label="Regenerate insights"
            >
              <RefreshCw className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} strokeWidth={2} />
            </button>
          )}
        </div>
        {generating && !insight ? (
          <p className="text-[14px] text-text-3">Generating…</p>
        ) : (
          <p className="text-[14px] leading-relaxed text-text-2">{insight}</p>
        )}
      </div>
    </div>
  );
}

// ── Source & gear rows ────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<ActivityDetail["source"], string> = {
  strava: "Strava",
  garmin: "Garmin",
  manual: "Manual entry",
};

function SourceGearRows({ activity }: { activity: ActivityDetail }) {
  const sourceLabel =
    activity.deviceName != null
      ? `${SOURCE_LABELS[activity.source]} · ${activity.deviceName}`
      : SOURCE_LABELS[activity.source];

  return (
    <div className="divide-y divide-hairline overflow-hidden k-card">
      {activity.stravaId && (
        <a
          href={`https://www.strava.com/activities/${activity.stravaId}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => haptic("light")}
          className="press flex items-center gap-3 px-4 py-3"
        >
          <ExternalLink className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.75} />
          <span className="flex-1 text-[15px] font-medium text-text-1">View on Strava</span>
          <ChevronRight className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
        </a>
      )}
      <div className="flex items-center gap-3 px-4 py-3">
        <Watch className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.75} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-text-3">Recorded with</p>
          <p className="truncate text-[15px] font-medium text-text-1">{sourceLabel}</p>
        </div>
      </div>
      {activity.gearName && (
        <div className="flex items-center gap-3 px-4 py-3">
          <Footprints className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.75} />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] text-text-3">Shoes</p>
            <p className="truncate text-[15px] font-medium text-text-1">{activity.gearName}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Best Efforts ──────────────────────────────────────────────────────────────

const EFFORT_ORDER = ["400m", "1k", "1 mile", "2 mile", "5k", "10k", "Half-Marathon", "Marathon"];

function BestEfforts({ efforts }: { efforts: ActivityDetail["bestEfforts"] }) {
  if (efforts.length === 0) return null;

  const sorted = [...efforts].sort((a, b) => {
    const ai = EFFORT_ORDER.findIndex((e) => a.name.toLowerCase().includes(e.toLowerCase()));
    const bi = EFFORT_ORDER.findIndex((e) => b.name.toLowerCase().includes(e.toLowerCase()));
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Best Efforts</h2>
      <div className="divide-y divide-hairline overflow-hidden k-card">
        {sorted.map((effort, i) => {
          const pacePerKm = effort.distance > 0 ? (effort.elapsedTime / (effort.distance / 1000)) : 0;
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Zap className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-text-1">{effort.name}</p>
                <p className="text-[13px] tabular-nums text-text-3">{formatPace(displayPace(pacePerKm))}{paceUnitLabel()}</p>
              </div>
              <p className="shrink-0 text-[15px] font-bold tabular-nums text-text-1">{formatEffortTime(effort.elapsedTime)}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[11px] leading-snug text-text-3">
        Best efforts are calculated using total time, not moving time.
      </p>
    </div>
  );
}

// ── Planned Workout ───────────────────────────────────────────────────────────

const BLOCK_LABELS: Record<string, string> = {
  warmup: "Warm-up",
  work: "Session",
  recovery: "Recovery jog",
  cooldown: "Cool-down",
};

function PlannedWorkoutSection({ workout }: { workout: NonNullable<ActivityDetail["plannedWorkout"]> }) {
  const [showAll, setShowAll] = useState(false);

  const blocks = workout.blocks ?? [];
  const displayBlocks = showAll ? blocks : blocks.slice(0, 3);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-text-1">Planned Workout</h2>
      </div>

      <div className="overflow-hidden k-card">
        <div className="divide-y divide-hairline">
          {displayBlocks.map((block, i) => {
            const isWork = block.type === "work";
            const isRepSet = isWork && block.reps && block.repDistanceKm;
            return (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <ActivityIcon className="mt-0.5 h-4 w-4 shrink-0 text-text-3" strokeWidth={1.75} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-[15px] font-medium text-text-1">
                      {BLOCK_LABELS[block.type] ?? block.type}
                    </p>
                    {isRepSet && (
                      <span className="rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                        ×{block.reps}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[13px] text-text-3">
                    {isRepSet
                      ? `${block.reps}×${Math.round((block.repDistanceKm ?? 0) * 1000)}m`
                      : block.distanceKm
                      ? `${displayDistance(block.distanceKm)}${distanceUnitLabel()}`
                      : block.durationMinutes
                      ? `${block.durationMinutes} min`
                      : ""}
                    {block.targetPaceSecKm ? ` · ${formatPace(displayPace(block.targetPaceSecKm))}${paceUnitLabel()}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {blocks.length > 3 && (
          <button
            onClick={() => {
              haptic("light");
              setShowAll(!showAll);
            }}
            className="press w-full border-t border-hairline py-3 text-center text-[13px] font-semibold text-accent"
          >
            {showAll ? "Show less" : `Show ${blocks.length - 3} more`}
          </button>
        )}

        <div className="border-t border-hairline px-4 py-3">
          <TransitionLink
            href={`/workout/${workout.id}`}
            className="press flex items-center justify-center gap-1.5 text-[13px] font-semibold text-text-2"
          >
            View full workout
            <ChevronRight className="h-3 w-3" strokeWidth={2.5} />
          </TransitionLink>
        </div>
      </div>
    </div>
  );
}

// ── Laps Bar Chart ────────────────────────────────────────────────────────────

function LapsSection({
  laps,
  targetPaceSecKm,
}: {
  laps: ActivityDetail["laps"];
  targetPaceSecKm?: number | null;
}) {
  if (laps.length === 0) return null;

  // For pace bars: slower pace (higher secPerKm) = shorter bar. We invert.
  const fastestPace = Math.min(...laps.map((l) => l.paceSecKm));
  const slowestPace = Math.max(...laps.map((l) => l.paceSecKm));
  const paceRange = slowestPace - fastestPace || 1;

  // Bar width = how fast relative to slowest. Faster = wider.
  function lapBarPct(pace: number) {
    return Math.round(((slowestPace - pace) / paceRange) * 70 + 30);
  }

  function paceColor(pace: number) {
    if (!targetPaceSecKm) return "#4ADE80";
    const diff = pace - targetPaceSecKm;
    if (diff <= 5) return "#4ADE80";  // within / better
    if (diff <= 15) return "#60A5FA"; // close
    return "#F87171";                 // slow
  }

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Laps</h2>

      {/* Bar chart */}
      <div className="mb-3 k-card p-4">
        <div className="flex flex-col gap-2">
          {laps.map((lap, i) => {
            const barPct = lapBarPct(lap.paceSecKm);
            const color = paceColor(lap.paceSecKm);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 shrink-0 text-right text-[10px] tabular-nums text-text-3">{lap.index}</span>
                <div className="relative h-6 flex-1 overflow-hidden rounded-sm bg-elevated">
                  <div
                    className="absolute inset-y-0 left-0 flex items-center rounded-sm px-2"
                    style={{ width: `${barPct}%`, backgroundColor: color + "33" }}
                  >
                    <div
                      className="absolute inset-y-0 left-0 rounded-sm"
                      style={{ width: "100%", backgroundColor: color + "55" }}
                    />
                  </div>
                  {/* Target pace overlay */}
                  {targetPaceSecKm && (
                    <div
                      className="absolute inset-y-0 rounded-sm opacity-40"
                      style={{
                        left: `${lapBarPct(targetPaceSecKm)}%`,
                        width: "2px",
                        backgroundColor: "var(--k-text-1)",
                      }}
                    />
                  )}
                  <span className="relative z-10 pl-2 text-[10px] font-semibold tabular-nums" style={{ color }}>
                    {formatPace(displayPace(lap.paceSecKm))}{paceUnitLabel()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail table */}
      <div className="overflow-hidden k-card">
        <div className="grid grid-cols-4 border-b border-hairline px-4 py-2">
          {["LAP", "DIST", "TIME", "PACE"].map((h) => (
            <p key={h} className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-3 first:text-left">{h}</p>
          ))}
        </div>
        <div className="divide-y divide-hairline">
          {laps.map((lap, i) => {
            const color = paceColor(lap.paceSecKm);
            return (
              <div key={i} className="grid grid-cols-4 items-center px-4 py-2.5">
                <span className="text-[13px] font-semibold text-text-2">{lap.index}</span>
                <span className="text-right text-[13px] tabular-nums text-text-1">{displayDistance(lap.distanceKm, 2).toFixed(2)}{distanceUnitLabel()}</span>
                <span className="text-right text-[13px] tabular-nums text-text-1">{formatDuration(lap.durationSeconds)}</span>
                <div className="flex justify-end">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                    style={{ color, backgroundColor: color + "22" }}
                  >
                    {formatPace(displayPace(lap.paceSecKm))}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Splits Section ────────────────────────────────────────────────────────────

function SplitsSection({ splits }: { splits: ActivityDetail["splits"] }) {
  if (splits.length === 0) return null;

  const maxPace = Math.max(...splits.map((s) => s.paceSecKm));
  const minPace = Math.min(...splits.map((s) => s.paceSecKm));
  const paceRange = maxPace - minPace || 1;

  // Bar width: faster = wider (invert pace)
  function barPct(pace: number) {
    return Math.round(((maxPace - pace) / paceRange) * 60 + 40);
  }

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Splits</h2>
      <div className="overflow-hidden k-card">
        <div className="grid grid-cols-[2rem_1fr_3rem] gap-2 border-b border-hairline px-4 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">KM</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">AVG PACE</p>
          <p className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-3">+/-</p>
        </div>
        <div className="divide-y divide-hairline">
          {splits.map((split, i) => {
            const prevPace = i > 0 ? splits[i - 1].paceSecKm : null;
            const diff = prevPace != null ? Math.round(displayPace(split.paceSecKm - prevPace)) : null;
            const diffStr =
              diff == null
                ? "—"
                : diff === 0
                ? "±0s"
                : diff > 0
                ? `+${Math.abs(diff)}s`
                : `-${Math.abs(diff)}s`;
            const diffColor =
              diff == null ? "var(--k-text-3)" : diff < 0 ? "#4ADE80" : diff > 0 ? "#F87171" : "var(--k-text-2)";

            return (
              <div key={i} className="grid grid-cols-[2rem_1fr_3rem] items-center gap-2 px-4 py-2">
                <span className="text-[13px] font-semibold tabular-nums text-text-2">{split.km}</span>
                <div className="relative flex h-6 items-center">
                  <div
                    className="absolute inset-y-0 left-0 flex items-center rounded-sm"
                    style={{
                      width: `${barPct(split.paceSecKm)}%`,
                      backgroundColor: "#F87171" + "33",
                    }}
                  />
                  <span className="relative z-10 pl-1 text-[11px] font-semibold tabular-nums text-text-1">
                    {formatPace(displayPace(split.paceSecKm))}{paceUnitLabel()}
                  </span>
                </div>
                <span
                  className="text-right text-[11px] font-bold tabular-nums"
                  style={{ color: diffColor }}
                >
                  {diffStr}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Pace Chart Section ────────────────────────────────────────────────────────

function PaceChartSection({ activity }: { activity: ActivityDetail }) {
  const streams = activity.streams;
  if (!streams?.velocity || streams.velocity.length < 2) return null;

  // Convert velocity (m/s) to pace (sec/km)
  const paceData = streams.velocity.map((v) => (v > 0.5 ? 1000 / v : 0)).filter((p) => p > 0 && p < 1200);
  const distData = streams.distance
    ? streams.distance.slice(0, paceData.length).map((d) => d / 1000)
    : paceData.map((_, i) => i / paceData.length * activity.distanceKm);

  if (paceData.length < 2) return null;

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Pace</h2>
      <div className="k-card p-4">
        <AreaChart
          data={paceData}
          xData={distData}
          fillColor="#2DD4BF"
          lineColor="#14B8A6"
          gradientId="pace-gradient"
          invertY={true}
          xFormatter={(v) => `${displayDistance(v).toFixed(1)}${distanceUnitLabel()}`}
          yFormatter={(v) => formatPace(displayPace(v))}
          height={120}
        />
        <div className="mt-3 flex gap-6 border-t border-hairline pt-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-3">Avg Pace</p>
            <p className="text-[15px] font-bold tabular-nums text-text-1">{formatPace(displayPace(activity.avgPaceSecKm))}{paceUnitLabel()}</p>
          </div>
          {activity.maxPaceSecKm != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Pace</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{formatPace(displayPace(activity.maxPaceSecKm))}{paceUnitLabel()}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Elevation Chart Section ───────────────────────────────────────────────────

function ElevationChartSection({ activity }: { activity: ActivityDetail }) {
  const streams = activity.streams;
  if (!streams?.altitude || streams.altitude.length < 2) return null;

  const distData = streams.distance
    ? streams.distance.map((d) => d / 1000)
    : streams.altitude.map((_, i) => (i / streams.altitude!.length) * activity.distanceKm);

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Elevation</h2>
      <div className="k-card p-4">
        <AreaChart
          data={streams.altitude}
          xData={distData}
          fillColor="#60A5FA"
          lineColor="#3B82F6"
          gradientId="elev-gradient"
          invertY={false}
          xFormatter={(v) => `${displayDistance(v).toFixed(1)}${distanceUnitLabel()}`}
          yFormatter={(v) => `${Math.round(v)}m`}
          height={120}
        />
        <div className="mt-3 flex gap-6 border-t border-hairline pt-3">
          {activity.elevationGain != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Elevation Gain</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{Math.round(activity.elevationGain)}m</p>
            </div>
          )}
          {activity.maxElevation != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Elevation</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{Math.round(activity.maxElevation)}m</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Heart Rate Chart Section ──────────────────────────────────────────────────

function HeartRateChartSection({ activity }: { activity: ActivityDetail }) {
  const streams = activity.streams;
  if (!streams?.heartrate || streams.heartrate.length < 2) return null;

  const distData = streams.distance
    ? streams.distance.map((d) => d / 1000)
    : streams.heartrate.map((_, i) => (i / streams.heartrate!.length) * activity.distanceKm);

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Heart Rate</h2>
      <div className="k-card p-4">
        <AreaChart
          data={streams.heartrate}
          xData={distData}
          fillColor="#F87171"
          lineColor="#EF4444"
          gradientId="hr-gradient"
          invertY={false}
          xFormatter={(v) => `${displayDistance(v).toFixed(1)}${distanceUnitLabel()}`}
          yFormatter={(v) => `${Math.round(v)}`}
          height={120}
        />
        <div className="mt-3 flex gap-6 border-t border-hairline pt-3">
          {activity.avgHr != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Avg Heart Rate</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{Math.round(activity.avgHr)} bpm</p>
            </div>
          )}
          {activity.maxHr != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Heart Rate</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{Math.round(activity.maxHr)} bpm</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── HR Zones Section ──────────────────────────────────────────────────────────

function HrZonesSection({ activity }: { activity: ActivityDetail }) {
  const streams = activity.streams;
  if (!streams?.heartrate || streams.heartrate.length < 2) return null;

  const zoneBounds = getUserZoneBounds();
  const zones = computeZoneSeconds(streams.heartrate, streams.time, zoneBounds);
  const anyTime = zones.some((z) => z.seconds > 0);
  if (!anyTime) return null;

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Heart Rate Zones</h2>
      <div className="divide-y divide-hairline overflow-hidden k-card">
        {zones.map((zone, i) => (
          <div key={i} className="px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} />
                <span className="text-[13px] font-semibold text-text-1">{zone.label} · {zone.name}</span>
                <span className="text-[10px] tabular-nums text-text-3">
                  {i === 4 ? `${zone.minHr}+` : `${zone.minHr}–${zone.maxHr}`} bpm
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] tabular-nums text-text-3">{zone.pct}%</span>
                <span className="w-14 text-right text-[13px] tabular-nums text-text-2">{formatZoneTime(zone.seconds)}</span>
              </div>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${zone.pct}%`,
                  backgroundColor: zone.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Link to a planned workout (manual fallback for unmatched activities) ─────

interface LinkCandidates {
  runs: Array<{ id: string; date: string; type: string; title: string; targetKm: number | null; status: string }>;
  strength: Array<{ id: string; date: string; type: string; title: string; status: string; linked: boolean }>;
}

function LinkActivitySection({ activityId, onLinked }: { activityId: string; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<LinkCandidates | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function openSheet() {
    haptic("light");
    setOpen(true);
    setErr(null);
    if (cands) return;
    try {
      const res = await apiFetch(`/api/activities/${activityId}/candidates`);
      if (!res.ok) throw new Error();
      setCands(await res.json());
    } catch {
      setErr("Couldn't load nearby workouts.");
    }
  }

  async function link(body: { workoutId: string } | { strengthSessionId: string }) {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await apiFetch(`/api/activities/${activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      haptic("success");
      setOpen(false);
      onLinked();
    } catch {
      setErr("Couldn't link — try again.");
    } finally {
      setBusy(false);
    }
  }

  const dayLabel = (d: string) =>
    new Date(d).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="k-card p-4">
      <p className="text-[15px] font-bold text-text-1">Not linked to your plan</p>
      <p className="mt-0.5 text-[13px] text-text-3">
        Attach this activity to a planned session so your week counts it.
      </p>
      <Button variant="secondary" full className="mt-3" onClick={openSheet}>
        Link to a workout
      </Button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Link activity">
        <div className="max-h-[60dvh] overflow-y-auto px-4 pb-6">
          {err && (
            <p className="mb-3 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">{err}</p>
          )}
          {!cands && !err && <Skeleton className="h-24" />}
          {cands && cands.runs.length === 0 && cands.strength.length === 0 && (
            <p className="py-6 text-center text-[14px] text-text-3">
              No planned sessions within 3 days of this activity.
            </p>
          )}
          {cands && cands.runs.length > 0 && (
            <div className="mb-4">
              <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">Runs</p>
              <div className="flex flex-col gap-1.5">
                {cands.runs.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    disabled={busy}
                    onClick={() => link({ workoutId: w.id })}
                    className="press rounded-[var(--radius-input)] bg-elevated px-3.5 py-2.5 text-left disabled:opacity-50"
                  >
                    <span className="block text-[15px] font-semibold text-text-1">{w.title}</span>
                    <span className="block text-[12px] text-text-3">
                      {dayLabel(w.date)}{w.targetKm ? ` · ${displayDistance(w.targetKm)} ${distanceUnitLabel()}` : ""}{w.status === "completed" ? " · already completed" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {cands && cands.strength.length > 0 && (
            <div>
              <p className="mb-1.5 text-[13px] font-semibold uppercase tracking-wide text-text-3">Strength</p>
              <div className="flex flex-col gap-1.5">
                {cands.strength.map((sess) => (
                  <button
                    key={sess.id}
                    type="button"
                    disabled={busy || sess.linked}
                    onClick={() => link({ strengthSessionId: sess.id })}
                    className="press rounded-[var(--radius-input)] bg-elevated px-3.5 py-2.5 text-left disabled:opacity-40"
                  >
                    <span className="block text-[15px] font-semibold text-text-1">{sess.title}</span>
                    <span className="block text-[12px] text-text-3">
                      {dayLabel(sess.date)}{sess.linked ? " · linked to another activity" : ""}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}

// ── Loading Skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="Activity"
        large={false}
        left={
          <TransitionLink href="/activities" className="press flex items-center gap-0.5 text-[17px] font-medium text-accent">
            <ChevronLeft className="h-6 w-6" strokeWidth={2} />
            Activities
          </TransitionLink>
        }
      />
      <div className="flex flex-col gap-4 px-4 pb-tabbar">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
        <Skeleton className="h-48" />
      </div>
    </main>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  useSwipeBack();
  const { id } = use(params);
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function reload() {
    try {
      const res = await apiFetch(`/api/activities/${id}`);
      if (!res.ok) throw new Error("Not found");
      const data: ActivityDetail = await res.json();
      setActivity(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Zone split for the insights prompt (zone bounds are a device-side setting,
  // so the server can't compute this itself).
  const hrZoneSummary = useMemo(() => {
    const s = activity?.streams;
    if (!s?.heartrate || s.heartrate.length < 2) return [];
    const zones = computeZoneSeconds(s.heartrate, s.time, getUserZoneBounds());
    return zones.map((z) => ({ label: z.label, pct: z.pct }));
  }, [activity]);

  if (loading) return <LoadingSkeleton />;

  if (!activity || error) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar
          title="Activity"
          large={false}
          left={
            <TransitionLink href="/activities" className="press flex items-center gap-0.5 text-[17px] font-medium text-accent">
              <ChevronLeft className="h-6 w-6" strokeWidth={2} />
              Activities
            </TransitionLink>
          }
        />
        <div className="px-4 pb-tabbar">
          <EmptyState
            icon={<AlertCircle className="h-10 w-10" strokeWidth={1.5} />}
            title="Activity not found"
            message="We couldn't load this activity. It may have been deleted or you may have lost connection."
            action={
              <TransitionLink href="/activities">
                <Button variant="secondary">Back to Activities</Button>
              </TransitionLink>
            }
          />
        </div>
      </main>
    );
  }

  const activityDate = new Date(activity.date);
  const dateStr = activityDate.toLocaleDateString("en-US", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  const timeStr = activityDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  // Get target pace from planned workout's work block if linked
  const targetPaceSecKm =
    activity.plannedWorkout?.blocks.find((b) => b.type === "work")?.targetPaceSecKm ?? null;

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title={activity.name}
        large={false}
        left={
          <TransitionLink href="/activities" className="press flex items-center gap-0.5 text-[17px] font-medium text-accent">
            <ChevronLeft className="h-6 w-6" strokeWidth={2} />
            Activities
          </TransitionLink>
        }
        right={
          <button
            onClick={() => {
              haptic("light");
              setMenuOpen(true);
            }}
            className="press flex h-9 w-9 items-center justify-center rounded-full text-text-2"
            aria-label="More options"
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
          </button>
        }
      />

      {/* Content */}
      <div className="flex flex-col gap-4 px-4 pb-tabbar">
        {/* Route map hero (GPS runs only) */}
        {activity.polyline && (
          <RouteMap
            polyline={activity.polyline}
            color={workoutColor(activity.plannedWorkout?.type ?? "easy").solid}
          />
        )}

        <p className="-mt-1 text-[13px] text-text-3">{dateStr} · {timeStr}</p>

        {/* Summary stats */}
        <SummaryStats activity={activity} />

        {/* Share */}
        <ShareButton activity={activity} />

        {/* AI Workout Insights (dark unless the server has a key) */}
        <InsightsCard
          activityId={activity.id}
          initialInsight={activity.aiInsight}
          hrZones={hrZoneSummary}
        />

        {/* Source & gear */}
        <SourceGearRows activity={activity} />

        {/* Best Efforts */}
        {activity.bestEfforts.length > 0 && <BestEfforts efforts={activity.bestEfforts} />}

        {/* Planned Workout */}
        {activity.plannedWorkout && <PlannedWorkoutSection workout={activity.plannedWorkout} />}
        {!activity.plannedWorkout && (
          <LinkActivitySection activityId={activity.id} onLinked={reload} />
        )}

        {/* Laps */}
        {activity.laps.length > 0 && <LapsSection laps={activity.laps} targetPaceSecKm={targetPaceSecKm} />}

        {/* Splits */}
        {activity.splits.length > 0 && <SplitsSection splits={activity.splits} />}

        {/* Pace chart */}
        {activity.streams?.velocity && <PaceChartSection activity={activity} />}

        {/* Elevation chart */}
        {activity.streams?.altitude && <ElevationChartSection activity={activity} />}

        {/* Heart rate chart */}
        {activity.streams?.heartrate && <HeartRateChartSection activity={activity} />}

        {/* HR Zones */}
        {activity.streams?.heartrate && <HrZonesSection activity={activity} />}
      </div>

      {/* Action sheet */}
      <Sheet open={menuOpen} onClose={() => { setMenuOpen(false); setDeleteArmed(false); }}>
        <div className="flex flex-col gap-2 pb-2">
          {activity.stravaId && (
          <a
            href={`https://www.strava.com/activities/${activity.stravaId}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              haptic("light");
              setMenuOpen(false);
            }}
            className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-elevated px-4 py-3.5 text-[15px] font-medium text-text-1"
          >
            <ExternalLink className="h-5 w-5 shrink-0 text-text-2" strokeWidth={1.75} />
            View on Strava
          </a>
          )}
          <button
            onClick={async () => {
              if (!deleteArmed) {
                haptic("warning");
                setDeleteArmed(true);
                return;
              }
              setDeleting(true);
              try {
                const res = await apiFetch(`/api/activities/${activity.id}`, { method: "DELETE" });
                if (!res.ok) throw new Error("delete failed");
                haptic("success");
                router.replace("/activities");
              } catch {
                haptic("warning");
                setDeleting(false);
                setDeleteArmed(false);
              }
            }}
            disabled={deleting}
            className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-elevated px-4 py-3.5 text-left text-[15px] font-medium text-danger disabled:opacity-60"
          >
            <Trash2 className="h-5 w-5 shrink-0 text-danger" strokeWidth={1.75} />
            {deleting ? "Deleting…" : deleteArmed ? "Tap again to confirm" : "Delete activity"}
          </button>
        </div>
      </Sheet>
    </main>
  );
}
