"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { CalendarDays, Dumbbell, HeartPulse, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";

interface Slide {
  icon: LucideIcon;
  title: string;
  body: string;
}

// The three things about Kadenz that aren't self-evident from tapping around:
// the plan reacts to logged runs (not the other way round), Kraft is a real
// programme that tracks the running phase rather than a static list, and
// readiness is computed daily rather than a vanity number.
const SLIDES: Slide[] = [
  {
    icon: CalendarDays,
    title: "Your plan reacts to you",
    body: "Log a run and the rest of the week recalculates around what you actually did, not what was planned.",
  },
  {
    icon: Dumbbell,
    title: "Kraft tracks your phase",
    body: "Strength sessions live in the Kraft tab and progress on the weight you actually lift. Volume shifts with your running phase, lighter in peak weeks, more room once you taper.",
  },
  {
    icon: HeartPulse,
    title: "Readiness, every morning",
    body: "Sleep, resting heart rate and your recent training load set a readiness score on Today, so you know whether to push or ease off before you start.",
  },
];

/**
 * Shown once, right after the first successful sign-in lands on Today.
 * Three short cards, skippable at any point, never re-shown once dismissed —
 * the caller persists that via settings.onboardingSeen.
 */
export function FirstRunWalkthrough({ onDone }: { onDone: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;

  function advance() {
    haptic("medium");
    if (last) {
      onDone();
    } else {
      setIndex((i) => i + 1);
    }
  }

  function skip() {
    haptic("light");
    onDone();
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24 }}
      className="k-dark-surface fixed inset-0 z-[60] flex flex-col"
      style={{ background: "var(--k-bg-grad)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Getting started"
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-1 flex-col px-6 pb-10 safe-top">
        <div className="flex items-center gap-4 pt-4">
          <div className="flex flex-1 gap-1.5" role="progressbar" aria-valuenow={index + 1} aria-valuemin={1} aria-valuemax={SLIDES.length}>
            {SLIDES.map((_, i) => (
              <span
                key={i}
                className="h-1 flex-1 rounded-full"
                style={{ background: i <= index ? "var(--k-accent)" : "var(--k-hairline)" }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={skip}
            className="press shrink-0 text-[13px] font-semibold text-text-3"
          >
            Skip
          </button>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <AnimatePresence mode="wait">
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
              className="flex flex-col items-center"
            >
              <span
                className="flex h-16 w-16 items-center justify-center rounded-full"
                style={{ background: "var(--k-accent-grad)" }}
              >
                <slide.icon size={28} strokeWidth={2} color="#0B0B0F" />
              </span>
              <h1 className="mt-6 text-[26px] font-extrabold leading-tight tracking-tight text-text-1 [text-wrap:balance]">
                {slide.title}
              </h1>
              <p className="mt-3 max-w-[300px] text-[15px] leading-relaxed text-text-3">
                {slide.body}
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <Button full size="lg" onClick={advance}>
          {last ? "Got it" : "Next"}
        </Button>
      </div>
    </motion.div>
  );
}
