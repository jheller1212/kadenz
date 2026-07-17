"use client";

import type { RunnerLevel } from "@/lib/plan-engine/types";
import { OptionCard, RadialRing } from "@/components/ui/wizard";
import { RUNNER_LEVELS } from "./data";

export function StepLevel({
  value,
  onChange,
}: {
  value: RunnerLevel | null;
  onChange: (level: RunnerLevel) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {RUNNER_LEVELS.map((level) => (
        <OptionCard
          key={level.key}
          selected={value === level.key}
          onSelect={() => onChange(level.key)}
          title={level.title}
          sub={level.sub}
          leading={<RadialRing fill={level.fill} active={value === level.key} />}
        />
      ))}
    </div>
  );
}
