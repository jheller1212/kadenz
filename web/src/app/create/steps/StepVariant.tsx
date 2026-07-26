"use client";

import { Check } from "lucide-react";
import { haptic } from "@/lib/haptics";
import type { PlanVariant } from "./data";

// Style variants for the chosen intent, stacked. The design system's
// variant-step.html specifies a swipeable row, but in use the carousel hid the
// second option and its CTA behind a gesture with no affordance, so the cards
// are stacked and both are simply visible. Selecting one applies its knobs to
// the wizard state.
export function StepVariant({
  variants,
  selectedKey,
  onSelect,
}: {
  variants: PlanVariant[];
  selectedKey: string | null;
  onSelect: (v: PlanVariant) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {variants.map((v) => {
        const selected = selectedKey === v.key;
        return (
          <button
            key={v.key}
            role="radio"
            aria-checked={selected}
            onClick={() => {
              haptic("light");
              onSelect(v);
            }}
            className={`press flex w-full flex-col rounded-2xl bg-surface p-5 text-left transition-shadow ${
              selected
                ? "[box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                : "[box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
            }`}
          >
            <span className="flex items-center justify-between">
              <span className={`text-[20px] font-extrabold tracking-tight ${selected ? "text-accent-fg" : "text-text-1"}`}>
                {v.label}
              </span>
              {selected && (
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent">
                  <Check className="h-3.5 w-3.5 text-on-accent" strokeWidth={3} />
                </span>
              )}
            </span>
            <span className="mt-2 text-[13.5px] leading-snug text-text-2">{v.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
