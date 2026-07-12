"use client";

import { motion } from "motion/react";
import type { ReactNode } from "react";
import { haptic } from "@/lib/haptics";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "signature";
type Size = "sm" | "md" | "lg";

interface Props {
  children: ReactNode;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  busy?: boolean;
  full?: boolean;
  type?: "button" | "submit";
  className?: string;
  "aria-label"?: string;
}

/* v2: primary is "lit" via the accent gradient; secondary is a card surface
   (gradient + ring), not a bordered inset. */
const VARIANTS: Record<Variant, string> = {
  primary:
    "text-on-accent [background:var(--k-accent-grad)] [background-color:var(--k-accent)] [box-shadow:var(--k-shadow-card)]",
  secondary:
    "text-text-1 [background:var(--k-surface-grad)] [background-color:var(--k-surface)] [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]",
  ghost: "bg-transparent text-accent",
  danger: "bg-danger/10 text-danger",
  signature:
    "[background:var(--k-signature-grad)] text-[var(--k-signature-ink)] [box-shadow:var(--k-shadow-card)]",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-4 text-sm rounded-full",
  md: "h-12 px-5 text-[15px] rounded-full",
  lg: "h-14 px-6 text-base rounded-full",
};

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  busy,
  full,
  type = "button",
  className = "",
  ...aria
}: Props) {
  return (
    <motion.button
      type={type}
      disabled={disabled || busy}
      aria-label={aria["aria-label"]}
      whileTap={{ scale: disabled || busy ? 1 : 0.96 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      onClick={() => {
        if (disabled || busy) return;
        haptic("medium");
        onClick?.();
      }}
      style={{ touchAction: "manipulation" }}
      className={`inline-flex items-center justify-center gap-2 font-semibold tracking-tight
        disabled:opacity-40 select-none ${VARIANTS[variant]} ${SIZES[size]} ${
        full ? "w-full" : ""
      } ${className}`}
    >
      {busy ? (
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        children
      )}
    </motion.button>
  );
}
