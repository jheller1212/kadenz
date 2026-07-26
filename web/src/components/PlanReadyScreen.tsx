"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";

// Only the fields the reveal needs — the POST /api/plans response is the whole
// plan tree, and this screen deliberately reads a thin slice of it.
export interface PlanReadySummary {
  id: string;
  name?: string | null;
  planLengthWeeks?: number | null;
  daysPerWeek?: number | null;
  vdot?: number | null;
  weeks?: { workouts?: { targetKm?: number | null }[] }[] | null;
  strength?: {
    active: boolean;
    sessionsPerWeek: number;
  } | null;
}

/** Biggest planned week in the block — the number runners actually care about. */
function peakWeekKm(plan: PlanReadySummary): number | null {
  const totals = (plan.weeks ?? []).map((w) =>
    (w.workouts ?? []).reduce((sum, wo) => sum + (wo.targetKm ?? 0), 0),
  );
  const peak = Math.max(0, ...totals);
  return peak > 0 ? Math.round(peak) : null;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center">
      <div className="font-display text-[34px] leading-none text-text-1 tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-3">
        {label}
      </div>
    </div>
  );
}

/**
 * Shown once the plan exists, between the build loader and the plan itself.
 * Confirms what was actually built instead of dropping the athlete onto the
 * plan hub with no acknowledgement.
 */
export function PlanReadyScreen({
  plan,
  onContinue,
}: {
  plan: PlanReadySummary;
  onContinue: () => void;
}) {
  const peak = peakWeekKm(plan);
  const strength = plan.strength;

  // Staggered rise — each row follows the one above it.
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.08 * i, duration: 0.42, ease: [0.32, 0.72, 0, 1] as const },
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28 }}
      className="k-dark-surface fixed inset-0 z-[60] flex flex-col overflow-y-auto"
      style={{ background: "var(--k-bg-grad)" }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col items-center px-6 pb-10 pt-[14vh]">
        <motion.div {...rise(0)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icon.svg"
            alt=""
            width={72}
            height={72}
            className="block h-[72px] w-[72px] rounded-[14px]"
            style={{ boxShadow: "0 14px 32px -12px rgba(0,0,0,.65)" }}
          />
        </motion.div>

        <motion.h1
          {...rise(1)}
          className="mt-6 w-full text-center text-[28px] font-extrabold leading-tight tracking-tight text-text-1"
        >
          Your plan is ready
        </motion.h1>

        {plan.name ? (
          <motion.p
            {...rise(2)}
            className="mt-2 w-full text-center text-[15px] text-text-3"
          >
            {plan.name}
          </motion.p>
        ) : null}

        <motion.div
          {...rise(3)}
          className="mt-9 flex w-full items-start justify-between gap-2 border-y py-6"
          style={{ borderColor: "rgba(255,255,255,.08)" }}
        >
          {plan.planLengthWeeks ? (
            <Stat value={String(plan.planLengthWeeks)} label="Weeks" />
          ) : null}
          {plan.daysPerWeek ? (
            <Stat value={String(plan.daysPerWeek)} label="Runs / wk" />
          ) : null}
          {peak ? <Stat value={String(peak)} label="Peak km" /> : null}
        </motion.div>

        {plan.vdot ? (
          <motion.p
            {...rise(4)}
            className="mt-5 w-full text-center text-[13px] text-text-3"
          >
            Paces set from your goal · VDOT {Math.round(plan.vdot)}
          </motion.p>
        ) : null}

        {strength?.active ? (
          <motion.p
            {...rise(5)}
            className="mt-4 w-full text-center text-[13px] leading-relaxed"
            style={{ color: "#A6E52E" }}
          >
            Your strength plan is kept. Still {strength.sessionsPerWeek}
            {strength.sessionsPerWeek === 1 ? " session" : " sessions"} a week,
            re-fitted around your new run days.
          </motion.p>
        ) : null}

        <motion.div {...rise(6)} className="mt-auto w-full pt-10">
          <Button full size="lg" onClick={onContinue}>
            See your plan
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
