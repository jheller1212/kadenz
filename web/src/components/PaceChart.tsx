"use client";

import { formatPace } from "@/lib/plan-engine/pace-zones";

// ── Types ───────────────────────────────────────────────────────────────────

interface Block {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
}

interface PaceChartProps {
  blocks: Block[];
  workoutType: string;
  /** "compact" for workout cards, "full" for detail page */
  variant?: "compact" | "full";
  color: string;
  useMiles?: boolean;
}

// ── Intensity mapping ───────────────────────────────────────────────────────

/** Map pace to a 0-1 intensity value. Lower pace = higher intensity. */
function getIntensity(block: Block, allBlocks: Block[]): number {
  const pace = block.targetPaceSecKm;
  if (!pace) {
    // Fallback: assign intensity by block type
    switch (block.type) {
      case "warmup":
      case "cooldown":
        return 0.3;
      case "recovery":
        return 0.2;
      case "work":
        return 0.85;
      default:
        return 0.5;
    }
  }

  // Find pace range across all blocks
  const paces = allBlocks
    .map((b) => b.targetPaceSecKm)
    .filter((p): p is number => p != null);

  if (paces.length <= 1) {
    // Single pace workout (easy/long) — show at medium height
    return block.type === "work" ? 0.6 : 0.35;
  }

  const fastest = Math.min(...paces);
  const slowest = Math.max(...paces);
  const range = slowest - fastest;

  if (range === 0) return 0.5;

  // Invert: faster pace = higher bar
  return 0.2 + ((slowest - pace) / range) * 0.7;
}

/** Get the visual width weight of a block based on its distance/duration. */
function getBlockWeight(block: Block): number {
  if (block.reps && block.repDistanceKm) {
    return block.reps * block.repDistanceKm;
  }
  if (block.distanceKm) return block.distanceKm;
  if (block.durationMinutes) return block.durationMinutes;
  return 1;
}

/** Expand interval blocks into rep + rest segments for visual display. */
function expandBlocks(blocks: Block[]): Array<{
  intensity: number;
  weight: number;
  type: string;
  isRest: boolean;
  originalBlock: Block;
}> {
  const segments: Array<{
    intensity: number;
    weight: number;
    type: string;
    isRest: boolean;
    originalBlock: Block;
  }> = [];

  for (const block of blocks) {
    if (block.type === "work" && block.reps && block.repDistanceKm) {
      // Expand reps into alternating work/rest segments
      const workIntensity = getIntensity(block, blocks);
      for (let r = 0; r < block.reps; r++) {
        segments.push({
          intensity: workIntensity,
          weight: block.repDistanceKm,
          type: "work",
          isRest: false,
          originalBlock: block,
        });
        // Add rest between reps (except after last)
        if (r < block.reps - 1) {
          segments.push({
            intensity: 0.15,
            weight: block.repDistanceKm * 0.4, // visual width for rest
            type: "recovery",
            isRest: true,
            originalBlock: block,
          });
        }
      }
    } else {
      segments.push({
        intensity: getIntensity(block, blocks),
        weight: getBlockWeight(block),
        type: block.type,
        isRest: false,
        originalBlock: block,
      });
    }
  }

  return segments;
}

// ── Block type colors ───────────────────────────────────────────────────────

function getSegmentColor(type: string, workoutColor: string, isRest: boolean): string {
  if (isRest) return "var(--k-elevated)";
  switch (type) {
    case "warmup":
    case "cooldown":
      return "var(--k-text-3)";
    case "recovery":
      return "var(--k-elevated)";
    case "work":
      return workoutColor;
    default:
      return workoutColor;
  }
}

// ── Chart Component ─────────────────────────────────────────────────────────

export function PaceChart({ blocks, workoutType, variant = "compact", color, useMiles }: PaceChartProps) {
  if (!blocks || blocks.length === 0) return null;

  const segments = expandBlocks(blocks);
  const totalWeight = segments.reduce((s, seg) => s + seg.weight, 0);
  const chartHeight = variant === "compact" ? 32 : 56;
  const gap = variant === "compact" ? 1 : 2;

  // For single-block workouts (easy runs), show a simple bar
  const isSinglePace = blocks.length === 1 || blocks.every((b) => b.targetPaceSecKm === blocks[0]?.targetPaceSecKm);

  return (
    <div className="w-full">
      {/* Bar chart */}
      <div
        className="flex items-end w-full"
        style={{ height: chartHeight, gap }}
      >
        {segments.map((seg, i) => {
          const widthPct = (seg.weight / totalWeight) * 100;
          const barHeight = Math.max(
            variant === "compact" ? 4 : 6,
            seg.intensity * chartHeight
          );

          return (
            <div
              key={i}
              className="rounded-sm transition-all"
              style={{
                width: `${widthPct}%`,
                height: barHeight,
                backgroundColor: getSegmentColor(seg.type, color, seg.isRest),
                opacity: seg.isRest ? 0.5 : 1,
              }}
            />
          );
        })}
      </div>

      {/* Pace labels (full variant only) */}
      {variant === "full" && (
        <div className="flex items-start w-full mt-2" style={{ gap }}>
          {segments
            .filter((s) => !s.isRest)
            .map((seg, i, arr) => {
              const pace = seg.originalBlock.targetPaceSecKm;
              // Don't repeat same label for consecutive same-type blocks
              if (i > 0 && arr[i - 1].originalBlock === seg.originalBlock) return null;

              const label = seg.type === "warmup"
                ? "WU"
                : seg.type === "cooldown"
                ? "CD"
                : seg.type === "recovery"
                ? "Jog"
                : pace
                ? formatPace(pace, useMiles)
                : "";

              if (!label) return null;

              return (
                <span
                  key={i}
                  className="text-[10px] text-text-3 font-medium tabular-nums truncate"
                  style={{ flex: 1, textAlign: "center" }}
                >
                  {label}
                </span>
              );
            })}
        </div>
      )}
    </div>
  );
}

// ── Pace Summary Badge ──────────────────────────────────────────────────────

/** Shows the main pace target as a compact badge (e.g., "5:15/km") */
export function PaceBadge({
  blocks,
  workoutType,
  color,
  useMiles,
}: {
  blocks: Block[];
  workoutType: string;
  color: string;
  useMiles?: boolean;
}) {
  // Find the main work block pace
  const workBlock = blocks.find((b) => b.type === "work");
  const pace = workBlock?.targetPaceSecKm ?? blocks[0]?.targetPaceSecKm;
  if (!pace) return null;

  const unit = useMiles ? "/mi" : "/km";
  const range = workBlock?.minPaceSecKm && workBlock?.maxPaceSecKm
    ? `${formatPace(workBlock.minPaceSecKm, useMiles)} – ${formatPace(workBlock.maxPaceSecKm, useMiles)}`
    : formatPace(pace, useMiles);

  return (
    <div
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold"
      style={{ backgroundColor: `${color}18`, color }}
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      {range}{unit}
    </div>
  );
}
