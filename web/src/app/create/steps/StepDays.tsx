"use client";

import { haptic } from "@/lib/haptics";
import { RUNNER_LEVELS } from "./data";
import type { RunnerLevel } from "@/lib/plan-engine/types";

export function StepDays({
  value,
  onChange,
  runnerLevel,
}: {
  value: number;
  onChange: (n: number) => void;
  runnerLevel: RunnerLevel | null;
}) {
  const levelOption = RUNNER_LEVELS.find((l) => l.key === runnerLevel);
  const maxDays = levelOption?.defaults.maxDaysPerWeek ?? 6;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-5 gap-2.5" role="radiogroup" aria-label="Days per week">
        {[2, 3, 4, 5, 6].map((n) => {
          const disabled = n > maxDays;
          const selected = value === n;
          return (
            <button
              key={n}
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => {
                haptic("light");
                onChange(n);
              }}
              className={`press flex aspect-square items-center justify-center rounded-2xl text-2xl font-extrabold tabular-nums transition-shadow ${
                selected
                  ? "bg-surface text-accent [box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                  : disabled
                  ? "bg-elevated text-text-3/50"
                  : "bg-surface text-text-1 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
              }`}
            >
              {n}
            </button>
          );
        })}
      </div>
      {levelOption && maxDays < 6 && (
        <p className="text-[13px] leading-relaxed text-text-3">
          As a{runnerLevel === "intermediate" || runnerLevel === "advanced" || runnerLevel === "elite" ? "n" : ""}{" "}
          {levelOption.title.toLowerCase()} runner we cap your plan at {maxDays} running days per week — consistency
          beats volume while your body adapts.
        </p>
      )}
    </div>
  );
}
