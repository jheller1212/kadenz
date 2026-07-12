"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ChevronRight, Play, Pause, Check, MapPin, MapPinOff } from "lucide-react";
import { formatPace } from "@/lib/plan-engine/pace-zones";
import { loadSettings, type UserSettings } from "@/lib/settings";
import { haptic } from "@/lib/haptics";

// ── Guided run player ─────────────────────────────────────────────────────────
// Walks a run's blocks step-by-step with spoken/beeped coaching, background-safe
// timestamp timers, an optional GPS layer for live distance/pace/splits, and a
// Wake Lock so the screen stays on. Self-contained (its own audio + wake-lock)
// so it never entangles with the strength GuidedSession.

export interface GuidedRunBlock {
  type: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  targetPaceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  reps?: number | null;
  repDistanceKm?: number | null;
  repRestSeconds?: number | null;
  sortOrder: number;
}

export interface GuidedRunFinish {
  elapsedSeconds: number;
  distanceKm: number | null; // null when GPS was off/unavailable
}

interface Step {
  kind: "segment" | "interval" | "rest";
  label: string;
  detail: string;
  targetKm?: number;
  targetSeconds?: number;
  paceSecKm?: number | null;
  minPaceSecKm?: number | null;
  maxPaceSecKm?: number | null;
  restSeconds?: number;
  speech: string;
}

const BLOCK_LABEL: Record<string, string> = {
  warmup: "Warm-up",
  work: "Main set",
  recovery: "Recovery jog",
  cooldown: "Cool-down",
};

function paceSpeech(secKm?: number | null): string {
  if (!secKm) return "";
  const m = Math.floor(secKm / 60);
  const s = Math.round(secKm % 60);
  const pace = s === 0 ? `${m} minute` : `${m} ${s < 10 ? "oh " : ""}${s}`;
  return ` at ${pace} per kilometre`;
}

// Flatten workout blocks into an ordered step list.
function buildSteps(blocks: GuidedRunBlock[]): Step[] {
  const steps: Step[] = [];
  const sorted = [...blocks].sort((a, b) => a.sortOrder - b.sortOrder);

  for (const b of sorted) {
    const isInterval = b.type === "work" && (b.reps ?? 0) > 1 && b.repDistanceKm;
    if (isInterval) {
      const reps = b.reps!;
      const repKm = b.repDistanceKm!;
      const meters = Math.round(repKm * 1000);
      for (let r = 1; r <= reps; r++) {
        steps.push({
          kind: "interval",
          label: `Interval ${r} of ${reps}`,
          detail: `${meters}m`,
          targetKm: repKm,
          paceSecKm: b.targetPaceSecKm ?? null,
          minPaceSecKm: b.minPaceSecKm ?? null,
          maxPaceSecKm: b.maxPaceSecKm ?? null,
          speech: `Interval ${r} of ${reps}. ${meters} metres${paceSpeech(b.targetPaceSecKm)}. Go!`,
        });
        if (r < reps && (b.repRestSeconds ?? 0) > 0) {
          steps.push({
            kind: "rest",
            label: "Recover",
            detail: `${b.repRestSeconds}s easy`,
            restSeconds: b.repRestSeconds!,
            speech: `Recover for ${b.repRestSeconds} seconds.`,
          });
        }
      }
      continue;
    }

    // Single segment (warmup / cooldown / recovery / easy / tempo / long).
    const label = BLOCK_LABEL[b.type] ?? "Run";
    const km = b.distanceKm ?? undefined;
    const mins = b.durationMinutes ?? undefined;
    const detail = km ? `${km} km` : mins ? `${mins} min` : "";
    const target =
      km != null
        ? `${km} kilometre${km === 1 ? "" : "s"}`
        : mins != null
        ? `${mins} minute${mins === 1 ? "" : "s"}`
        : "";
    steps.push({
      kind: "segment",
      label,
      detail,
      targetKm: km,
      targetSeconds: mins != null ? mins * 60 : undefined,
      paceSecKm: b.targetPaceSecKm ?? null,
      minPaceSecKm: b.minPaceSecKm ?? null,
      maxPaceSecKm: b.maxPaceSecKm ?? null,
      speech: `${label}. ${target}${paceSpeech(b.targetPaceSecKm)}.`,
    });
  }

  // Fallback: a workout with no structured blocks → one open segment.
  if (steps.length === 0) {
    steps.push({
      kind: "segment",
      label: "Run",
      detail: "",
      speech: "Start your run.",
    });
  }
  return steps;
}

