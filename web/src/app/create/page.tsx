"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle } from "lucide-react";
import type { RaceDistance, RunnerLevel, TrainingDifficulty, TrainingVolume } from "@/lib/plan-engine/types";
import { Button } from "@/components/ui/Button";
import { WizardHeader, WizardTitle } from "@/components/ui/wizard";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { loadSettings, saveSettings } from "@/lib/settings";
import { StepGoal, type GoalTab } from "./steps/StepGoal";
import { StepLevel } from "./steps/StepLevel";
import { StepDays } from "./steps/StepDays";
import { StepAvailability } from "./steps/StepAvailability";
import { StepTimeline } from "./steps/StepTimeline";
import { StepPreferences } from "./steps/StepPreferences";
import { GeneratingOverlay } from "./steps/GeneratingOverlay";
import {
  DEFAULT_GOAL_SECONDS,
  GOAL_TIME_RANGES,
  POPULAR_RACES,
  RUNNER_LEVELS,
  SUGGESTED_DAYS,
  isoToday,
  suggestLongRunDay,
  weeksBetween,
  type PopularRace,
} from "./steps/data";

const STEPS = ["goal", "level", "days", "availability", "timeline", "preferences"] as const;
type Step = (typeof STEPS)[number];

function addWeeksIso(startIso: string, weeks: number): string {
  const d = new Date(startIso + "T12:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split("T")[0];
}

export default function CreatePlanPage() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const step: Step = STEPS[stepIdx];

  // ── Step 1: Goal ──────────────────────────────────────────────────────────
  const [goalTab, setGoalTab] = useState<GoalTab>("distances");
  const [raceDistance, setRaceDistance] = useState<RaceDistance | null>(null);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const timeTouched = useRef(false);

  // ── Step 2: Runner level ──────────────────────────────────────────────────
  const [runnerLevel, setRunnerLevel] = useState<RunnerLevel | null>(null);

  // ── Step 3+4: Days & availability ─────────────────────────────────────────
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [availableDays, setAvailableDays] = useState<number[]>(SUGGESTED_DAYS[4]);
  const [longRunDay, setLongRunDay] = useState<number | null>(6);

  // ── Step 5: Timeline ──────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(() => isoToday());
  const [blockWeeks, setBlockWeeks] = useState<8 | 12 | 16>(12);

  // ── Step 6: Preferences ───────────────────────────────────────────────────
  const [trainingVolume, setTrainingVolume] = useState<TrainingVolume>("medium");
  const [trainingDifficulty, setTrainingDifficulty] = useState<TrainingDifficulty>("moderate");
  const [paceLongRuns, setPaceLongRuns] = useState(true);
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState(30);
  const [longRunCapKm, setLongRunCapKm] = useState(0);
  const [easyRunMinKm, setEasyRunMinKm] = useState(0);
  const [hillyArea, setHillyArea] = useState(false);

  // Units display toggle (storage is always km)
  useEffect(() => {
    const s = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setPaceLongRuns(s.paceTargetsLongRuns);
  }, []);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const goalType: "distance" | "race" = selectedRaceId ? "race" : "distance";
  const lockedRace = POPULAR_RACES.find((r) => r.id === selectedRaceId) ?? null;
  const [customRaceDate, setCustomRaceDate] = useState<string>(() => addWeeksIso(isoToday(), 12));
  const raceDate = lockedRace ? lockedRace.date : goalType === "race" ? customRaceDate : addWeeksIso(startDate, blockWeeks);
  const goalTimeSeconds = hours * 3600 + minutes * 60 + seconds;

  // ── Handlers ──────────────────────────────────────────────────────────────
  function prefillGoalTime(distance: RaceDistance) {
    if (timeTouched.current) return;
    const s = DEFAULT_GOAL_SECONDS[distance];
    setHours(Math.floor(s / 3600));
    setMinutes(Math.floor((s % 3600) / 60));
    setSeconds(s % 60);
  }

  function handleDistance(d: RaceDistance) {
    setRaceDistance(d);
    setSelectedRaceId(null);
    prefillGoalTime(d);
  }

  function handleRace(race: PopularRace) {
    setSelectedRaceId(race.id);
    setRaceDistance(race.distance);
    prefillGoalTime(race.distance);
  }

  function touchTime(setter: (v: number) => void) {
    return (v: number) => {
      timeTouched.current = true;
      setter(v);
    };
  }

  function applyDays(n: number) {
    setDaysPerWeek(n);
    const suggested = SUGGESTED_DAYS[n] ?? SUGGESTED_DAYS[4];
    setAvailableDays(suggested);
    setLongRunDay(suggestLongRunDay(suggested));
  }

  function handleLevel(level: RunnerLevel) {
    setRunnerLevel(level);
    const d = RUNNER_LEVELS.find((l) => l.key === level)!.defaults;
    applyDays(d.daysPerWeek);
    setTrainingVolume(d.trainingVolume);
    setTrainingDifficulty(d.trainingDifficulty);
    setCurrentWeeklyKm(d.currentWeeklyKm);
  }

  function handleAvailableDays(days: number[]) {
    setAvailableDays(days);
    if (longRunDay !== null && !days.includes(longRunDay)) {
      setLongRunDay(days.length >= daysPerWeek ? suggestLongRunDay(days) : null);
    } else if (longRunDay === null && days.length >= daysPerWeek) {
      setLongRunDay(suggestLongRunDay(days));
    }
  }

  function handlePaceLongRuns(v: boolean) {
    haptic("light");
    setPaceLongRuns(v);
    saveSettings({ ...loadSettings(), paceTargetsLongRuns: v });
  }

  // ── Step gating ───────────────────────────────────────────────────────────
  function canContinue(): boolean {
    switch (step) {
      case "goal":
        return (
          raceDistance !== null &&
          goalTimeSeconds > 0 &&
          goalTimeSeconds >= GOAL_TIME_RANGES[raceDistance].wr
        );
      case "level":
        return runnerLevel !== null;
      case "days":
        return daysPerWeek >= 2 && daysPerWeek <= 6;
      case "availability":
        return (
          availableDays.length >= daysPerWeek &&
          longRunDay !== null &&
          availableDays.includes(longRunDay)
        );
      case "timeline":
        return weeksBetween(startDate, raceDate) > 0;
      case "preferences":
        return true;
    }
  }

  function ctaLabel(): string {
    if (step === "availability" && availableDays.length < daysPerWeek) {
      const remaining = daysPerWeek - availableDays.length;
      return `Pick ${remaining} more ${remaining === 1 ? "day" : "days"}`;
    }
    if (step === "preferences") return "Create plan";
    return "Continue";
  }

  function back() {
    haptic("light");
    if (stepIdx === 0) router.push("/");
    else setStepIdx((i) => i - 1);
  }

  async function next() {
    setError(null);
    if (stepIdx < STEPS.length - 1) {
      haptic("medium");
      setStepIdx((i) => i + 1);
      return;
    }
    // Final step — generate on the server.
    setSaving(true);
    haptic("medium");
    const minDelay = new Promise((resolve) => setTimeout(resolve, 2600));
    try {
      const body = {
        raceDistance,
        goalTimeSeconds,
        startDate: new Date(startDate).toISOString(),
        raceDate: new Date(raceDate).toISOString(),
        daysPerWeek,
        trainingVolume,
        trainingDifficulty,
        preferredLongRunDay: longRunDay,
        hillyArea,
        raceElevation: "flat",
        currentWeeklyKm,
        longRunCapKm,
        easyRunMinKm,
        runnerLevel,
        availableDays,
      };
      const res = await apiFetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message =
          res.status === 401
            ? "You're signed out. Please reconnect and try again."
            : (data.error ?? `Server error ${res.status}`);
        throw new Error(message);
      }
      const savedPlan = await res.json();
      await minDelay;
      haptic("success");
      router.push(`/plan?id=${savedPlan.id}`);
    } catch (e) {
      haptic("warning");
      setError(e instanceof Error ? e.message : "Failed to create plan");
      setSaving(false);
    }
  }

  // ── Titles ────────────────────────────────────────────────────────────────
  const TITLES: Record<Step, { title: string; sub: string }> = {
    goal: {
      title: "What are you training for?",
      sub: "Pick a distance, or find your race and we'll lock in the date.",
    },
    level: {
      title: "How would you describe yourself as a runner?",
      sub: "This tunes your starting volume and intensity — you can adjust everything later.",
    },
    days: {
      title: "How many days per week do you want to run?",
      sub: "Be honest about what fits your life. Consistency wins.",
    },
    availability: {
      title: "Which days work for you?",
      sub: `Pick at least ${daysPerWeek} training days, then choose your long-run day.`,
    },
    timeline: {
      title: goalType === "race" ? "When do you want to start?" : "Set your timeline",
      sub:
        goalType === "race"
          ? "We'll build every week from your start date to race day."
          : "Choose a start date and how long you want to train for.",
    },
    preferences: {
      title: "Fine-tune your training",
      sub: "Sensible defaults are already set from your level — tweak only if you want to.",
    },
  };

  return (
    <main className="flex min-h-dvh flex-col bg-bg">
      <WizardHeader
        progress={(stepIdx + 1) / STEPS.length}
        onBack={back}
        onClose={() => router.push("/")}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-32 pt-4">
        <div className="mx-auto w-full max-w-[430px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.18 }}
            >
              <WizardTitle title={TITLES[step].title} sub={TITLES[step].sub} />

              <div className="mt-6">
                {step === "goal" && (
                  <StepGoal
                    tab={goalTab}
                    onTab={setGoalTab}
                    raceDistance={raceDistance}
                    onDistance={handleDistance}
                    selectedRaceId={selectedRaceId}
                    onRace={handleRace}
                    hours={hours}
                    minutes={minutes}
                    seconds={seconds}
                    onHours={touchTime(setHours)}
                    onMinutes={touchTime(setMinutes)}
                    onSeconds={touchTime(setSeconds)}
                  />
                )}
                {step === "level" && <StepLevel value={runnerLevel} onChange={handleLevel} />}
                {step === "days" && (
                  <StepDays value={daysPerWeek} onChange={applyDays} runnerLevel={runnerLevel} />
                )}
                {step === "availability" && (
                  <StepAvailability
                    daysPerWeek={daysPerWeek}
                    availableDays={availableDays}
                    onAvailableDays={handleAvailableDays}
                    longRunDay={longRunDay}
                    onLongRunDay={setLongRunDay}
                  />
                )}
                {step === "timeline" && (
                  <StepTimeline
                    goalType={goalType}
                    startDate={startDate}
                    onStartDate={setStartDate}
                    raceDate={raceDate}
                    onRaceDate={setCustomRaceDate}
                    raceLocked={lockedRace !== null}
                    blockWeeks={blockWeeks}
                    onBlockWeeks={setBlockWeeks}
                  />
                )}
                {step === "preferences" && (
                  <StepPreferences
                    trainingVolume={trainingVolume}
                    onVolume={setTrainingVolume}
                    trainingDifficulty={trainingDifficulty}
                    onDifficulty={setTrainingDifficulty}
                    paceLongRuns={paceLongRuns}
                    onPaceLongRuns={handlePaceLongRuns}
                    currentWeeklyKm={currentWeeklyKm}
                    onCurrentWeeklyKm={setCurrentWeeklyKm}
                    longRunCapKm={longRunCapKm}
                    onLongRunCapKm={setLongRunCapKm}
                    easyRunMinKm={easyRunMinKm}
                    onEasyRunMinKm={setEasyRunMinKm}
                    hillyArea={hillyArea}
                    onHillyArea={setHillyArea}
                  />
                )}
              </div>

              {error && (
                <div
                  role="alert"
                  className="mt-4 flex items-start gap-2 rounded-[var(--radius-input)] bg-danger/10 px-4 py-3 text-sm text-danger"
                >
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
                  <span>{error}</span>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Pinned CTA */}
      <div
        className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[var(--k-bg)] via-[var(--k-bg)] to-transparent px-4 pt-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
      >
        <div className="mx-auto max-w-[430px]">
          <Button full size="lg" busy={saving} disabled={!canContinue()} onClick={next}>
            {ctaLabel()}
          </Button>
        </div>
      </div>

      <AnimatePresence>{saving && <GeneratingOverlay />}</AnimatePresence>
    </main>
  );
}
