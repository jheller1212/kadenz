"use client";

import { motion } from "motion/react";
import { haptic } from "@/lib/haptics";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
}

// iOS toggle switch with a spring-driven knob.
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
      className={`relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200 ${
        checked ? "bg-accent" : "bg-text-3/40"
      }`}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 600, damping: 34 }}
        className="absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md"
        style={{ left: checked ? "22px" : "2px" }}
      />
    </button>
  );
}
