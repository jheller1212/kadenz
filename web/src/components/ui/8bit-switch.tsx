"use client";

import { motion } from "motion/react";
import { haptic } from "@/lib/haptics";

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  "aria-label"?: string;
}

// Clean, modern toggle switch with smooth animations in Kadenz colors.
export function Switch({ checked, onChange, ...aria }: Props) {
  return (
    <label
      onClick={(e) => {
        e.stopPropagation();
      }}
      className="h-7 px-1 flex items-center border border-transparent shadow-[inset_0px_0px_12px_rgba(0,0,0,0.25)] rounded-full w-[60px] relative cursor-pointer transition-colors duration-200"
      style={{
        backgroundColor: checked ? "var(--k-accent)" : "var(--k-elevated)",
        borderColor: checked ? "transparent" : "var(--k-hairline)",
      }}
    >
      <motion.div
        initial={false}
        animate={{
          x: checked ? 32 : 0,
        }}
        transition={{
          type: "spring",
          stiffness: 500,
          damping: 34,
        }}
        className="h-5 w-5 block rounded-full bg-white shadow-md z-10"
      />
      {/* sr-only (not display:none) keeps the checkbox focusable, so the
          switch stays keyboard- and screen-reader-operable. */}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-label={aria["aria-label"]}
        onChange={(e) => {
          haptic("light");
          onChange(e.target.checked);
        }}
        className="sr-only"
      />
    </label>
  );
}
