"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";

import { Button } from "@/components/ui/Button";
import {
  OptionCard,
  RadialRing,
  WizardCheck,
  WizardHeader,
  WizardTitle,
} from "@/components/ui/wizard";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import type { Equipment } from "@/lib/strength/types";
import {
  DEFAULT_EQUIPMENT,
  EQUIPMENT_OPTIONS,
  saveEquipment,
} from "@/lib/strength/equipment";

// ── Benchmark-style stepped setup wizard for the weekly strength schedule ────────

type Goal = "running_focus" | "all_round";
type Ability = "beginner" | "intermediate" | "advanced";

const STEPS = ["goal", "duration", "frequency", "ability", "days", "equipment"] as const;
type Step = (typeof STEPS)[number];

const GOALS: Array<{ key: Goal; title: string; sub: string }> = [
  {
    key: "running_focus",
    title: "Running Focus",
    sub: "Complement your running with legs, core and Achilles work — minimal upper body.",
  },
  {
    key: "all_round",
    title: "All Round Strength",
    sub: "Build strength through your full body with a mix of upper and lower movements.",
  },
];

const DURATIONS: Array<{ value: 30 | 45 | 60; title: string; sub: string }> = [
  { value: 30, title: "30 minutes", sub: "Best for those short on time" },
  { value: 45, title: "45 minutes", sub: "Most popular" },
  { value: 60, title: "60 minutes", sub: "Recommended for maximum benefit" },
];

const ABILITIES: Array<{ key: Ability; title: string; sub: string; fill: number }> = [
  { key: "beginner", title: "Beginner", sub: "Little to no experience with strength training", fill: 0.33 },
  { key: "intermediate", title: "Intermediate", sub: "Used to basic movements like squats and rows", fill: 0.66 },
  { key: "advanced", title: "Advanced", sub: "Confident with all complex movements", fill: 1 },
];

const DAYS: Array<{ dow: number; label: string }> = [
  { dow: 1, label: "Monday" },
  { dow: 2, label: "Tuesday" },
  { dow: 3, label: "Wednesday" },
  { dow: 4, label: "Thursday" },
  { dow: 5, label: "Friday" },
  { dow: 6, label: "Saturday" },
  { dow: 0, label: "Sunday" },
];



