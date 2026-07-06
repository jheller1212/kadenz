"use client";

import { useState, useEffect, use } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  ExternalLink,
  Trash2,
  Zap,
  AlertCircle,
  Activity as ActivityIcon,
} from "lucide-react";
import { NavBar } from "@/components/ui/NavBar";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { Sheet } from "@/components/ui/Sheet";
import { Skeleton, EmptyState } from "@/components/ui/feedback";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";

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

// ── HR Zone calculation ───────────────────────────────────────────────────────

interface HrZone {
  label: string;
  min: number;
  max: number;
  color: string;
  seconds: number;
  pct: number;
}

function computeHrZones(
  hrStream: number[] | undefined,
  timeStream: number[],
  maxHr = 190
): HrZone[] {
  const zones: HrZone[] = [
    { label: "Zone 1", min: 0,                max: Math.round(maxHr * 0.6),  color: "#6B7280", seconds: 0, pct: 0 },
    { label: "Zone 2", min: Math.round(maxHr * 0.6),  max: Math.round(maxHr * 0.7),  color: "#3B82F6", seconds: 0, pct: 0 },
    { label: "Zone 3", min: Math.round(maxHr * 0.7),  max: Math.round(maxHr * 0.8),  color: "#22C55E", seconds: 0, pct: 0 },
    { label: "Zone 4", min: Math.round(maxHr * 0.8),  max: Math.round(maxHr * 0.9),  color: "#F97316", seconds: 0, pct: 0 },
    { label: "Zone 5", min: Math.round(maxHr * 0.9),  max: 999,                       color: "#EF4444", seconds: 0, pct: 0 },
  ];

  if (!hrStream || hrStream.length < 2) return zones;

  for (let i = 1; i < hrStream.length; i++) {
    const dt = (timeStream[i] ?? 0) - (timeStream[i - 1] ?? 0);
    const hr = hrStream[i];
    for (const z of zones) {
      if (hr >= z.min && hr < z.max) {
        z.seconds += dt;
        break;
      }
    }
  }

  const total = zones.reduce((s, z) => s + z.seconds, 0);
  for (const z of zones) {
    z.pct = total > 0 ? Math.round((z.seconds / total) * 100) : 0;
  }

  return zones;
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

// ── Summary Stats ─────────────────────────────────────────────────────────────

function SummaryStats({ activity }: { activity: ActivityDetail }) {
  return (
    <div className="rounded-[var(--radius-card)] bg-surface p-4">
      <div className="grid grid-cols-3 divide-x divide-hairline">
        <div className="pr-3 text-center">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">Distance</p>
          <p className="text-[22px] font-extrabold tabular-nums text-text-1">{activity.distanceKm.toFixed(2)}</p>
          <p className="text-[10px] text-text-3">km</p>
        </div>
        <div className="px-3 text-center">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">Time</p>
          <p className="text-[22px] font-extrabold leading-none tabular-nums text-text-1">{formatDuration(activity.durationSeconds)}</p>
        </div>
        <div className="pl-3 text-center">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-text-3">Avg Pace</p>
          <p className="text-[22px] font-extrabold tabular-nums text-text-1">{formatPace(activity.avgPaceSecKm)}</p>
          <p className="text-[10px] text-text-3">/km</p>
        </div>
      </div>
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
      <div className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {sorted.map((effort, i) => {
          const pacePerKm = effort.distance > 0 ? (effort.elapsedTime / (effort.distance / 1000)) : 0;
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Zap className="h-5 w-5 shrink-0 text-text-3" strokeWidth={1.75} />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-text-1">{effort.name}</p>
                <p className="text-[13px] tabular-nums text-text-3">{formatPace(pacePerKm)}/km</p>
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

      <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface">
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
                      ? `${block.distanceKm}km`
                      : block.durationMinutes
                      ? `${block.durationMinutes} min`
                      : ""}
                    {block.targetPaceSecKm ? ` · ${formatPace(block.targetPaceSecKm)}/km` : ""}
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
      <div className="mb-3 rounded-[var(--radius-card)] bg-surface p-4">
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
                    {formatPace(lap.paceSecKm)}/km
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail table */}
      <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface">
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
                <span className="text-right text-[13px] tabular-nums text-text-1">{lap.distanceKm.toFixed(2)}km</span>
                <span className="text-right text-[13px] tabular-nums text-text-1">{formatDuration(lap.durationSeconds)}</span>
                <div className="flex justify-end">
                  <span
                    className="rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums"
                    style={{ color, backgroundColor: color + "22" }}
                  >
                    {formatPace(lap.paceSecKm)}
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
      <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface">
        <div className="grid grid-cols-[2rem_1fr_3rem] gap-2 border-b border-hairline px-4 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">KM</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">AVG PACE</p>
          <p className="text-right text-[10px] font-semibold uppercase tracking-wider text-text-3">+/-</p>
        </div>
        <div className="divide-y divide-hairline">
          {splits.map((split, i) => {
            const prevPace = i > 0 ? splits[i - 1].paceSecKm : null;
            const diff = prevPace != null ? split.paceSecKm - prevPace : null;
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
                    {formatPace(split.paceSecKm)}/km
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
      <div className="rounded-[var(--radius-card)] bg-surface p-4">
        <AreaChart
          data={paceData}
          xData={distData}
          fillColor="#2DD4BF"
          lineColor="#14B8A6"
          gradientId="pace-gradient"
          invertY={true}
          xFormatter={(v) => `${v.toFixed(1)}km`}
          yFormatter={(v) => formatPace(v)}
          height={120}
        />
        <div className="mt-3 flex gap-6 border-t border-hairline pt-3">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-3">Avg Pace</p>
            <p className="text-[15px] font-bold tabular-nums text-text-1">{formatPace(activity.avgPaceSecKm)}/km</p>
          </div>
          {activity.maxPaceSecKm != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Pace</p>
              <p className="text-[15px] font-bold tabular-nums text-text-1">{formatPace(activity.maxPaceSecKm)}/km</p>
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
      <div className="rounded-[var(--radius-card)] bg-surface p-4">
        <AreaChart
          data={streams.altitude}
          xData={distData}
          fillColor="#60A5FA"
          lineColor="#3B82F6"
          gradientId="elev-gradient"
          invertY={false}
          xFormatter={(v) => `${v.toFixed(1)}km`}
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
      <div className="rounded-[var(--radius-card)] bg-surface p-4">
        <AreaChart
          data={streams.heartrate}
          xData={distData}
          fillColor="#F87171"
          lineColor="#EF4444"
          gradientId="hr-gradient"
          invertY={false}
          xFormatter={(v) => `${v.toFixed(1)}km`}
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

  const estimatedMax = activity.maxHr ?? 190;
  const zones = computeHrZones(streams.heartrate, streams.time, estimatedMax);
  const anyTime = zones.some((z) => z.seconds > 0);
  if (!anyTime) return null;

  return (
    <div>
      <h2 className="mb-3 text-[15px] font-bold text-text-1">Heart Rate Zones</h2>
      <div className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {zones.map((zone, i) => (
          <div key={i} className="px-4 py-3">
            <div className="mb-1.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: zone.color }} />
                <span className="text-[13px] font-semibold text-text-1">{zone.label}</span>
                <span className="text-[10px] tabular-nums text-text-3">{zone.min}–{zone.max === 999 ? `${estimatedMax}+` : zone.max} bpm</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] tabular-nums text-text-3">{zone.pct}%</span>
                <span className="w-14 text-right text-[13px] tabular-nums text-text-2">{formatDuration(zone.seconds)}</span>
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
  const { id } = use(params);
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    async function load() {
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
    load();
  }, [id]);

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
        <p className="-mt-1 text-[13px] text-text-3">{dateStr} · {timeStr}</p>

        {/* Summary stats */}
        <SummaryStats activity={activity} />

        {/* Best Efforts */}
        {activity.bestEfforts.length > 0 && <BestEfforts efforts={activity.bestEfforts} />}

        {/* Planned Workout */}
        {activity.plannedWorkout && <PlannedWorkoutSection workout={activity.plannedWorkout} />}

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
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        <div className="flex flex-col gap-2 pb-2">
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
          <button
            onClick={() => {
              haptic("warning");
              setMenuOpen(false);
            }}
            className="press flex items-center gap-3 rounded-[var(--radius-input)] bg-elevated px-4 py-3.5 text-left text-[15px] font-medium text-danger"
          >
            <Trash2 className="h-5 w-5 shrink-0 text-danger" strokeWidth={1.75} />
            Delete activity
          </button>
        </div>
      </Sheet>
    </main>
  );
}
