"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { AlertCircle, Trophy, TrendingUp, Activity, HeartPulse } from "lucide-react";
import type { PlanIntent, RaceDistance, RunnerLevel, TrainingDifficulty, TrainingVolume } from "@/lib/plan-engine/types";
import { Button } from "@/components/ui/Button";
import { WizardHeader, WizardTitle } from "@/components/ui/wizard";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { loadSettings, saveSettings } from "@/lib/settings";
import { StepGoal, type GoalTab } from "./steps/StepGoal";
import { StepLevel } from "./steps/StepLevel";
import { StepVariant } from "./steps/StepVariant";
import { StepDays } from "./steps/StepDays";
import { StepAvailability } from "./steps/StepAvailability";
import { StepTimeline } from "./steps/StepTimeline";
import { StepPreferences } from "./steps/StepPreferences";
import { PlanBuildingLoader } from "@/components/PlanBuildingLoader";
import {
  DEFAULT_GOAL_SECONDS,
  GOAL_TIME_RANGES,
  POPULAR_RACES,
  RUNNER_LEVELS,
  SUGGESTED_DAYS,
  VARIANTS,
  isoToday,
  suggestLongRunDay,
  weeksBetween,
  type PopularRace,
  type PlanVariant,
} from "./steps/data";

const STEPS = ["goal", "level", "variant", "days", "availability", "timeline", "preferences"] as const;
type Step = (typeof STEPS)[number];

function addWeeksIso(startIso: string, weeks: number): string {
  const d = new Date(startIso + "T12:00:00");
  d.setDate(d.getDate() + weeks * 7);
  return d.toISOString().split("T")[0];
}

const INTENT_OPTIONS: {
  key: PlanIntent;
  label: string;
  sub: string;
  Icon: typeof Trophy;
}[] = [
  { key: "race", label: "Train for a race", sub: "Goal time, peak & taper to race day", Icon: Trophy },
  { key: "get_fit", label: "Get fitter", sub: "Build fitness, no race, no goal time", Icon: TrendingUp },
  { key: "maintain", label: "Maintain", sub: "Hold your fitness at low time cost", Icon: Activity },
  { key: "return", label: "Return to running", sub: "Back from injury or illness, run/walk, eased in", Icon: HeartPulse },
];

