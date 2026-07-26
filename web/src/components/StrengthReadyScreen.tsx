"use client";

import { motion } from "motion/react";
import { Button } from "@/components/ui/Button";

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Stat({ value, unit, label }: { value: string; unit?: string; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center">
      <div className="flex items-baseline gap-0.5">
        <span className="font-display text-[34px] leading-none text-text-1 tabular-nums">
          {value}
        </span>
        {unit ? <span className="text-[13px] font-medium text-text-3">{unit}</span> : null}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold uppercase tracking-[1.2px] text-text-3">
        {label}
      </div>
    </div>
  );
}

/**
 * Shown once the strength schedule exists, mirroring the running plan's reveal.
 * Setting strength up used to drop the athlete straight back onto the Kraft hub
 * with no confirmation that anything had been created.
 */
export function StrengthReadyScreen({
  sessionsPerWeek,
  durationMinutes,
  availableDays,
  scheduled,
  followsRunningPlan,
  onContinue,
}: {
  sessionsPerWeek: number;
  durationMinutes: number;
  availableDays: number[];
  /** Sessions the scheduler actually placed, when it reported a count. */
  scheduled: number | null;
  /** True when the schedule is fitted around an existing running plan. */
  followsRunningPlan: boolean;
  onContinue: () => void;
}) {
  const rise = (i: number) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: 0.08 * i, duration: 0.42, ease: [0.32, 0.72, 0, 1] as const },
  });

  // Monday-first, matching how the rest of the app orders a week.
  const days = [...availableDays]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => DAY_LABEL[d])
    .join(", ");

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
          Your strength plan is ready
        </motion.h1>

        <motion.p {...rise(2)} className="mt-2 w-full text-center text-[15px] text-text-3">
          {followsRunningPlan
            ? "Fitted around your running plan"
            : "A standalone strength block"}
        </motion.p>

        <motion.div
          {...rise(3)}
          className="mt-9 flex w-full items-start justify-between gap-2 border-y py-6"
          style={{ borderColor: "rgba(255,255,255,.08)" }}
        >
          <Stat value={String(sessionsPerWeek)} unit="/wk" label="Sessions" />
          <Stat value={String(durationMinutes)} unit="min" label="Each" />
          {scheduled != null && scheduled > 0 ? (
            <Stat value={String(scheduled)} label="Scheduled" />
          ) : null}
        </motion.div>

        {days ? (
          <motion.p {...rise(4)} className="mt-5 w-full text-center text-[13px] text-text-3">
            On {days}
          </motion.p>
        ) : null}

        <motion.p
          {...rise(5)}
          className="mt-4 w-full text-center text-[13px] leading-relaxed"
          style={{ color: "#A6E52E" }}
        >
          {followsRunningPlan
            ? "Sessions sit on the days your runs leave free."
            : "Loads start conservative and rise from what you actually lift."}
        </motion.p>

        <motion.div {...rise(6)} className="mt-auto w-full pt-10">
          <Button full size="lg" onClick={onContinue}>
            See your sessions
          </Button>
        </motion.div>
      </div>
    </motion.div>
  );
}
