"use client";

import { useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { displayWeight, weightUnitLabel } from "@/lib/units";
import type { LoadFeel } from "@/lib/strength/guided-snapshot";

const REASONS: Array<{ value: LoadFeel; label: string }> = [
  { value: "too_heavy", label: "Too heavy" },
  { value: "easy", label: "Felt easy" },
  { value: "niggle", label: "Niggle" },
];

interface Props {
  open: boolean;
  onClose: () => void;
  /** The set's current working weight (already adjusted via the steppers). */
  weightKg: number;
  /** Reference weight to show as "was X kg" — null hides the reference line. */
  previousWeightKg: number | null;
  /** Dumbbells the lift uses — adds "each" to both weight readouts. */
  dumbbells?: 1 | 2;
  /**
   * What logging "Niggle" here actually eases next time (see
   * evaluateComplaintPainGates in lib/strength/progression.ts, and the
   * Achilles-specific evaluatePainGate it sits alongside) — "calf work" for
   * an Achilles complaint, "knee work" etc. for a targeted complaint whose
   * work this exercise is, null when this exercise isn't any of that (the
   * "Niggle" note then falls back to generic wording rather than claiming an
   * effect it won't have).
   */
  easesWorkLabel?: string | null;
  /** Reason already stored on this set, if any — pre-selects that chip. */
  selected: LoadFeel | null;
  onSave: (feel: LoadFeel) => void;
}

// "Adjust load" sheet: captures why a working weight changed. "Too heavy" /
// "Felt easy" are informational (the weight itself already carries into next
// session's suggestion via the logged set); "Niggle" is a pain signal, not a
// load signal, and additionally reports to the Achilles/HSR pain gate — see
// GuidedSession.tsx's onSave handler.
export function AdjustLoadSheet({
  open,
  onClose,
  weightKg,
  previousWeightKg,
  dumbbells,
  easesWorkLabel = null,
  selected,
  onSave,
}: Props) {
  const [choice, setChoice] = useState<LoadFeel | null>(selected);
  const each = dumbbells ? " each" : "";

  return (
    <Sheet open={open} onClose={onClose} title="Adjust load">
      <div className="flex flex-col items-center gap-4 pb-6">
        <p className="px-2 text-center text-[13.5px] leading-snug text-text-2">
          Changing this updates the rest of today&apos;s sets and feeds the next progression step.
        </p>
        <div className="text-center">
          <span className="font-display text-[56px] leading-none text-text-1">
            {displayWeight(weightKg)}
          </span>
          <span className="ml-1 text-[15px] font-semibold text-text-3">
            {weightUnitLabel()}
            {each}
          </span>
          {previousWeightKg != null && previousWeightKg !== weightKg && (
            <p className="mt-1 text-[13px] font-medium text-text-3">
              was {displayWeight(previousWeightKg)} {weightUnitLabel()}
              {each}
            </p>
          )}
        </div>

        <div className="flex w-full flex-wrap justify-center gap-2">
          {REASONS.map((r) => {
            const active = choice === r.value;
            return (
              <button
                key={r.value}
                type="button"
                onClick={() => {
                  haptic("light");
                  setChoice(active ? null : r.value);
                }}
                style={{ touchAction: "manipulation" }}
                className={`press inline-flex min-h-11 items-center justify-center rounded-full px-4 text-[13px] font-bold transition-colors ${
                  active ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                }`}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        {choice === "niggle" && (
          <p className="px-2 text-center text-[12px] text-text-3">
            {easesWorkLabel
              ? `This also logs a pain check-in for this session, feeding the same gate that eases your ${easesWorkLabel} next time.`
              : "This also logs a pain check-in for this session."}
          </p>
        )}

        <Button
          variant="primary"
          size="lg"
          full
          disabled={!choice}
          onClick={() => {
            if (!choice) return;
            haptic("medium");
            onSave(choice);
          }}
        >
          Save load
        </Button>
      </div>
    </Sheet>
  );
}
