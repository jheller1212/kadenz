"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/8bit-switch";
import { WheelPicker } from "@/components/ui/WheelPicker";
import { Skeleton } from "@/components/ui/feedback";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { DAY_OPTIONS } from "@/app/create/steps/data";

type RaceDistance = "5k" | "10k" | "half" | "marathon" | "ultra" | "custom";
type Volume = "beginner" | "low" | "medium" | "high" | "elite";
type Difficulty = "easy" | "moderate" | "hard";

interface Form {
  id: string;
  raceDistance: RaceDistance;
  hours: number;
  minutes: number;
  seconds: number;
  startDate: string; // yyyy-mm-dd
  raceDate: string;
  daysPerWeek: number;
  trainingVolume: Volume;
  trainingDifficulty: Difficulty;
  preferredLongRunDay: number;
  hillyArea: boolean;
  currentWeeklyKm: number;
  longRunCapKm: number;
  easyRunMinKm: number;
  runnerLevel: string | null;
  availableDays: number[] | null;
}

function toDateInput(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

const sectionLabelCls = "text-xs font-semibold uppercase tracking-widest text-text-3";
const cardCls = "rounded-2xl bg-surface p-4 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]";
const inputCls =
  "w-full rounded-[var(--radius-input)] bg-elevated px-3.5 py-3 text-[16px] text-text-1 outline-none focus:ring-2 focus:ring-accent/40";
const numCls =
  "w-20 rounded-[var(--radius-input)] bg-elevated px-3 py-2.5 text-center text-[16px] font-semibold text-text-1 outline-none tabular-nums focus:ring-2 focus:ring-accent/40";

function EditPlanInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const planIdParam = searchParams.get("id");

  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let p;
        if (planIdParam) {
          const res = await apiFetch(`/api/plans/${planIdParam}`);
          p = res.ok ? await res.json() : null;
        } else {
          // Was /api/plans (full list) -> /api/plans/[id], purely to find
          // "whichever one is active" and then fetch it — /api/plans/active
          // resolves and returns that plan in the one call.
          const res = await apiFetch("/api/plans/active?summary=1");
          const bundle = res.ok ? await res.json() : null;
          p = bundle?.activePlan ? bundle.plan : null;
        }
        if (!p) {
          if (!cancelled) setLoading(false);
          return;
        }
        if (cancelled) return;
        const total = p.goalTimeSeconds as number;
        setForm({
          id: p.id,
          raceDistance: p.raceDistance,
          hours: Math.floor(total / 3600),
          minutes: Math.floor((total % 3600) / 60),
          seconds: total % 60,
          startDate: toDateInput(p.startDate),
          raceDate: toDateInput(p.raceDate),
          daysPerWeek: p.daysPerWeek,
          trainingVolume: p.trainingVolume,
          trainingDifficulty: p.trainingDifficulty,
          preferredLongRunDay: p.preferredLongRunDay ?? 0,
          hillyArea: p.hillyArea ?? false,
          currentWeeklyKm: p.currentWeeklyKm ?? 0,
          longRunCapKm: p.longRunCapKm ?? 0,
          easyRunMinKm: p.easyRunMinKm ?? 0,
          runnerLevel: p.runnerLevel ?? null,
          availableDays: Array.isArray(p.availableDays) && p.availableDays.length >= 2 ? p.availableDays : null,
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [planIdParam]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  async function save() {
    if (!form) return;
    setError(null);
    const goal = form.hours * 3600 + form.minutes * 60 + form.seconds;
    if (goal <= 0) {
      setError("Set a goal time.");
      return;
    }
    if (new Date(form.raceDate) <= new Date(form.startDate)) {
      setError("Race date must be after the start date.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiFetch(`/api/plans/${form.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          raceDistance: form.raceDistance,
          goalTimeSeconds: goal,
          startDate: new Date(form.startDate).toISOString(),
          raceDate: new Date(form.raceDate).toISOString(),
          daysPerWeek: form.availableDays
            ? Math.min(form.daysPerWeek, form.availableDays.length, 6)
            : form.daysPerWeek,
          trainingVolume: form.trainingVolume,
          trainingDifficulty: form.trainingDifficulty,
          preferredLongRunDay: form.preferredLongRunDay,
          hillyArea: form.hillyArea,
          raceElevation: form.hillyArea ? "hilly" : "flat",
          currentWeeklyKm: form.currentWeeklyKm,
          longRunCapKm: form.longRunCapKm,
          easyRunMinKm: form.easyRunMinKm,
          runnerLevel: form.runnerLevel,
          availableDays: form.availableDays,
        }),
      });
      if (res.ok) {
        haptic("success");
        router.push(`/plan?id=${form.id}`);
      } else {
        haptic("warning");
        const body = await res.json().catch(() => null);
        setError(body?.error ?? "Couldn't update the plan.");
      }
    } catch {
      setError("Network error. Couldn't update the plan.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Edit plan" large />
        <div className="flex flex-col gap-3 px-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      </main>
    );
  }

  if (!form) {
    return (
      <main className="min-h-dvh bg-bg">
        <NavBar title="Edit plan" large />
        <p className="px-4 text-[15px] text-text-2">No active plan to edit.</p>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar
        title="Edit plan"
        large
        left={
          <button
            onClick={() => router.back()}
            className="press flex h-11 w-11 items-center justify-center -ml-2 rounded-lg active:bg-elevated"
          >
            <ChevronLeft className="h-5 w-5 text-text-1" strokeWidth={2.5} />
          </button>
        }
      />
      <div className="flex flex-col gap-6 px-4 pb-[calc(env(safe-area-inset-bottom)+152px)]">
        <p className="text-[13px] leading-relaxed text-text-3">
          Changing these only regenerates workouts you haven&apos;t touched yet. Anything
          completed, skipped or missed keeps its result, and anything you&apos;ve hand-tuned
          (a distance, pace or start time) keeps your change, too. Both stay exactly where
          they are. Reset a hand-tuned workout from its own screen if you want the new
          plan to take over there.
        </p>

        {/* Race distance */}
        <div className="flex flex-col gap-2">
          <span className={sectionLabelCls}>Race</span>
          <Segmented
            value={form.raceDistance}
            onChange={(v) => set("raceDistance", v as RaceDistance)}
            options={[
              { value: "5k", label: "5K" },
              { value: "10k", label: "10K" },
              { value: "half", label: "Half" },
              { value: "marathon", label: "Full" },
              { value: "ultra", label: "Ultra" },
            ]}
          />
        </div>

        {/* Goal time */}
        <div className="flex flex-col gap-2">
          <span className={sectionLabelCls}>Goal time</span>
          <div className="flex items-center gap-2">
            {(["hours", "minutes", "seconds"] as const).map((k, i) => (
              <div key={k} className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={k === "hours" ? 9 : 59}
                  value={form[k]}
                  onChange={(e) =>
                    set(k, Math.max(0, Math.min(k === "hours" ? 9 : 59, parseInt(e.target.value) || 0)))
                  }
                  className={numCls}
                  aria-label={k}
                />
                {i < 2 && <span className="text-text-3">:</span>}
              </div>
            ))}
            <span className="ml-1 text-[12px] text-text-3">h : m : s</span>
          </div>
        </div>

        {/* Dates */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <span className={sectionLabelCls}>Start</span>
            <input type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} className={inputCls} />
          </div>
          <div className="flex flex-col gap-2">
            <span className={sectionLabelCls}>Race day</span>
            <input type="date" value={form.raceDate} onChange={(e) => set("raceDate", e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* Days per week / availability */}
        {form.availableDays ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2.5">
              <span className={sectionLabelCls}>Available days ({form.availableDays.length})</span>
              <div className="flex justify-between gap-1.5" role="group" aria-label="Available days">
                {DAY_OPTIONS.map(({ name, value }) => {
                  const on = form.availableDays!.includes(value);
                  return (
                    <button
                      key={value}
                      onClick={() => {
                        haptic("light");
                        const next = on
                          ? form.availableDays!.filter((x) => x !== value)
                          : [...form.availableDays!, value];
                        if (next.length < 2) return;
                        set("availableDays", next);
                        if (form.daysPerWeek > next.length) {
                          set("daysPerWeek", next.length);
                        }
                        if (!next.includes(form.preferredLongRunDay)) {
                          set("preferredLongRunDay", next.includes(6) ? 6 : next[0]);
                        }
                      }}
                      aria-pressed={on}
                      className={`press flex h-12 flex-1 flex-col items-center justify-center rounded-full text-[13px] font-bold transition-colors ${
                        on ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                      }`}
                    >
                      {name.charAt(0)}
                      <span className="sr-only">{name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-[12px] leading-relaxed text-text-3">
                Workouts only land on these days. Picking more days than runs gives the plan room to
                space runs and strength work.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <span className={sectionLabelCls}>Runs / week</span>
              <Segmented
                value={String(Math.min(form.daysPerWeek, form.availableDays.length, 6))}
                onChange={(v) => set("daysPerWeek", parseInt(v))}
                options={Array.from(
                  { length: Math.min(form.availableDays.length, 6) - 1 },
                  (_, i) => i + 2
                ).map((n) => ({ value: String(n), label: String(n) }))}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <span className={sectionLabelCls}>Days / week</span>
            <Segmented
              value={String(form.daysPerWeek)}
              onChange={(v) => set("daysPerWeek", parseInt(v))}
              options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
        )}

        {/* Long run day */}
        <div className="flex flex-col gap-2.5">
          <span className={sectionLabelCls}>Long run day</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Long run day">
            {DAY_OPTIONS.map(({ name, value }) => {
              const active = value === form.preferredLongRunDay;
              const disabled = form.availableDays ? !form.availableDays.includes(value) : false;
              return (
                <button
                  key={value}
                  role="radio"
                  aria-checked={active}
                  disabled={disabled}
                  onClick={() => {
                    haptic("light");
                    set("preferredLongRunDay", value);
                  }}
                  className={`press rounded-full px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                    active
                      ? "bg-accent text-on-accent"
                      : disabled
                      ? "bg-elevated text-text-3/40"
                      : "bg-elevated text-text-2 [box-shadow:var(--k-ring-hairline)]"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Runner level (from onboarding) */}
        {form.runnerLevel && (
          <div className="flex items-center justify-between">
            <span className={sectionLabelCls}>Runner level</span>
            <span className="text-[14px] font-semibold capitalize text-text-1">{form.runnerLevel}</span>
          </div>
        )}

        {/* Volume + difficulty */}
        <div className="flex flex-col gap-2">
          <span className={sectionLabelCls}>Volume</span>
          <Segmented
            value={form.trainingVolume}
            onChange={(v) => set("trainingVolume", v as Volume)}
            options={[
              { value: "beginner", label: "Beg" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Med" },
              { value: "high", label: "High" },
              { value: "elite", label: "Elite" },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <span className={sectionLabelCls}>Intensity</span>
          <Segmented
            value={form.trainingDifficulty}
            onChange={(v) => set("trainingDifficulty", v as Difficulty)}
            options={[
              { value: "easy", label: "Easy" },
              { value: "moderate", label: "Moderate" },
              { value: "hard", label: "Hard" },
            ]}
          />
        </div>

        {/* Hilly */}
        <div className={`flex items-center justify-between ${cardCls}`}>
          <div className="min-w-0 pr-3">
            <p className="text-[15px] font-bold text-text-1">Hilly area</p>
            <p className="mt-0.5 text-[12px] text-text-2">Slows pace targets by ~8% for elevation.</p>
          </div>
          <Switch checked={form.hillyArea} onChange={(v) => set("hillyArea", v)} />
        </div>

        {/* Advanced */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => {
              haptic("light");
              setAdvancedOpen((o) => !o);
            }}
            aria-expanded={advancedOpen}
            className={`press flex w-full items-center justify-between text-left ${cardCls}`}
          >
            <span className="min-w-0 pr-3">
              <span className="block text-[15px] font-bold text-text-1">Advanced</span>
              <span className="mt-0.5 block text-[12px] leading-relaxed text-text-2">
                Current weekly km, long-run cap, shortest easy run
              </span>
            </span>
            <ChevronDown
              className={`h-5 w-5 shrink-0 text-accent-fg transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              strokeWidth={2.4}
            />
          </button>

          <AnimatePresence initial={false}>
            {advancedOpen && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="flex flex-col gap-5 pt-1">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-text-2">Current weekly km</span>
                      <span className="text-sm font-bold tabular-nums text-accent-fg">
                        {form.currentWeeklyKm} km
                      </span>
                    </div>
                    <WheelPicker
                      min={0}
                      max={100}
                      step={5}
                      value={form.currentWeeklyKm}
                      onChange={(v) => set("currentWeeklyKm", v)}
                      unit="km"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-text-2">Long-run cap</span>
                      <span className="text-sm font-bold tabular-nums text-accent-fg">
                        {form.longRunCapKm === 0 ? "No cap" : `${form.longRunCapKm} km`}
                      </span>
                    </div>
                    <WheelPicker
                      min={0}
                      max={42}
                      step={1}
                      value={form.longRunCapKm}
                      onChange={(v) => set("longRunCapKm", v)}
                      unit="km"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[13px] font-semibold text-text-2">Easy-run min</span>
                      <span className="text-sm font-bold tabular-nums text-accent-fg">
                        {form.easyRunMinKm === 0 ? "No min" : `${form.easyRunMinKm} km`}
                      </span>
                    </div>
                    <WheelPicker
                      min={0}
                      max={15}
                      step={1}
                      value={form.easyRunMinKm}
                      onChange={(v) => set("easyRunMinKm", v)}
                      unit="km"
                    />
                  </div>
                  <p className="text-[12px] leading-relaxed text-text-3">
                    0 = no limit. Easy-run min is a floor: runs grow above it to hit weekly volume.
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {error && (
          <div className="rounded-[var(--radius-input)] bg-danger/10 px-3.5 py-2.5 text-[13px] font-medium text-danger">
            {error}
          </div>
        )}
      </div>

      {/* Sticky save */}
      <div className="fixed inset-x-0 bottom-0 mx-auto max-w-[430px] bg-bg/90 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-3 backdrop-blur">
        <Button full onClick={save} busy={saving}>
          Save &amp; regenerate
        </Button>
      </div>
    </main>
  );
}

export default function EditPlanPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-dvh bg-bg">
          <NavBar title="Edit plan" large />
          <div className="flex flex-col gap-3 px-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        </main>
      }
    >
      <EditPlanInner />
    </Suspense>
  );
}
