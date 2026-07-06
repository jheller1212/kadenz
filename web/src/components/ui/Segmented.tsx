"use client";

import { motion } from "motion/react";
import { haptic } from "@/lib/haptics";

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

// iOS segmented control: a pill track with a sliding selected thumb (shared
// layout animation), used for switching modes (e.g. Upper / Lower / Achilles).
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
}: Props<T>) {
  return (
    <div
      className={`relative flex rounded-full bg-elevated p-1 ${className}`}
      role="tablist"
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (!active) {
                haptic("light");
                onChange(opt.value);
              }
            }}
            style={{ touchAction: "manipulation" }}
            className="relative flex-1 select-none px-3 py-2 text-[13px] font-semibold"
          >
            {active && (
              <motion.span
                layoutId="segmented-thumb"
                transition={{ type: "spring", stiffness: 500, damping: 40 }}
                className="absolute inset-0 rounded-full bg-surface shadow-sm"
              />
            )}
            <span
              className={`relative z-10 ${active ? "text-text-1" : "text-text-2"}`}
            >
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
