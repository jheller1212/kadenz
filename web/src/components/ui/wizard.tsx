"use client";

import { motion } from "motion/react";
import { ArrowLeft, Check, X } from "lucide-react";
import { haptic } from "@/lib/haptics";

// ── Wizard primitives ─────────────────────────────────────────────────────────
// Shared by the strength setup tour and the run-plan creation flow: thin
// progress bar between back/close, white option cards with an accent
// selection ring, rounded-square checkmarks, radial rings.

export function WizardHeader({
  progress,
  onBack,
  onClose,
  accessory,
}: {
  /** 0–1 fraction of the flow completed (including the current step). */
  progress: number;
  onBack: () => void;
  onClose: () => void;
  /** Optional extra control rendered before the close button. */
  accessory?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-4 px-4 pb-2"
      style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
    >
      <button type="button" aria-label="Back" onClick={onBack} className="press p-1">
        <ArrowLeft className="h-6 w-6 text-text-1" strokeWidth={2} />
      </button>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
        <motion.div
          className="h-full rounded-full bg-text-1"
          animate={{ width: `${Math.max(0, Math.min(1, progress)) * 100}%` }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        />
      </div>
      {accessory}
      <button type="button" aria-label="Close" onClick={onClose} className="press p-1">
        <X className="h-6 w-6 text-text-1" strokeWidth={2} />
      </button>
    </div>
  );
}

export function OptionCard({
  selected,
  onSelect,
  title,
  sub,
  leading,
  trailing,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  sub?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      onClick={() => { haptic("light"); onSelect(); }}
      whileTap={{ scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 32 }}
      style={{ touchAction: "manipulation" }}
      className={`flex w-full items-center gap-4 rounded-2xl p-5 text-left transition-shadow ${
        selected
          ? "bg-surface [box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
          : "bg-surface [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
      }`}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold tracking-tight text-text-1">{title}</span>
        {sub && <span className="mt-0.5 block text-[14px] leading-snug text-text-2">{sub}</span>}
      </span>
      {trailing}
    </motion.button>
  );
}

export function WizardCheck({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border-2 transition-colors ${
        on ? "border-transparent bg-accent text-on-accent" : "border-hairline bg-transparent text-transparent"
      }`}
    >
      <Check className="h-4 w-4" strokeWidth={3} />
    </span>
  );
}

/** Radial progress ring (donut), fill 0–1. */
export function RadialRing({ fill, active = true }: { fill: number; active?: boolean }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width="44" height="44" viewBox="0 0 44 44" aria-hidden>
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--k-elevated)" strokeWidth="6" />
      <circle
        cx="22"
        cy="22"
        r={r}
        fill="none"
        stroke={active ? "var(--k-accent)" : "var(--k-progress)"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${c * fill} ${c}`}
        transform="rotate(-90 22 22)"
      />
    </svg>
  );
}

/** Step headline in the wizard type scale. */
export function WizardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div>
      <h1 className="text-[30px] font-extrabold leading-[1.15] tracking-tight text-text-1 [text-wrap:balance]">
        {title}
      </h1>
      {sub && <p className="mt-3 text-[15px] leading-relaxed text-text-2">{sub}</p>}
    </div>
  );
}
