"use client";

import { haptic } from "@/lib/haptics";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
}

// 8bit retro toggle switch with pixelated border and hard edges.
export function Switch({ checked, onChange, ...aria }: Props) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={aria["aria-label"]}
      onClick={() => {
        haptic("light");
        onChange(!checked);
      }}
      style={{ touchAction: "manipulation" }}
      className={`relative h-7 w-14 shrink-0 border-2 transition-colors ${
        checked
          ? "border-accent bg-accent"
          : "border-text-3 bg-elevated"
      }`}
    >
      {/* Knob */}
      <div
        className={`absolute top-0.5 h-5 w-5 border-2 border-inherit transition-all duration-150 ${
          checked ? "left-6.5 border-accent" : "left-0.5 border-text-3"
        } ${checked ? "bg-accent" : "bg-surface"}`}
        style={{
          boxShadow: `inset 1px 1px 0 ${checked ? "rgba(255,255,255,0.3)" : "rgba(0,0,0,0.2)"}`,
        }}
      />
    </button>
  );
}