export default function StrengthSetupPage() {
  const router = useRouter();
  const [stepIdx, setStepIdx] = useState(0);
  const step: Step = STEPS[stepIdx];

  const [goal, setGoal] = useState<Goal>("running_focus");
  const [duration, setDuration] = useState<30 | 45 | 60>(45);
  const [frequency, setFrequency] = useState(2);
  const [ability, setAbility] = useState<Ability>("intermediate");
  const [days, setDays] = useState<number[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>(DEFAULT_EQUIPMENT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);

  // Prefill from saved settings when re-running the wizard — but never
  // clobber choices the user already started making.
  const interactedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch("/api/strength/plan-settings");
        if (!res.ok || cancelled) return;
        const s = await res.json();
        if (!s || cancelled || interactedRef.current) return;
        setExisting(true);
        if (s.goal === "running_focus" || s.goal === "all_round") setGoal(s.goal);
        if ([30, 45, 60].includes(s.durationMinutes)) setDuration(s.durationMinutes);
        if (s.sessionsPerWeek >= 1 && s.sessionsPerWeek <= 4) setFrequency(s.sessionsPerWeek);
        if (["beginner", "intermediate", "advanced"].includes(s.ability)) setAbility(s.ability);
        if (Array.isArray(s.availableDays)) setDays(s.availableDays);
        if (Array.isArray(s.equipment)) setEquipment(s.equipment);
        if ([8, 12, 16].includes(s.blockWeeks)) setBlockWeeks(s.blockWeeks);
      } catch {
        /* fresh setup */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // A standalone block only makes sense without a running plan to follow —
  // with a plan, strength already inherits its length, deloads and race week.
  const [hasRunningPlan, setHasRunningPlan] = useState<boolean | null>(null);
  const [blockWeeks, setBlockWeeks] = useState<8 | 12 | 16>(12);
  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/plans")
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        if (cancelled) return;
        const active = Array.isArray(list)
          ? list.some((p: { status?: string }) => p.status === "active")
          : false;
        setHasRunningPlan(active);
      })
      .catch(() => setHasRunningPlan(null));
    return () => { cancelled = true; };
  }, []);

  const canContinue = useMemo(() => {
    if (step === "days") return days.length >= Math.max(frequency, 1);
    return true;
  }, [step, days, frequency]);

  function markInteracted() {
    interactedRef.current = true;
  }

  function back() {
    haptic("light");
    if (stepIdx === 0) router.push("/strength");
    else setStepIdx((i) => i - 1);
  }

  async function next() {
    haptic("medium");
    setError(null);
    if (stepIdx < STEPS.length - 1) {
      setStepIdx((i) => i + 1);
      return;
    }
    // Final step — save + generate.
    setSaving(true);
    try {
      const res = await apiFetch("/api/strength/plan-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          durationMinutes: duration,
          sessionsPerWeek: frequency,
          ability,
          availableDays: days,
          equipment,
          active: true,
          // Only sent when there is no running plan supplying the structure.
          blockWeeks: hasRunningPlan === false ? blockWeeks : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Couldn't save — try again.");
        return;
      }
      haptic("success");
      saveEquipment(equipment); // the custom builder shares this choice
      router.push("/strength");
    } catch {
      setError("Network error — couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  function toggleDay(dow: number) {
    haptic("light");
    setDays((d) => (d.includes(dow) ? d.filter((x) => x !== dow) : [...d, dow]));
  }

  function toggleEquipment(key: Equipment) {
    haptic("light");
    setEquipment((eq) =>
      eq.includes(key) ? eq.filter((e) => e !== key) : [...eq, key]
    );
  }

  const TITLES: Record<Step, { title: string; sub: string }> = {
    goal: {
      title: "What is your strength goal?",
      sub: "Choose the goal that best describes what you want from your sessions. You can change this at any time.",
    },
    duration: {
      title: "How long should your strength workouts be?",
      sub: "Pick a default length — you can always run a longer or shorter session on the day.",
    },
    frequency: {
      title: "How many strength sessions per week?",
      sub: "More isn't always best. At most one more than you currently do — you can add sessions later.",
    },
    ability: {
      title: "How would you rate your strength ability?",
      sub: "Pick the level that suits you best (you can change this later).",
    },
    days: {
      title: "Which days are you free to train on?",
      sub: `Select every day that works, spaced through the week — at least ${Math.max(frequency, 1)} to continue.`,
    },
    equipment: {
      title: "What equipment do you have?",
      sub: "Select everything you can easily access. No equipment? Bodyweight work has you covered.",
    },
  };

  return (
    <main className="flex min-h-dvh flex-col bg-bg">
      <WizardHeader
        progress={(stepIdx + 1) / STEPS.length}
        onBack={back}
        onClose={() => router.push("/strength")}
      />

      <div className="flex-1 overflow-y-auto px-4 pb-32 pt-4">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18 }}
          >
            <WizardTitle title={TITLES[step].title} sub={TITLES[step].sub} />

            <div className="mt-6 flex flex-col gap-3">
              {step === "goal" &&
                GOALS.map((g) => (
                  <OptionCard
                    key={g.key}
                    selected={goal === g.key}
                    onSelect={() => { markInteracted(); setGoal(g.key); }}
                    title={g.title}
                    sub={g.sub}
                  />
                ))}

              {step === "duration" &&
                DURATIONS.map((d) => (
                  <OptionCard
                    key={d.value}
                    selected={duration === d.value}
                    onSelect={() => { markInteracted(); setDuration(d.value); }}
                    title={d.title}
                    sub={d.sub}
                  />
                ))}

              {step === "frequency" &&
                [1, 2, 3, 4].map((n) => (
                  <OptionCard
                    key={n}
                    selected={frequency === n}
                    onSelect={() => { markInteracted(); setFrequency(n); }}
                    title={`${n} ${n === 1 ? "Day" : "Days"}`}
                  />
                ))}

              {step === "ability" &&
                ABILITIES.map((a) => (
                  <OptionCard
                    key={a.key}
                    selected={ability === a.key}
                    onSelect={() => { markInteracted(); setAbility(a.key); }}
                    title={a.title}
                    sub={a.sub}
                    leading={<RadialRing fill={a.fill} active={ability === a.key} />}
                  />
                ))}

              {step === "frequency" && hasRunningPlan === false && (
                <div className="mt-4">
                  <p className="mb-2 text-[13px] font-semibold text-text-2">
                    How long is this block?
                  </p>
                  <p className="mb-3 text-[12px] text-text-3">
                    You have no running plan, so strength runs on its own schedule.
                    Every fourth week is a deload, and the last week eases off.
                  </p>
                  <div className="flex gap-2">
                    {([8, 12, 16] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => { markInteracted(); haptic("light"); setBlockWeeks(w); }}
                        className={`press flex-1 rounded-[var(--radius-input)] py-3 text-[15px] font-bold ${
                          blockWeeks === w
                            ? "bg-accent text-on-accent"
                            : "bg-elevated text-text-2"
                        }`}
                      >
                        {w} weeks
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {step === "days" &&
                DAYS.map((d) => (
                  <OptionCard
                    key={d.dow}
                    selected={false}
                    onSelect={() => { markInteracted(); toggleDay(d.dow); }}
                    title={d.label}
                    trailing={<WizardCheck on={days.includes(d.dow)} />}
                  />
                ))}

              {step === "equipment" &&
                EQUIPMENT_OPTIONS.map((o) => (
                  <OptionCard
                    key={o.key}
                    selected={false}
                    onSelect={() => { markInteracted(); toggleEquipment(o.key); }}
                    title={o.label}
                    trailing={<WizardCheck on={equipment.includes(o.key)} />}
                  />
                ))}
            </div>

            {error && (
              <p className="mt-4 rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
                {error}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Pinned CTA */}
      <div
        className="fixed inset-x-0 bottom-0 bg-gradient-to-t from-[var(--k-bg)] via-[var(--k-bg)] to-transparent px-4 pt-6"
        style={{ paddingBottom: "max(env(safe-area-inset-bottom), 16px)" }}
      >
        <div className="mx-auto max-w-[430px]">
          <Button full size="lg" busy={saving} disabled={!canContinue} onClick={next}>
            {stepIdx === STEPS.length - 1 ? (existing ? "Save & rebuild schedule" : "Add to plan") : "Continue"}
          </Button>
        </div>
      </div>
    </main>
  );
}