function IntentSelector({
  value,
  onChange,
}: {
  value: PlanIntent;
  onChange: (i: PlanIntent) => void;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {INTENT_OPTIONS.map(({ key, label, sub, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            onClick={() => onChange(key)}
            className={`press flex items-center gap-3 rounded-[var(--radius-card)] border p-4 text-left ${
              active ? "border-accent bg-accent/10" : "border-hairline bg-elevated"
            }`}
          >
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                active ? "bg-accent text-on-accent" : "bg-bg text-text-2"
              }`}
            >
              <Icon className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-bold text-text-1">{label}</span>
              <span className="block text-[13px] text-text-3">{sub}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function CreatePlanPage() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const step: Step = STEPS[stepIdx];

  // ── Step 1: Goal ──────────────────────────────────────────────────────────
  const [intent, setIntent] = useState<PlanIntent>("race");
  const [goalTab, setGoalTab] = useState<GoalTab>("distances");
  const [raceDistance, setRaceDistance] = useState<RaceDistance | null>(null);
  const [customDistanceKm, setCustomDistanceKm] = useState<number | null>(15);
  const [selectedRaceId, setSelectedRaceId] = useState<string | null>(null);
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const timeTouched = useRef(false);

  // ── Step 2: Runner level ──────────────────────────────────────────────────
  const [runnerLevel, setRunnerLevel] = useState<RunnerLevel | null>(null);

  // ── Step: Variant (style for the chosen intent) ───────────────────────────
  const [variantKey, setVariantKey] = useState<string | null>(null);

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
  // Flips once the plan really exists; the loader lands its bar on 100% and
  // then calls back to navigate, so the bar never claims completion early.
  const [built, setBuilt] = useState(false);
  const builtPlanId = useRef<string | null>(null);
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

  function handleIntent(i: PlanIntent) {
    haptic("light");
    setIntent(i);
    // Variants are per-intent, clear the previous pick.
    setVariantKey(null);
    // Non-race plans have no race/goal, drop any locked race selection.
    if (i !== "race") setSelectedRaceId(null);
  }

  function applyVariant(v: PlanVariant) {
    setVariantKey(v.key);
    if (v.apply.trainingDifficulty) setTrainingDifficulty(v.apply.trainingDifficulty);
    if (v.apply.trainingVolume) setTrainingVolume(v.apply.trainingVolume);
    if (v.apply.daysPerWeek) applyDays(v.apply.daysPerWeek);
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
        if (intent !== "race") return true; // non-race needs no distance/goal time
        if (raceDistance === "custom" && !(customDistanceKm && customDistanceKm > 0)) {
          return false;
        }
        return (
          raceDistance !== null &&
          goalTimeSeconds > 0 &&
          goalTimeSeconds >= GOAL_TIME_RANGES[raceDistance].wr
        );
      case "level":
        return runnerLevel !== null;
      case "variant":
        return variantKey !== null;
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
    // Final step, generate on the server.
    setSaving(true);
    haptic("medium");
    try {
      const common = {
        intent,
        startDate: new Date(startDate).toISOString(),
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
      const body =
        intent === "race"
          ? {
              ...common,
              raceDistance,
              goalTimeSeconds,
              raceDate: new Date(raceDate).toISOString(),
              ...(raceDistance === "custom" && customDistanceKm
                ? { customDistanceKm }
                : {}),
            }
          : { ...common, planLengthWeeks: blockWeeks };
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
      haptic("success");
      builtPlanId.current = savedPlan.id;
      setBuilt(true);
    } catch (e) {
      haptic("warning");
      setError(e instanceof Error ? e.message : "Failed to create plan");
      setSaving(false);
      setBuilt(false);
    }
  }

  // ── Titles ────────────────────────────────────────────────────────────────
  const TITLES: Record<Step, { title: string; sub: string }> = {
    goal: {
      title: "What's this plan for?",
      sub:
        intent === "race"
          ? "Pick a distance, or find your race and we'll lock in the date."
          : "No race in mind? Build fitness or just keep it ticking over.",
    },
    level: {
      title: "How would you describe yourself as a runner?",
      sub: "This tunes your starting volume and intensity, you can adjust everything later.",
    },
    variant: {
      title: "Pick a style",
      sub: "Choose the flavour of your plan, swipe to compare. You can fine-tune it later.",
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
      sub: "Sensible defaults are already set from your level, tweak only if you want to.",
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
                  <>
                    <IntentSelector value={intent} onChange={handleIntent} />
                    {intent === "race" ? (
                      <div className="mt-5">
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
                          customDistanceKm={customDistanceKm}
                          onCustomDistanceKm={setCustomDistanceKm}
                        />
                      </div>
                    ) : (
                      <p className="mt-5 rounded-[var(--radius-input)] bg-elevated px-4 py-3 text-[13px] leading-snug text-text-2">
                        {intent === "maintain"
                          ? "We'll build a steady plan that holds your fitness, mostly easy running, no race, no goal time. Set how many weeks next."
                          : intent === "return"
                          ? "We'll ease you back with a run/walk plan that grows to continuous running, capped and gentle, with a consolidation week built in. Always stop and walk if anything hurts. Set how many weeks next."
                          : "We'll build a plan to get you fitter, easy running with a little variety, ramping gently. No race or goal time needed. Set how many weeks next."}
                      </p>
                    )}
                  </>
                )}
                {step === "level" && <StepLevel value={runnerLevel} onChange={handleLevel} />}
                {step === "variant" && (
                  <StepVariant
                    variants={VARIANTS[intent]}
                    selectedKey={variantKey}
                    onSelect={applyVariant}
                  />
                )}
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

      <AnimatePresence>
        {saving && (
          <PlanBuildingLoader
            complete={built}
            onSettled={() => router.push(`/plan?id=${builtPlanId.current}`)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
