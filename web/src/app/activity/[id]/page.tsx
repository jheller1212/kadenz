"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
      <div className="flex items-center justify-center h-28 text-xs text-text-3">
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
    <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
      <div className="grid grid-cols-3 divide-x divide-hairline">
        <div className="pr-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-3 mb-1">Distance</p>
          <p className="text-xl font-extrabold text-text-1 tabular-nums">{activity.distanceKm.toFixed(2)}</p>
          <p className="text-[10px] text-text-3">km</p>
        </div>
        <div className="px-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-3 mb-1">Time</p>
          <p className="text-xl font-extrabold text-text-1 tabular-nums leading-none">{formatDuration(activity.durationSeconds)}</p>
        </div>
        <div className="pl-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-text-3 mb-1">Avg Pace</p>
          <p className="text-xl font-extrabold text-text-1 tabular-nums">{formatPace(activity.avgPaceSecKm)}</p>
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Best Efforts</h2>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface divide-y divide-hairline overflow-hidden">
        {sorted.map((effort, i) => {
          const pacePerKm = effort.distance > 0 ? (effort.elapsedTime / (effort.distance / 1000)) : 0;
          return (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <svg className="w-5 h-5 text-text-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-text-1">{effort.name}</p>
                <p className="text-xs text-text-3 tabular-nums">{formatPace(pacePerKm)}/km</p>
              </div>
              <p className="text-sm font-bold text-text-1 tabular-nums shrink-0">{formatEffortTime(effort.elapsedTime)}</p>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-text-3 mt-2 leading-snug px-1">
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

const BLOCK_ICONS: Record<string, string> = {
  warmup: "M13 10V3L4 14h7v7l9-11h-7z",
  work: "M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3",
  recovery: "M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z",
  cooldown: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z",
};

function PlannedWorkoutSection({ workout }: { workout: NonNullable<ActivityDetail["plannedWorkout"]> }) {
  const [showAll, setShowAll] = useState(false);

  const blocks = workout.blocks ?? [];
  const displayBlocks = showAll ? blocks : blocks.slice(0, 3);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-text-1">Planned Workout</h2>
        <button
          className="w-7 h-7 rounded-lg bg-elevated border border-hairline flex items-center justify-center active:opacity-70"
          aria-label="Copy workout"
        >
          <svg className="w-3.5 h-3.5 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path strokeLinecap="round" d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
          </svg>
        </button>
      </div>

      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden">
        <div className="divide-y divide-hairline">
          {displayBlocks.map((block, i) => {
            const isWork = block.type === "work";
            const isRepSet = isWork && block.reps && block.repDistanceKm;
            return (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <svg className="w-4 h-4 text-text-3 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75} aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d={BLOCK_ICONS[block.type] ?? BLOCK_ICONS.work} />
                </svg>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-text-1">
                      {BLOCK_LABELS[block.type] ?? block.type}
                    </p>
                    {isRepSet && (
                      <span className="px-1.5 py-0.5 rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                        ×{block.reps}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-text-3 mt-0.5">
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
            onClick={() => setShowAll(!showAll)}
            className="w-full py-3 text-xs font-semibold text-accent border-t border-hairline text-center active:opacity-70 transition-opacity"
          >
            {showAll ? "Show less" : `Show ${blocks.length - 3} more`}
          </button>
        )}

        <div className="border-t border-hairline px-4 py-3">
          <Link
            href={`/workout/${workout.id}`}
            className="flex items-center justify-center gap-1.5 text-xs font-semibold text-text-2 active:opacity-70 transition-opacity"
          >
            View full workout
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </Link>
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Laps</h2>

      {/* Bar chart */}
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4 mb-3">
        <div className="flex flex-col gap-2">
          {laps.map((lap, i) => {
            const barPct = lapBarPct(lap.paceSecKm);
            const color = paceColor(lap.paceSecKm);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] text-text-3 tabular-nums w-5 shrink-0 text-right">{lap.index}</span>
                <div className="flex-1 relative h-6 bg-elevated rounded-sm overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm flex items-center px-2"
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
                  <span className="relative z-10 text-[10px] font-semibold tabular-nums pl-2" style={{ color }}>
                    {formatPace(lap.paceSecKm)}/km
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detail table */}
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden">
        <div className="grid grid-cols-4 px-4 py-2 border-b border-hairline">
          {["LAP", "DIST", "TIME", "PACE"].map((h) => (
            <p key={h} className="text-[10px] font-semibold uppercase tracking-wider text-text-3 text-right first:text-left">{h}</p>
          ))}
        </div>
        <div className="divide-y divide-hairline">
          {laps.map((lap, i) => {
            const color = paceColor(lap.paceSecKm);
            return (
              <div key={i} className="grid grid-cols-4 px-4 py-2.5 items-center">
                <span className="text-xs font-semibold text-text-2">{lap.index}</span>
                <span className="text-xs text-text-1 tabular-nums text-right">{lap.distanceKm.toFixed(2)}km</span>
                <span className="text-xs text-text-1 tabular-nums text-right">{formatDuration(lap.durationSeconds)}</span>
                <div className="flex justify-end">
                  <span
                    className="text-[11px] font-bold tabular-nums px-1.5 py-0.5 rounded-md"
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Splits</h2>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden">
        <div className="grid grid-cols-[2rem_1fr_3rem] px-4 py-2 border-b border-hairline gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">KM</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3">AVG PACE</p>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-text-3 text-right">+/-</p>
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
              <div key={i} className="grid grid-cols-[2rem_1fr_3rem] px-4 py-2 items-center gap-2">
                <span className="text-xs font-semibold text-text-2 tabular-nums">{split.km}</span>
                <div className="relative h-6 flex items-center">
                  <div
                    className="absolute inset-y-0 left-0 rounded-sm flex items-center"
                    style={{
                      width: `${barPct(split.paceSecKm)}%`,
                      backgroundColor: "#F87171" + "33",
                    }}
                  />
                  <span className="relative z-10 text-[11px] font-semibold text-text-1 tabular-nums pl-1">
                    {formatPace(split.paceSecKm)}/km
                  </span>
                </div>
                <span
                  className="text-[11px] font-bold tabular-nums text-right"
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Pace</h2>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
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
        <div className="flex gap-6 mt-3 pt-3 border-t border-hairline">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-text-3">Avg Pace</p>
            <p className="text-sm font-bold text-text-1 tabular-nums">{formatPace(activity.avgPaceSecKm)}/km</p>
          </div>
          {activity.maxPaceSecKm != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Pace</p>
              <p className="text-sm font-bold text-text-1 tabular-nums">{formatPace(activity.maxPaceSecKm)}/km</p>
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Elevation</h2>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
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
        <div className="flex gap-6 mt-3 pt-3 border-t border-hairline">
          {activity.elevationGain != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Elevation Gain</p>
              <p className="text-sm font-bold text-text-1 tabular-nums">{Math.round(activity.elevationGain)}m</p>
            </div>
          )}
          {activity.maxElevation != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Elevation</p>
              <p className="text-sm font-bold text-text-1 tabular-nums">{Math.round(activity.maxElevation)}m</p>
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Heart Rate</h2>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface p-4">
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
        <div className="flex gap-6 mt-3 pt-3 border-t border-hairline">
          {activity.avgHr != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Avg Heart Rate</p>
              <p className="text-sm font-bold text-text-1 tabular-nums">{Math.round(activity.avgHr)} bpm</p>
            </div>
          )}
          {activity.maxHr != null && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-text-3">Max Heart Rate</p>
              <p className="text-sm font-bold text-text-1 tabular-nums">{Math.round(activity.maxHr)} bpm</p>
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
      <h2 className="text-sm font-bold text-text-1 mb-3">Heart Rate Zones</h2>
      <div className="rounded-[var(--radius-card)] border border-hairline bg-surface divide-y divide-hairline overflow-hidden">
        {zones.map((zone, i) => (
          <div key={i} className="px-4 py-3">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                <span className="text-xs font-semibold text-text-1">{zone.label}</span>
                <span className="text-[10px] text-text-3 tabular-nums">{zone.min}–{zone.max === 999 ? `${estimatedMax}+` : zone.max} bpm</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-text-3 tabular-nums">{zone.pct}%</span>
                <span className="text-xs text-text-2 tabular-nums w-14 text-right">{formatDuration(zone.seconds)}</span>
              </div>
            </div>
            <div className="h-2 rounded-full bg-elevated overflow-hidden">
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
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Header skeleton */}
      <div className="bg-gradient-to-b from-[#1a2a1a] to-bg pt-12 pb-6 px-4">
        <div className="max-w-md mx-auto">
          <div className="flex items-center justify-between mb-6">
            <div className="w-9 h-9 rounded-full bg-elevated animate-pulse" />
            <div className="w-32 h-5 rounded bg-elevated animate-pulse" />
            <div className="w-9 h-9 rounded-full bg-elevated animate-pulse" />
          </div>
          <div className="w-48 h-6 rounded bg-elevated animate-pulse mb-2" />
          <div className="w-32 h-4 rounded bg-elevated animate-pulse" />
        </div>
      </div>
      <main className="flex-1 max-w-md mx-auto w-full px-4 pb-12 flex flex-col gap-5 mt-4">
        <div className="h-24 rounded-[var(--radius-card)] bg-surface border border-hairline animate-pulse" />
        <div className="h-40 rounded-[var(--radius-card)] bg-surface border border-hairline animate-pulse" />
        <div className="h-32 rounded-[var(--radius-card)] bg-surface border border-hairline animate-pulse" />
        <div className="h-48 rounded-[var(--radius-card)] bg-surface border border-hairline animate-pulse" />
      </main>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ActivityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/activities/${id}`);
        if (!res.ok) throw new Error("Not found");
        const data: ActivityDetail = await res.json();
        setActivity(data);
      } catch {
        // silent — not found state handled below
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  if (loading) return <LoadingSkeleton />;

  if (!activity) {
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center gap-3 px-4">
        <p className="text-text-2">Activity not found</p>
        <button
          onClick={() => router.back()}
          className="text-accent text-sm font-semibold"
        >
          Go back
        </button>
      </div>
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
    <div className="min-h-screen bg-bg flex flex-col">
      {/* Gradient header */}
      <div className="bg-gradient-to-b from-[#1a3a2a] to-bg pt-12 pb-6 px-4">
        <div className="flex items-center justify-between max-w-md mx-auto mb-4">
          <button
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full bg-bg/30 backdrop-blur flex items-center justify-center"
            aria-label="Back"
          >
            <svg className="w-5 h-5 text-text-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <h1 className="text-sm font-bold text-text-1 truncate max-w-[180px] text-center">{activity.name}</h1>

          <button
            onClick={() => setMenuOpen(true)}
            className="w-9 h-9 rounded-full bg-bg/30 backdrop-blur flex items-center justify-center"
            aria-label="More options"
          >
            <svg className="w-5 h-5 text-text-1" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
        </div>

        <div className="max-w-md mx-auto">
          <p className="text-xs text-text-3">{dateStr} · {timeStr}</p>
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 max-w-md mx-auto w-full px-4 pb-12 flex flex-col gap-5 -mt-2">
        {/* Summary stats */}
        <SummaryStats activity={activity} />

        {/* Divider */}
        <div className="h-px bg-hairline" />

        {/* Best Efforts */}
        {activity.bestEfforts.length > 0 && (
          <>
            <BestEfforts efforts={activity.bestEfforts} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* Planned Workout */}
        {activity.plannedWorkout && (
          <>
            <PlannedWorkoutSection workout={activity.plannedWorkout} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* Laps */}
        {activity.laps.length > 0 && (
          <>
            <LapsSection laps={activity.laps} targetPaceSecKm={targetPaceSecKm} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* Splits */}
        {activity.splits.length > 0 && (
          <>
            <SplitsSection splits={activity.splits} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* Pace chart */}
        {activity.streams?.velocity && (
          <>
            <PaceChartSection activity={activity} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* Elevation chart */}
        {activity.streams?.altitude && (
          <>
            <ElevationChartSection activity={activity} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* Heart rate chart */}
        {activity.streams?.heartrate && (
          <>
            <HeartRateChartSection activity={activity} />
            <div className="h-px bg-hairline" />
          </>
        )}

        {/* HR Zones */}
        {activity.streams?.heartrate && (
          <HrZonesSection activity={activity} />
        )}
      </main>

      {/* Action sheet */}
      {menuOpen && (
        <div className="fixed inset-0 z-50" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="absolute bottom-0 left-0 right-0 max-w-md mx-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-4 mb-2 rounded-[var(--radius-card)] border border-hairline bg-surface overflow-hidden divide-y divide-hairline">
              <a
                href={`https://www.strava.com/activities/${activity.stravaId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-5 py-4 text-left text-sm font-medium text-text-1 active:bg-elevated transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <svg className="w-5 h-5 text-text-2 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                View on Strava
              </a>
              <button
                className="w-full flex items-center gap-3 px-5 py-4 text-left text-sm font-medium text-danger active:bg-elevated transition-colors"
                onClick={() => setMenuOpen(false)}
              >
                <svg className="w-5 h-5 text-danger shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Delete activity
              </button>
            </div>
            <button
              onClick={() => setMenuOpen(false)}
              className="mx-4 mb-6 w-[calc(100%-2rem)] rounded-[var(--radius-card)] bg-surface border border-hairline py-4 text-sm font-bold text-text-1 active:bg-elevated transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