// Haversine distance between two lat/lng points, in metres.
function haversine(a: GeolocationCoordinates, b: GeolocationCoordinates): number {
  const R = 6371000;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const lat1 = (a.latitude * Math.PI) / 180;
  const lat2 = (b.latitude * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function fmtClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function GuidedRun({
  title,
  blocks,
  useMiles,
  onFinish,
  onClose,
}: {
  title: string;
  blocks: GuidedRunBlock[];
  useMiles: boolean;
  onFinish: (summary: GuidedRunFinish) => void;
  onClose: () => void;
}) {
  const prefsRef = useRef<UserSettings>(loadSettings());
  const [steps] = useState<Step[]>(() => buildSteps(blocks));
  const [stepIdx, setStepIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  // All render-facing derived values live in state, updated by the ticker —
  // render never reads mutable refs directly (React purity rules).
  const [view, setView] = useState<{
    elapsed: number;
    distKm: number;
    pace: number | null;
    paceInRange: boolean | null;
    restRem: number | null;
  }>({ elapsed: 0, distKm: 0, pace: null, paceInRange: null, restRem: null });

  // Timestamp-based clocks (survive re-renders / backgrounding).
  const startRef = useRef<number | null>(null); // run start (ms), minus paused time
  const pausedAtRef = useRef<number | null>(null);
  const stepStartRef = useRef<number>(0); // elapsed seconds at current step start
  const restEndRef = useRef<number | null>(null);
  const lastRestBeepRef = useRef<number>(-1);

  // GPS state.
  const [gpsOn, setGpsOn] = useState(false);
  const [gpsDenied, setGpsDenied] = useState(false);
  const watchRef = useRef<number | null>(null);
  const lastFixRef = useRef<GeolocationCoordinates | null>(null);
  const distanceMRef = useRef(0); // total metres
  const stepStartDistRef = useRef(0);
  const livePaceRef = useRef<number | null>(null);
  const splitUnitM = useMiles ? 1609.344 : 1000;
  const nextSplitRef = useRef(1); // next split index to announce
  const splitStartTimeRef = useRef(0);

  const wakeRef = useRef<{ release: () => Promise<void> } | null>(null);

  // ── Audio (best-effort, own instance) ──────────────────────────────────────
  const audioCtxRef = useRef<AudioContext | null>(null);
  const beep = useCallback((freq = 660, ms = 80) => {
    const p = prefsRef.current;
    if (!p.runAudio) return;
    try {
      if (!audioCtxRef.current) {
        const AC =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
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
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + ms / 1000);
      osc.start();
      osc.stop(ctx.currentTime + ms / 1000);
    } catch {
      /* ignore */
    }
  }, []);

  const speak = useCallback((text: string) => {
    const p = prefsRef.current;
    if (!p.runAudio || !p.runVoice) return;
    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const elapsed = useCallback(() => {
    if (startRef.current == null) return 0;
    const now = pausedAtRef.current ?? Date.now();
    return (now - startRef.current) / 1000;
  }, []);

  // ── Start / step transitions ───────────────────────────────────────────────
  const enterStep = useCallback(
    (idx: number) => {
      const step = steps[idx];
      if (!step) return;
      stepStartRef.current = elapsed();
      stepStartDistRef.current = distanceMRef.current;
      restEndRef.current =
        step.kind === "rest" && step.restSeconds
          ? Date.now() + step.restSeconds * 1000
          : null;
      lastRestBeepRef.current = -1;
      haptic("medium");
      beep(step.kind === "rest" ? 520 : 780, 120);
      speak(step.speech);
    },
    [steps, elapsed, beep, speak]
  );

  const goToStep = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(steps.length - 1, idx));
      setStepIdx(clamped);
      enterStep(clamped);
    },
    [steps.length, enterStep]
  );

  const finish = useCallback(() => {
    beep(880, 200);
    speak("Workout complete. Great work!");
    haptic("success");
    if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
    wakeRef.current?.release().catch(() => {});
    onFinish({
      elapsedSeconds: Math.round(elapsed()),
      distanceKm: gpsOn ? Math.round((distanceMRef.current / 1000) * 100) / 100 : null,
    });
  }, [beep, speak, elapsed, gpsOn, onFinish]);

  const nextStep = useCallback(() => {
    if (stepIdx >= steps.length - 1) {
      finish();
      return;
    }
    goToStep(stepIdx + 1);
  }, [stepIdx, steps.length, finish, goToStep]);

  // ── Mount: start clock, wake lock; unmount: cleanup ─────────────────────────
  useEffect(() => {
    prefsRef.current = loadSettings();
    startRef.current = Date.now();
    splitStartTimeRef.current = 0;
    // Prime audio within the launching gesture chain.
    beep(700, 60);
    speak(steps[0]?.speech ?? "Start your run.");
    stepStartRef.current = 0;

    if (prefsRef.current.runKeepAwake) {
      const nav = navigator as unknown as {
        wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
      };
      nav.wakeLock
        ?.request("screen")
        .then((w) => (wakeRef.current = w))
        .catch(() => {});
    }

    if (prefsRef.current.runGps && "geolocation" in navigator) {
      watchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsOn(true);
          const c = pos.coords;
          if (typeof c.speed === "number" && c.speed > 0.3) {
            livePaceRef.current = 1000 / c.speed;
          }
          const prev = lastFixRef.current;
          if (prev && (c.accuracy == null || c.accuracy < 35)) {
            const d = haversine(prev, c);
            // Reject GPS jitter / teleports.
            if (d > 1 && d < 60) distanceMRef.current += d;
          }
          lastFixRef.current = c;
        },
        () => setGpsDenied(true),
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
      );
    }

    return () => {
      if (watchRef.current != null) navigator.geolocation.clearWatch(watchRef.current);
      wakeRef.current?.release().catch(() => {});
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* ignore */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Re-acquire wake lock on visibility return ───────────────────────────────
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === "visible" && prefsRef.current.runKeepAwake) {
        const nav = navigator as unknown as {
          wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> };
        };
        nav.wakeLock
          ?.request("screen")
          .then((w) => (wakeRef.current = w))
          .catch(() => {});
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // ── Ticker: drives clocks, rest countdown, auto-advance, split cues ─────────
  useEffect(() => {
    const id = setInterval(() => {
      if (paused) return;
      const step = steps[stepIdx];
      if (!step) return;

      // Rest countdown → beep last 3s, auto-advance at 0.
      if (step.kind === "rest" && restEndRef.current != null) {
        const remMs = restEndRef.current - Date.now();
        const remSec = Math.ceil(remMs / 1000);
        if (remSec <= 3 && remSec > 0 && remSec !== lastRestBeepRef.current) {
          lastRestBeepRef.current = remSec;
          beep(remSec === 1 ? 900 : 620, remSec === 1 ? 160 : 80);
        }
        if (remMs <= 0) {
          nextStep();
          return;
        }
      }

      // Distance-target auto-advance (GPS only).
      if (gpsOn && step.targetKm != null) {
        const coveredKm = (distanceMRef.current - stepStartDistRef.current) / 1000;
        if (coveredKm >= step.targetKm) {
          nextStep();
          return;
        }
      }

      // Duration-target auto-advance.
      if (step.targetSeconds != null) {
        const inStep = elapsed() - stepStartRef.current;
        if (inStep >= step.targetSeconds) {
          nextStep();
          return;
        }
      }

      // Split announcements (GPS).
      if (gpsOn && prefsRef.current.runSplitCues) {
        const units = Math.floor(distanceMRef.current / splitUnitM);
        if (units >= nextSplitRef.current) {
          const now = elapsed();
          const splitSecs = now - splitStartTimeRef.current;
          splitStartTimeRef.current = now;
          nextSplitRef.current = units + 1;
          const m = Math.floor(splitSecs / 60);
          const s = Math.round(splitSecs % 60);
          const unitWord = useMiles ? "mile" : "kilometre";
          speak(`${units} ${unitWord}${units === 1 ? "" : "s"}. ${m} ${s < 10 ? "oh " : ""}${s}.`);
          beep(760, 90);
        }
      }

      // Publish derived display values to state.
      const totalElapsed = elapsed();
      let pace: number | null = null;
      if (gpsOn) {
        pace = livePaceRef.current;
        if (pace == null) {
          const coveredKm = (distanceMRef.current - stepStartDistRef.current) / 1000;
          const inStep = totalElapsed - stepStartRef.current;
          if (coveredKm > 0.05 && inStep > 5) pace = inStep / coveredKm;
        }
      }
      const paceInRange =
        pace != null && step.minPaceSecKm != null && step.maxPaceSecKm != null
          ? pace >= step.minPaceSecKm && pace <= step.maxPaceSecKm
          : null;
      const restRem =
        step.kind === "rest" && restEndRef.current != null
          ? Math.max(0, Math.ceil((restEndRef.current - Date.now()) / 1000))
          : null;
      setView({
        elapsed: totalElapsed,
        distKm: distanceMRef.current / 1000,
        pace,
        paceInRange,
        restRem,
      });
    }, 500);
    return () => clearInterval(id);
  }, [paused, stepIdx, steps, gpsOn, elapsed, beep, nextStep, speak, splitUnitM, useMiles]);

  function togglePause() {
    haptic("light");
    if (paused) {
      // Resume: shift start + rest-end forward by the paused duration.
      if (pausedAtRef.current != null && startRef.current != null) {
        const delta = Date.now() - pausedAtRef.current;
        startRef.current += delta;
        if (restEndRef.current != null) restEndRef.current += delta;
      }
      pausedAtRef.current = null;
      setPaused(false);
    } else {
      pausedAtRef.current = Date.now();
      setPaused(true);
    }
  }

  const step = steps[stepIdx];
  const totalElapsed = view.elapsed;
  const dispDist = useMiles ? view.distKm * 0.621371 : view.distKm;
  const displayPace = view.pace;
  const paceInRange = view.paceInRange;
  const restRem = view.restRem;

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex flex-col bg-bg"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
    >
      {/* Header */}
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
          aria-label="Close guided run"
        >
          <X className="h-5 w-5 text-text-2" strokeWidth={2} />
        </button>
        <p className="text-[13px] font-semibold text-text-2 truncate px-2">{title}</p>
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full"
          aria-label={gpsOn ? "GPS active" : gpsDenied ? "GPS unavailable" : "Acquiring GPS"}
          title={gpsOn ? "GPS active" : gpsDenied ? "GPS unavailable" : "Acquiring GPS"}
        >
          {gpsDenied ? (
            <MapPinOff className="h-5 w-5 text-text-3" strokeWidth={2} />
          ) : (
            <MapPin
              className={`h-5 w-5 ${gpsOn ? "text-accent" : "text-text-3"}`}
              strokeWidth={2}
            />
          )}
        </div>
      </div>

      {/* Big clock + distance */}
      <div className="px-4 pt-2">
        <div className="flex items-baseline justify-center gap-6">
          <div className="text-center">
            <p className="text-[52px] font-extrabold tabular-nums leading-none text-text-1">
              {fmtClock(totalElapsed)}
            </p>
            <p className="mt-1 text-[11px] uppercase tracking-wider text-text-3">Elapsed</p>
          </div>
        </div>
        {gpsOn && (
          <div className="mt-4 flex items-center justify-center gap-8">
            <div className="text-center">
              <p className="text-[24px] font-extrabold tabular-nums leading-none text-text-1">
                {dispDist.toFixed(2)}
                <span className="text-[13px] font-semibold text-text-3">
                  {useMiles ? " mi" : " km"}
                </span>
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-text-3">Distance</p>
            </div>
            <div className="text-center">
              <p
                className="text-[24px] font-extrabold tabular-nums leading-none"
                style={{
                  color:
                    paceInRange == null
                      ? "var(--k-text-1)"
                      : paceInRange
                      ? "var(--k-accent)"
                      : "#FFB547",
                }}
              >
                {displayPace ? formatPace(displayPace, useMiles) : "—:—"}
              </p>
              <p className="mt-1 text-[11px] uppercase tracking-wider text-text-3">
                {useMiles ? "/mi" : "/km"}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Current step card */}
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={stepIdx}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.2 }}
            className="w-full max-w-sm k-card p-6 text-center"
          >
            <p className="text-[13px] font-semibold uppercase tracking-wider text-accent">
              Step {stepIdx + 1} of {steps.length}
            </p>
            <h2 className="mt-2 text-[28px] font-extrabold tracking-tight text-text-1">
              {step?.label}
            </h2>
            {step?.kind === "rest" && restRem != null ? (
              <p className="mt-3 text-[56px] font-extrabold tabular-nums leading-none text-text-1">
                {restRem}
                <span className="text-[18px] font-semibold text-text-3">s</span>
              </p>
            ) : (
              <>
                {step?.detail && (
                  <p className="mt-2 text-[20px] font-bold text-text-1">{step.detail}</p>
                )}
                {step?.paceSecKm != null && (
                  <p className="mt-1 text-[15px] text-text-2">
                    Target {formatPace(step.paceSecKm, useMiles)}
                    {useMiles ? "/mi" : "/km"}
                  </p>
                )}
                {step?.minPaceSecKm != null && step?.maxPaceSecKm != null && (
                  <p className="mt-0.5 text-[13px] text-text-3">
                    {formatPace(step.minPaceSecKm, useMiles)}–
                    {formatPace(step.maxPaceSecKm, useMiles)}
                    {useMiles ? "/mi" : "/km"}
                  </p>
                )}
              </>
            )}

            {/* Next-up preview */}
            {stepIdx < steps.length - 1 && (
              <p className="mt-5 text-[12px] text-text-3">
                Next: {steps[stepIdx + 1].label}
                {steps[stepIdx + 1].detail ? ` · ${steps[stepIdx + 1].detail}` : ""}
              </p>
            )}
          </motion.div>
        </AnimatePresence>

        {paused && (
          <p className="mt-4 text-[13px] font-semibold uppercase tracking-wider text-warn">
            Paused
          </p>
        )}
      </div>

      {/* Controls */}
      <div
        className="flex items-center gap-3 px-4 pb-6"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <button
          onClick={togglePause}
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
            nextStep();
          }}
          className="press flex h-14 flex-1 items-center justify-center gap-2 rounded-full bg-accent text-[16px] font-bold text-on-accent"
        >
          {stepIdx >= steps.length - 1 ? (
            <>
              <Check className="h-5 w-5" strokeWidth={2.4} /> Finish
            </>
          ) : (
            <>
              Next step <ChevronRight className="h-5 w-5" strokeWidth={2.4} />
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}
