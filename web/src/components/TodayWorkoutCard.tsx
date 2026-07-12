"use client";

import { WorkoutTypeBadge } from "./WorkoutTypeBadge";
import { formatPace } from "@/lib/plan-engine/pace-zones";

export interface TodayWorkoutBlock {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
}

export interface TodayWorkout {
  id: string;
  type: string;
  title: string;
  description?: string | null;
  targetKm?: number | null;
  targetDurationMinutes?: number | null;
  status: string;
  blocks: TodayWorkoutBlock[];
}

interface Props {
  workout: TodayWorkout;
  onComplete: (actualKm?: number) => void;
  completing?: boolean;
}

const BLOCK_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  work: "Work",
  recovery: "Recovery",
  cooldown: "Cool-down",
};

export function TodayWorkoutCard({ workout, onComplete, completing }: Props) {
  const isCompleted = workout.status === "completed";

  return (
    <div
      className="k-card p-5 flex flex-col gap-5"
      role="region"
      aria-label="Today's workout"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <WorkoutTypeBadge type={workout.type as "easy" | "tempo" | "interval" | "long" | "recovery" | "race" | "rest"} />
          <h2 className="text-xl font-bold text-text-1 leading-tight">
            {workout.title}
          </h2>
          {workout.description && (
            <p className="text-sm text-text-2 leading-relaxed">
              {workout.description}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end shrink-0 gap-0.5">
          {workout.targetKm != null && (
            <span className="text-2xl font-bold text-text-1">
              {workout.targetKm}
              <span className="text-sm font-normal text-text-2 ml-0.5">km</span>
            </span>
          )}
          {workout.targetDurationMinutes != null && (
            <span className="text-xs text-text-3">~{workout.targetDurationMinutes} min</span>
          )}
        </div>
      </div>

      {/* Block breakdown */}
      {workout.blocks.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">
            Workout Structure
          </span>
          <div className="flex flex-col gap-1">
            {workout.blocks.map((block, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      block.type === "work" ? "bg-accent" : "bg-hairline"
                    }`}
                  />
                  {i < workout.blocks.length - 1 && (
                    <div className="w-px h-6 bg-hairline mt-0.5" />
                  )}
                </div>
                <div className="flex-1 flex items-center justify-between py-1">
                  <div>
                    <span className="text-sm font-medium text-text-1">
                      {BLOCK_LABEL[block.type] ?? block.type}
                    </span>
                    {block.reps != null && block.repDistanceKm != null && (
                      <span className="text-xs text-text-3 ml-2">
                        {block.reps}×{block.repDistanceKm * 1000}m
                      </span>
                    )}
                    {block.distanceKm != null && (
                      <span className="text-xs text-text-3 ml-2">
                        {block.distanceKm} km
                      </span>
                    )}
                    {block.durationMinutes != null && (
                      <span className="text-xs text-text-3 ml-2">
                        {block.durationMinutes} min
                      </span>
                    )}
                  </div>
                  {block.targetPaceSecKm != null && (
                    <span className="text-xs font-semibold text-text-2 tabular-nums">
                      {formatPace(block.targetPaceSecKm)}/km
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CTA */}
      {isCompleted ? (
        <div className="w-full rounded-[var(--radius-input)] bg-elevated border border-hairline text-text-2 font-semibold text-sm py-3 flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Completed
        </div>
      ) : (
        <button
          onClick={() => onComplete()}
          disabled={completing}
          className="w-full rounded-[var(--radius-input)] bg-accent text-on-accent font-bold text-sm py-3 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
          aria-label="Mark workout as completed"
        >
          {completing ? "Saving..." : "Complete Workout"}
        </button>
      )}
    </div>
  );
}
