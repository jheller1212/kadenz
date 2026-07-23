"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronRight, Play, Pause, Check } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { CUE_VOLUME_GAIN, loadSettings } from "@/lib/settings";
import { routineSeconds, type Routine } from "@/lib/warmup";

// A lightweight guided player for a warm-up / mobility routine: steps through
// timed drills with a per-drill countdown, a beep on each transition, and
// skip / pause. Self-contained (own audio + timer) — never touches the run/lift
// guided players.
export function WarmupPlayer({ routine, onClose }: { routine: Routine; onClose: () => void }) {
  const drills = routine.drills;
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(drills[0]?.seconds ?? 0);
  const [paused, setPaused] = useState(false);
  const [done, setDone] = useState(false);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const beep = useCallback((freq = 720, ms = 90) => {
    const p = loadSettings();
    if (!p.runAudio) return;
    const peak = CUE_VOLUME_GAIN[p.cueVolume];
    if (peak <= 0) return;
    try {
      if (!audioCtxRef.current) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AC) audioCtxRef.current = new AC();
      }
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(peak, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch {
      /* ignore */
    }
  }, []);

  const advance = useCallback(() => {
    setIdx((i) => {
      const next = i + 1;
      if (next >= drills.length) {
        setDone(true);
        beep(920, 200);
        haptic("success");
        return i;
      }
      setRemaining(drills[next].seconds);
      beep(780, 120);
      haptic("medium");
      return next;
    });
  }, [drills, beep]);

  // Prime audio on mount (within the launching gesture chain).
  useEffect(() => {
    beep(700, 60);
  }, [beep]);

  // Mirror `remaining` into a ref so the ticker can read it without putting
  // side effects (beep/advance) inside a setState updater — those must stay pure
  // (React StrictMode double-invokes updaters, which would double-beep).
  const remainingRef = useRef(remaining);
  useEffect(() => {
    remainingRef.current = remaining;
  }, [remaining]);

  // 1-second countdown ticker; beeps the last few seconds, auto-advances at 0.
  useEffect(() => {
    if (paused || done) return;
    const id = setInterval(() => {
      const r = remainingRef.current;
      if (r <= 1) {
        advance();
      } else {
        if (r <= 4) beep(600, 70);
        setRemaining(r - 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [paused, done, advance, beep]);

  const drill = drills[idx];
  const total = routineSeconds(routine);
  const elapsedBefore = drills.slice(0, idx).reduce((s, d) => s + d.seconds, 0);
  const progress = total > 0 ? Math.min(1, (elapsedBefore + (drill ? drill.seconds - remaining : 0)) / total) : 0;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col bg-bg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      <div
        className="flex items-center justify-between px-4 pt-3 pb-2"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
      >
        <button
          onClick={() => {
            haptic("light");
            onClose();
          }}
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated"
          aria-label="Close warm-up"
        >
          <X className="h-5 w-5 text-text-2" strokeWidth={2} />
        </button>
        <p className="text-[13px] font-semibold text-text-2">{routine.title}</p>
        <div className="h-9 w-9" />
      </div>

      {/* Progress */}
      <div className="px-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-elevated">
          <div className="h-full rounded-full bg-accent" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center px-6">
        {done ? (
          <div className="text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-accent">
              <Check className="h-8 w-8 text-on-accent" strokeWidth={2.6} />
            </div>
            <h2 className="mt-4 text-[26px] font-extrabold tracking-tight text-text-1">Warm-up done</h2>
            <p className="mt-1 text-[14px] text-text-2">Nicely done — go get your run.</p>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={idx}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.2 }}
              className="w-full max-w-sm text-center"
            >
              <p className="text-[13px] font-semibold uppercase tracking-wider text-accent-fg">
                Drill {idx + 1} of {drills.length}
              </p>
              <h2 className="mt-2 text-[28px] font-extrabold tracking-tight text-text-1">{drill?.name}</h2>
              <p className="mt-2 text-[15px] text-text-2">{drill?.cue}</p>
              <p className="mt-5 text-[64px] font-extrabold tabular-nums leading-none text-text-1">
                {remaining}
                <span className="text-[20px] font-semibold text-text-3">s</span>
              </p>
              {idx < drills.length - 1 && (
                <p className="mt-5 text-[12px] text-text-3">Next: {drills[idx + 1].name}</p>
              )}
              {paused && (
                <p className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-warn">Paused</p>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Controls */}
      <div
        className="flex items-center gap-3 px-4 pb-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {done ? (
          <button
            onClick={() => {
              haptic("medium");
              onClose();
            }}
            className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-on-accent"
          >
            Done
          </button>
        ) : (
          <>
            <button
              onClick={() => {
                haptic("light");
                setPaused((p) => !p);
              }}
              className="press flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-elevated"
              aria-label={paused ? "Resume" : "Pause"}
            >
              {paused ? (
                <Play className="h-6 w-6 text-text-1" strokeWidth={2} fill="currentColor" />
              ) : (
                <Pause className="h-6 w-6 text-text-1" strokeWidth={2} fill="currentColor" />
              )}
            </button>
            <button
              onClick={() => {
                haptic("medium");
                advance();
              }}
              className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-on-accent"
            >
              {idx >= drills.length - 1 ? (
                <>
                  <Check className="h-5 w-5" strokeWidth={2.4} /> Finish
                </>
              ) : (
                <>
                  Skip <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
                </>
              )}
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}
