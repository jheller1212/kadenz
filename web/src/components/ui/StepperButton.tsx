"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";

/**
 * A single round increment/decrement control for nudging a numeric value
 * (weight, reps, distance, pace offset, ...) up or down by one step. Always
 * a 48x48 hit target: these get tapped mid-set or mid-run with tired, sweaty
 * fingers, so the size is non-negotiable no matter how tight the surrounding
 * layout is. `ariaLabel` is required because a bare "+" icon announces
 * nothing on its own — say what it changes and which way, e.g. "Less weight".
 */
export function StepperButton({
  onClick,
  ariaLabel,
  children,
  className = "",
}: {
  onClick: () => void;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      whileTap={{ scale: 0.85 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      style={{ touchAction: "manipulation" }}
      className={`flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-1 ${className}`}
    >
      {children}
    </motion.button>
  );
}
