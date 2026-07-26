"use client";

import { Check, RefreshCw, Lock, Sparkles } from "lucide-react";
import { haptic } from "@/lib/haptics";

export type StrengthMode = "adapt" | "keep" | "new";

const OPTIONS: {
  key: StrengthMode;
  label: string;
  sub: string;
  Icon: typeof RefreshCw;
}[] = [
  {
    key: "adapt",
    label: "Fit it around the new plan",
    sub: "Strength moves to the days your new runs leave free. Recommended.",
    Icon: RefreshCw,
  },
  {
    key: "keep",
    label: "Leave it exactly as it is",
    sub: "Same days, same sessions. A strength day may land on a hard run.",
    Icon: Lock,
  },
  {
    key: "new",
    label: "Set up a new one after",
    sub: "Removes the current schedule and takes you to strength setup.",
    Icon: Sparkles,
  },
];

/**
 * Shown on the last create step only when a strength plan is already active.
 *
 * Creating a running plan silently re-fitted the strength schedule around the
 * new run days, which is usually right but was invisible and not a choice. It
 * lives on the final step rather than as its own wizard step so athletes with no
 * strength plan never see an extra screen.
 */
export function StrengthModeChoice({
  sessionsPerWeek,
  value,
  onChange,
}: {
  sessionsPerWeek: number;
  value: StrengthMode;
  onChange: (m: StrengthMode) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-xs font-semibold uppercase tracking-widest text-text-3">
        Your strength plan
      </span>
      <p className="text-[13px] leading-relaxed text-text-2">
        You already train strength {sessionsPerWeek}
        {sessionsPerWeek === 1 ? " time" : " times"} a week. What should happen to
        it?
      </p>
      <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Strength plan">
        {OPTIONS.map(({ key, label, sub, Icon }) => {
          const selected = value === key;
          return (
            <button
              key={key}
              role="radio"
              aria-checked={selected}
              onClick={() => {
                haptic("light");
                onChange(key);
              }}
              className={`press flex w-full items-start gap-3 rounded-2xl bg-surface p-4 text-left transition-shadow ${
                selected
                  ? "[box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                  : "[box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                  selected ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                }`}
              >
                <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className={`block text-[15px] font-bold ${selected ? "text-accent-fg" : "text-text-1"}`}
                >
                  {label}
                </span>
                <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-2">
                  {sub}
                </span>
              </span>
              {selected && (
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent">
                  <Check className="h-3 w-3 text-on-accent" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
