"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, X, Check, Plus, AlertCircle } from "lucide-react";
import type { PlanConfig, RaceDistance, TrainingVolume, TrainingDifficulty, RaceElevation, GeneratedPlan } from "@/lib/plan-engine/types";
import { TimePicker } from "@/components/TimePicker";
import { generatePlan } from "@/lib/plan-engine/plan-generator";
import { getPaceZones, formatPace } from "@/lib/plan-engine/pace-zones";
import { NavBar } from "@/components/ui/NavBar";
import { Button } from "@/components/ui/Button";
import { Segmented } from "@/components/ui/Segmented";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";

// ── Step tracker ──────────────────────────────────────────────────────────────

const STEPS = ["Race", "Goal", "Preferences", "Preview"] as const;
type Step = 0 | 1 | 2 | 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// Monday-first day names, value = JS dayOfWeek (0=Sun...6=Sat)
const DAY_OPTIONS = [
  { name: "Mon", value: 1 },
  { name: "Tue", value: 2 },
  { name: "Wed", value: 3 },
  { name: "Thu", value: 4 },
  { name: "Fri", value: 5 },
  { name: "Sat", value: 6 },
  { name: "Sun", value: 0 },
];

function isoToday(): string {
  return new Date().toISOString().split("T")[0];
}

function isoDateOffset(daysFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysFromToday);
  return date.toISOString().split("T")[0];
}

const RACE_OPTIONS: { distance: RaceDistance; label: string; sublabel: string }[] = [
  { distance: "5k", label: "5K", sublabel: "3.1 miles" },
  { distance: "10k", label: "10K", sublabel: "6.2 miles" },
  { distance: "half", label: "Half Marathon", sublabel: "13.1 miles" },
  { distance: "marathon", label: "Marathon", sublabel: "26.2 miles" },
];

// ── Sub-components ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  return (
    <div className="flex items-center gap-2" role="list" aria-label="Wizard steps">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={label} className="flex items-center gap-2" role="listitem">
            <div className="flex flex-col items-center gap-0.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors duration-200 ${
                  done
                    ? "bg-accent text-on-accent"
                    : active
                    ? "bg-accent/20 text-accent ring-1 ring-accent"
                    : "bg-elevated text-text-3"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? <Check className="w-3 h-3" strokeWidth={3} /> : i + 1}
              </div>
              <span className={`text-[9px] font-medium uppercase tracking-wider ${active ? "text-accent" : done ? "text-text-2" : "text-text-3"}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 w-6 mb-3 transition-colors duration-200 ${i < current ? "bg-accent" : "bg-hairline"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Step 1: Race Selection ────────────────────────────────────────────────────

function StepRace({
  value,
  onChange,
}: {
  value: RaceDistance | null;
  onChange: (d: RaceDistance) => void;
}) {
  const distances = RACE_OPTIONS.map((o) => o.distance);

  function handleKeyDown(e: React.KeyboardEvent, current: RaceDistance) {
    const idx = distances.indexOf(current);
    let next = idx;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      next = (idx + 1) % distances.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      next = (idx - 1 + distances.length) % distances.length;
    } else {
      return;
    }
    onChange(distances[next]);
    // Focus the newly selected button
    const container = (e.target as HTMLElement).closest("[role=radiogroup]");
    const buttons = container?.querySelectorAll<HTMLElement>("[role=radio]");
    buttons?.[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-[22px] font-bold text-text-1 tracking-tight">Pick your race</h2>
        <p className="text-[15px] text-text-2 mt-1">What distance are you training for?</p>
      </div>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Race distance">
        {RACE_OPTIONS.map(({ distance, label, sublabel }) => {
          const selected = value === distance;
          return (
            <button
              key={distance}
              role="radio"
              aria-checked={selected}
              tabIndex={selected || (value === null && distance === "5k") ? 0 : -1}
              onClick={() => {
                haptic("light");
                onChange(distance);
              }}
              onKeyDown={(e) => handleKeyDown(e, distance)}
              className={`press flex flex-col items-start p-4 rounded-[var(--radius-card)] focus:outline-none focus:ring-2 focus:ring-accent ${
                selected ? "bg-accent/10 ring-1 ring-accent" : "bg-surface"
              }`}
            >
              <span className={`text-2xl font-extrabold tracking-tight ${selected ? "text-accent" : "text-text-1"}`}>
                {label}
              </span>
              <span className="text-xs text-text-3 mt-0.5">{sublabel}</span>
              {selected && (
                <div className="mt-2 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                  <Check className="w-2.5 h-2.5 text-on-accent" strokeWidth={3} />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 2: Goal Time ─────────────────────────────────────────────────────────

// Realistic goal time ranges per distance (seconds) [world record … slow recreational]
const GOAL_TIME_RANGES: Record<RaceDistance, { wr: number; elite: number; fast: number; slow: number; label: string }> = {
  "5k":      { wr: 755,   elite: 900,   fast: 1200,  slow: 2700,  label: "5K" },
  "10k":     { wr: 1577,  elite: 1920,  fast: 2700,  slow: 5400,  label: "10K" },
  "half":    { wr: 3456,  elite: 4200,  fast: 5700,  slow: 12600, label: "Half Marathon" },
  "marathon": { wr: 7260, elite: 8700,  fast: 11400, slow: 25200, label: "Marathon" },
};

function getGoalTimeWarning(raceDistance: RaceDistance | null, totalSeconds: number): string | null {
  if (!raceDistance || totalSeconds <= 0) return null;
  const range = GOAL_TIME_RANGES[raceDistance];
  if (totalSeconds < range.wr) {
    return `That's faster than the world record for ${range.label}. Please enter a realistic goal time.`;
  }
  if (totalSeconds < range.elite) {
    return `That's an elite-level time. This app is designed for recreational runners — pacing may not suit sub-elite athletes.`;
  }
  if (totalSeconds > range.slow) {
    return `That's quite slow for a ${range.label}. Consider walking intervals or a run/walk plan instead.`;
  }
  return null;
}

interface RaceTimeEntry {
  distance: string;
  label: string;
  hours: number;
  minutes: number;
  seconds: number;
}

function RaceTimeInput({ entry, onChange, onRemove }: {
  entry: RaceTimeEntry;
  onChange: (e: RaceTimeEntry) => void;
  onRemove: () => void;
}) {
  const totalSec = entry.hours * 3600 + entry.minutes * 60 + entry.seconds;
  return (
    <div className="rounded-[var(--radius-input)] bg-surface p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-text-1">{entry.label}</span>
        <button
          onClick={() => {
            haptic("light");
            onRemove();
          }}
          className="press text-xs text-danger font-semibold"
        >
          Remove
        </button>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" inputMode="numeric" min={0} max={9} value={entry.hours} onChange={(e) => onChange({ ...entry, hours: parseInt(e.target.value) || 0 })}
          className="w-14 rounded-lg bg-elevated px-2 py-2 text-center text-sm text-text-1 tabular-nums" placeholder="H" />
        <span className="text-text-3 font-bold">:</span>
        <input type="number" inputMode="numeric" min={0} max={59} value={entry.minutes} onChange={(e) => onChange({ ...entry, minutes: Math.min(59, parseInt(e.target.value) || 0) })}
          className="w-14 rounded-lg bg-elevated px-2 py-2 text-center text-sm text-text-1 tabular-nums" placeholder="MM" />
        <span className="text-text-3 font-bold">:</span>
        <input type="number" inputMode="numeric" min={0} max={59} value={entry.seconds} onChange={(e) => onChange({ ...entry, seconds: Math.min(59, parseInt(e.target.value) || 0) })}
          className="w-14 rounded-lg bg-elevated px-2 py-2 text-center text-sm text-text-1 tabular-nums" placeholder="SS" />
      </div>
      {totalSec > 0 && <p className="text-xs text-text-3 mt-1">{formatSeconds(totalSec)}</p>}
    </div>
  );
}

function StepGoal({
  hours,
  minutes,
  seconds,
  onHours,
  onMinutes,
  onSeconds,
  raceDate,
  onRaceDate,
  startDate,
  onStartDate,
  raceDistance,
  raceTimes,
  onRaceTimes,
}: {
  hours: number;
  minutes: number;
  seconds: number;
  onHours: (v: number) => void;
  onMinutes: (v: number) => void;
  onSeconds: (v: number) => void;
  raceDate: string;
  onRaceDate: (v: string) => void;
  startDate: string;
  onStartDate: (v: string) => void;
  raceDistance: RaceDistance | null;
  raceTimes: RaceTimeEntry[];
  onRaceTimes: (rt: RaceTimeEntry[]) => void;
}) {
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const warning = getGoalTimeWarning(raceDistance, totalSeconds);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[22px] font-bold text-text-1 tracking-tight">Set your goal</h2>
        <p className="text-[15px] text-text-2 mt-1">Enter your target finish time and race date.</p>
      </div>

      {/* Goal time picker */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Goal finish time</span>
        <TimePicker
          hours={hours}
          minutes={minutes}
          seconds={seconds}
          onHours={onHours}
          onMinutes={onMinutes}
          onSeconds={onSeconds}
        />
        {totalSeconds > 0 && (
          <p className="text-xs text-text-3 text-center">Goal: {formatSeconds(totalSeconds)}</p>
        )}
        {warning && (
          <div className="flex items-start gap-2 rounded-[var(--radius-input)] bg-warn/10 px-4 py-3 text-xs text-warn leading-relaxed">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
            <span>{warning}</span>
          </div>
        )}
      </div>

      {/* Dates */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Dates</span>
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">Plan start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => onStartDate(e.target.value)}
              className="rounded-[var(--radius-input)] bg-surface px-4 py-3 text-text-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent transition-shadow"
              min={isoDateOffset(-7)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">Race date</span>
            <input
              type="date"
              value={raceDate}
              onChange={(e) => onRaceDate(e.target.value)}
              className="rounded-[var(--radius-input)] bg-surface px-4 py-3 text-text-1 text-sm focus:outline-none focus:ring-2 focus:ring-accent transition-shadow"
              min={startDate || new Date().toISOString().split("T")[0]}
            />
          </label>
        </div>
      </div>

      {/* Recent race times (optional) */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Recent race times (optional)</span>
        <p className="text-xs text-text-2 leading-relaxed">Add recent race results for more accurate pace targets. Leave empty if you don&apos;t have any.</p>

        {raceTimes.map((rt, i) => (
          <RaceTimeInput
            key={rt.distance}
            entry={rt}
            onChange={(updated) => {
              const next = [...raceTimes];
              next[i] = updated;
              onRaceTimes(next);
            }}
            onRemove={() => onRaceTimes(raceTimes.filter((_, j) => j !== i))}
          />
        ))}

        {/* Add buttons for distances not yet added */}
        <div className="flex flex-wrap gap-2">
          {[
            { distance: "5k", label: "5K" },
            { distance: "10k", label: "10K" },
            { distance: "half", label: "Half Marathon" },
            { distance: "marathon", label: "Marathon" },
          ].filter((d) => !raceTimes.some((rt) => rt.distance === d.distance)).map((d) => (
            <button
              key={d.distance}
              onClick={() => {
                haptic("light");
                onRaceTimes([...raceTimes, { distance: d.distance, label: d.label, hours: 0, minutes: 0, seconds: 0 }]);
              }}
              className="press flex items-center gap-1 px-3 py-2 rounded-full bg-elevated text-xs font-semibold text-text-2"
            >
              <Plus className="w-3 h-3" strokeWidth={2} />
              {d.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Training Preferences ──────────────────────────────────────────────

function StepPreferences({
  trainingDifficulty,
  onDifficulty,
  preferredLongRunDay,
  onLongRunDay,
  raceElevation,
  onRaceElevation,
  availableDays,
  onAvailableDays,
  currentWeeklyKm,
  onCurrentWeeklyKm,
  longRunCapKm,
  onLongRunCapKm,
  easyRunMinKm,
  onEasyRunMinKm,
}: {
  trainingDifficulty: TrainingDifficulty;
  onDifficulty: (v: TrainingDifficulty) => void;
  preferredLongRunDay: number;
  onLongRunDay: (v: number) => void;
  raceElevation: RaceElevation;
  onRaceElevation: (v: RaceElevation) => void;
  availableDays: number[];
  onAvailableDays: (v: number[]) => void;
  currentWeeklyKm: number;
  onCurrentWeeklyKm: (v: number) => void;
  longRunCapKm: number;
  onLongRunCapKm: (v: number) => void;
  easyRunMinKm: number;
  onEasyRunMinKm: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-[22px] font-bold text-text-1 tracking-tight">Training preferences</h2>
        <p className="text-[15px] text-text-2 mt-1">Customize your plan to fit your lifestyle.</p>
      </div>

      {/* Difficulty */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Workout intensity</span>
        <Segmented
          options={[
            { value: "easy", label: "Easy" },
            { value: "moderate", label: "Moderate" },
            { value: "hard", label: "Hard" },
          ]}
          value={trainingDifficulty}
          onChange={onDifficulty}
        />
        <p className="text-xs text-text-3">
          {trainingDifficulty === "easy" && "1 quality session/week. More easy miles."}
          {trainingDifficulty === "moderate" && "1 quality session/week with variety."}
          {trainingDifficulty === "hard" && "2 quality sessions/week. Tempo + intervals."}
        </p>
      </div>

      {/* Available training days */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Available days</span>
        <p className="text-xs text-text-3">Select the days you can train. We&apos;ll schedule workouts only on these days.</p>
        <div className="flex gap-1.5 flex-wrap">
          {DAY_OPTIONS.map(({ name, value }) => {
            const isAvailable = availableDays.includes(value);
            return (
              <button
                key={value}
                onClick={() => {
                  haptic("light");
                  if (isAvailable && availableDays.length > 3) {
                    onAvailableDays(availableDays.filter((d) => d !== value));
                  } else if (!isAvailable && availableDays.length < 7) {
                    onAvailableDays([...availableDays, value]);
                  }
                }}
                aria-pressed={isAvailable}
                className={`press w-10 h-10 rounded-full text-sm font-semibold ${
                  isAvailable ? "bg-accent text-on-accent" : "bg-surface text-text-3"
                }`}
              >
                {name.charAt(0)}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-3">{availableDays.length} days selected · min 3</p>
      </div>

      {/* Preferred long run day */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Long run day</span>
        <div className="flex gap-1.5 flex-wrap">
          {DAY_OPTIONS.map(({ name, value }) => (
            <button
              key={value}
              onClick={() => {
                haptic("light");
                onLongRunDay(value);
              }}
              aria-pressed={preferredLongRunDay === value}
              className={`press w-10 h-10 rounded-full text-sm font-semibold ${
                preferredLongRunDay === value ? "bg-accent text-on-accent" : "bg-surface text-text-2"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Current weekly km */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">How many km did you run last week?</span>
        <p className="text-xs text-text-3">Your plan will start near this volume and build up gradually.</p>
        <div className="rounded-[var(--radius-card)] bg-surface px-4 py-4">
          <div className="text-center mb-3">
            <span className="text-3xl font-extrabold text-text-1 tabular-nums">{currentWeeklyKm}</span>
            <span className="text-sm text-text-3 ml-1">km/week</span>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={currentWeeklyKm}
            onChange={(e) => onCurrentWeeklyKm(Number(e.target.value))}
            className="w-full accent-[var(--k-accent)]"
            aria-label={`Current weekly km: ${currentWeeklyKm}`}
          />
          <div className="flex justify-between text-[10px] text-text-3 mt-1">
            <span>0 km</span>
            <span>100 km</span>
          </div>
        </div>
        {currentWeeklyKm === 0 && (
          <div className="rounded-[var(--radius-input)] bg-warn/10 px-4 py-3 text-xs text-warn leading-relaxed">
            No worries! We&apos;ll start you at ~10 km/week with short, easy runs and build up slowly. Consistency is more important than volume — your body needs time to adapt to the impact of running.
          </div>
        )}
        {currentWeeklyKm > 0 && currentWeeklyKm <= 15 && (
          <p className="text-xs text-text-3">We&apos;ll start gently and increase by no more than 10% per week.</p>
        )}
      </div>

      {/* Long run cap */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Long run cap</span>
          <span className="text-sm font-bold text-accent">{longRunCapKm === 0 ? "No cap" : `${longRunCapKm} km`}</span>
        </div>
        <input
          type="range"
          min={0}
          max={42}
          step={1}
          value={longRunCapKm}
          onChange={(e) => onLongRunCapKm(Number(e.target.value))}
          className="w-full accent-[#C8FF3C]"
          aria-label={`Long run cap: ${longRunCapKm === 0 ? "none" : longRunCapKm + " km"}`}
        />
        <div className="flex justify-between text-[10px] text-text-3">
          <span>No cap</span>
          <span>42 km</span>
        </div>
      </div>

      {/* Race elevation */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Race elevation</span>
        <Segmented
          options={[
            { value: "flat", label: "Flat" },
            { value: "rolling", label: "Rolling" },
            { value: "hilly", label: "Hilly" },
            { value: "mountainous", label: "Mountain" },
          ]}
          value={raceElevation}
          onChange={onRaceElevation}
        />
        <p className="text-xs text-text-3">
          {raceElevation === "flat" && "Less than 10m elevation per km. Paces unadjusted."}
          {raceElevation === "rolling" && "10–20m per km. Paces adjusted +4%."}
          {raceElevation === "hilly" && "20–40m per km. Paces adjusted +8%."}
          {raceElevation === "mountainous" && "40m+ per km. Paces adjusted +14%."}
        </p>
      </div>

      {/* Easy run minimum */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Easy run minimum</span>
          <span className="text-sm font-bold text-accent">{easyRunMinKm === 0 ? "No min" : `${easyRunMinKm} km`}</span>
        </div>
        <input
          type="range"
          min={0}
          max={15}
          step={1}
          value={easyRunMinKm}
          onChange={(e) => onEasyRunMinKm(Number(e.target.value))}
          className="w-full accent-[#C8FF3C]"
          aria-label={`Easy run minimum: ${easyRunMinKm === 0 ? "none" : easyRunMinKm + " km"}`}
        />
        <div className="flex justify-between text-[10px] text-text-3">
          <span>No min</span>
          <span>15 km</span>
        </div>
      </div>
    </div>
  );
}

// ── Step 4: Preview ───────────────────────────────────────────────────────────

const PHASE_COLORS: Record<string, string> = {
  base: "bg-[#1A3A2A] text-[#4ADE80]",
  build: "bg-[#3A2A00] text-[#FFB547]",
  peak: "bg-[#2A1A3A] text-[#C084FC]",
  taper: "bg-[#1A2A3A] text-[#60A5FA]",
};

function PaceRow({ label, pace }: { label: string; pace: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-hairline last:border-b-0">
      <span className="text-sm text-text-2">{label}</span>
      <span className="text-sm font-semibold text-text-1 tabular-nums">{pace}</span>
    </div>
  );
}

function StepPreview({ plan, useMiles }: { plan: GeneratedPlan; useMiles: boolean }) {
  const paces = getPaceZones(plan.vdot);

  // Summarize phase distribution
  const phaseCounts: Record<string, number> = {};
  for (const week of plan.weeks) {
    phaseCounts[week.phase] = (phaseCounts[week.phase] || 0) + 1;
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-2xl font-extrabold text-text-1 tracking-tight">Your plan</h2>
        <p className="text-sm text-text-2 mt-1">{plan.name}</p>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-[var(--radius-card)] bg-surface p-4 flex flex-col gap-1">
          <span className="text-xs text-text-3 uppercase tracking-wider">Weeks</span>
          <span className="text-2xl font-extrabold text-accent">{plan.planLengthWeeks}</span>
        </div>
        <div className="rounded-[var(--radius-card)] bg-surface p-4 flex flex-col gap-1">
          <span className="text-xs text-text-3 uppercase tracking-wider">Race pace</span>
          <span className="text-lg font-extrabold text-accent">{formatPace(paces.E.targetPaceSecKm > paces.M.targetPaceSecKm ? Math.round(plan.goalTimeSeconds / (plan.raceDistance === "5k" ? 5 : plan.raceDistance === "10k" ? 10 : plan.raceDistance === "half" ? 21.1 : 42.2)) : paces.M.targetPaceSecKm)}/km</span>
        </div>
        <div className="rounded-[var(--radius-card)] bg-surface p-4 flex flex-col gap-1">
          <span className="text-xs text-text-3 uppercase tracking-wider">Days/wk</span>
          <span className="text-2xl font-extrabold text-accent">{plan.daysPerWeek}</span>
        </div>
      </div>

      {/* Pace zones */}
      <div className="rounded-[var(--radius-card)] bg-surface p-4 flex flex-col gap-1">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-2">Pace zones</span>
        <PaceRow label="Easy / Long" pace={`${formatPace(paces.E.targetPaceSecKm, useMiles)} /${useMiles ? "mi" : "km"}`} />
        <PaceRow label="Steady (M pace)" pace={`${formatPace(paces.M.targetPaceSecKm, useMiles)} /${useMiles ? "mi" : "km"}`} />
        <PaceRow label="Tempo / Threshold" pace={`${formatPace(paces.T.targetPaceSecKm, useMiles)} /${useMiles ? "mi" : "km"}`} />
        <PaceRow label="Intervals" pace={`${formatPace(paces.I.targetPaceSecKm, useMiles)} /${useMiles ? "mi" : "km"}`} />
      </div>

      {/* Phase breakdown */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Phase breakdown</span>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(phaseCounts).map(([phase, count]) => (
            <div
              key={phase}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${PHASE_COLORS[phase] ?? "bg-elevated text-text-2"}`}
            >
              {phase} · {count}w
            </div>
          ))}
        </div>
      </div>

      {/* Week volume preview (first 4 weeks) */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Volume progression (first 4 weeks)</span>
        <div className="flex gap-2">
          {plan.weeks.slice(0, 4).map((week) => {
            const maxKm = Math.max(...plan.weeks.map((w) => w.targetKm));
            const pct = maxKm > 0 ? (week.targetKm / maxKm) * 100 : 0;
            return (
              <div key={week.weekNumber} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full rounded bg-elevated overflow-hidden h-16 flex items-end">
                  <div
                    className="w-full bg-accent/70 rounded transition-all"
                    style={{ height: `${pct}%` }}
                  />
                </div>
                <span className="text-[10px] text-text-3">W{week.weekNumber}</span>
                <span className="text-[10px] font-semibold text-text-2">{week.targetKm}km</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Main wizard ───────────────────────────────────────────────────────────────

export default function CreatePlanPage() {
  const router = useRouter();

  // Step state
  const [step, setStep] = useState<Step>(0);

  // Step 1
  const [raceDistance, setRaceDistance] = useState<RaceDistance | null>(null);

  // Step 2
  const [hours, setHours] = useState(0);
  const [minutes, setMinutes] = useState(45);
  const [seconds, setSeconds] = useState(0);
  const [startDate, setStartDate] = useState(() => isoToday());
  const [raceDate, setRaceDate] = useState(() => isoDateOffset(16 * 7));
  const [raceTimes, setRaceTimes] = useState<RaceTimeEntry[]>([]);

  // Step 3
  const [availableDays, setAvailableDays] = useState<number[]>([1, 3, 5, 0]); // Mon, Wed, Fri, Sun
  const daysPerWeek = availableDays.length;
  const [raceElevation, setRaceElevation] = useState<RaceElevation>("flat");
  const [easyRunMinKm, setEasyRunMinKm] = useState(0);
  const [useMiles, setUseMiles] = useState(false);
  const [trainingDifficulty, setTrainingDifficulty] = useState<TrainingDifficulty>("moderate");
  const [preferredLongRunDay, setPreferredLongRunDay] = useState(6); // Saturday
  const [hillyArea, setHillyArea] = useState(false);
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState(30);
  const [longRunCapKm, setLongRunCapKm] = useState(0);

  // Step 4 - generated plan
  const [generatedPlan, setGeneratedPlan] = useState<GeneratedPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const goalTimeSeconds = hours * 3600 + minutes * 60 + seconds;

  function canAdvance(): boolean {
    switch (step) {
      case 0: return raceDistance !== null;
      case 1: {
        const goalValid = goalTimeSeconds > 0;
        const datesValid = startDate !== "" && raceDate !== "" && raceDate > startDate;
        // Block if goal time is below world record (unrealistic)
        const timeRealistic = !raceDistance || goalTimeSeconds >= GOAL_TIME_RANGES[raceDistance].wr;
        return goalValid && datesValid && timeRealistic;
      }
      case 2: return true;
      case 3: return false;
    }
  }

  function handleNext() {
    if (step === 2) {
      // Generate plan before showing preview
      try {
        setError(null);
        const config: PlanConfig = {
          raceDistance: raceDistance!,
          goalTimeSeconds,
          startDate: new Date(startDate),
          raceDate: new Date(raceDate),
          daysPerWeek,
          trainingVolume: "medium" as TrainingVolume,
          trainingDifficulty,
          preferredLongRunDay,
          hillyArea,
          raceElevation,
          currentWeeklyKm,
          longRunCapKm,
          easyRunMinKm,
        };
        const plan = generatePlan(config);
        setGeneratedPlan(plan);
        haptic("success");
        setStep(3);
      } catch (e) {
        haptic("warning");
        setError(e instanceof Error ? e.message : "Failed to generate plan");
      }
      return;
    }
    if (step < 3) {
      haptic("light");
      setStep((prev) => (prev + 1) as Step);
    }
  }

  function handleBack() {
    if (step > 0) {
      haptic("light");
      setStep((prev) => (prev - 1) as Step);
    }
  }

  async function handleConfirm() {
    if (!generatedPlan) return;
    setSaving(true);
    setError(null);

    try {
      const body = {
        raceDistance,
        goalTimeSeconds,
        startDate: new Date(startDate).toISOString(),
        raceDate: new Date(raceDate).toISOString(),
        daysPerWeek,
        trainingVolume: "medium",
        trainingDifficulty,
        preferredLongRunDay,
        hillyArea,
        raceElevation,
        currentWeeklyKm,
        longRunCapKm,
        easyRunMinKm,
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

      // Save race times (fire-and-forget)
      for (const rt of raceTimes) {
        const totalSec = rt.hours * 3600 + rt.minutes * 60 + rt.seconds;
        if (totalSec > 0) {
          apiFetch("/api/race-times", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ distance: rt.distance, timeSeconds: totalSec, source: "race" }),
          }).catch(() => {});
        }
      }

      haptic("success");
      router.push(`/plan?id=${savedPlan.id}`);
    } catch (e) {
      haptic("warning");
      setError(e instanceof Error ? e.message : "Failed to save plan");
      setSaving(false);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col bg-bg">
      <NavBar
        title="Create Plan"
        large={false}
        left={
          <button
            onClick={() => {
              if (step > 0) {
                handleBack();
              } else {
                haptic("light");
                router.push("/");
              }
            }}
            className="press flex h-9 w-9 items-center justify-center rounded-full bg-elevated text-text-2"
            aria-label={step > 0 ? "Go back" : "Close"}
          >
            {step > 0 ? (
              <ChevronLeft className="h-5 w-5" strokeWidth={2} />
            ) : (
              <X className="h-5 w-5" strokeWidth={2} />
            )}
          </button>
        }
        right={
          <button
            onClick={() => {
              haptic("light");
              setUseMiles(!useMiles);
            }}
            className="press rounded-full bg-elevated px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-text-2"
            aria-label={`Switch to ${useMiles ? "kilometers" : "miles"}`}
          >
            {useMiles ? "mi" : "km"}
          </button>
        }
      />

      <div className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-2 pb-40 gap-6">
        <StepIndicator current={step} />

        {/* Step content */}
        {step === 0 && (
          <StepRace value={raceDistance} onChange={setRaceDistance} />
        )}
        {step === 1 && (
          <StepGoal
            hours={hours}
            minutes={minutes}
            seconds={seconds}
            onHours={setHours}
            onMinutes={setMinutes}
            onSeconds={setSeconds}
            raceDate={raceDate}
            onRaceDate={setRaceDate}
            startDate={startDate}
            onStartDate={setStartDate}
            raceDistance={raceDistance}
            raceTimes={raceTimes}
            onRaceTimes={setRaceTimes}
          />
        )}
        {step === 2 && (
          <StepPreferences
            trainingDifficulty={trainingDifficulty}
            onDifficulty={setTrainingDifficulty}
            preferredLongRunDay={preferredLongRunDay}
            onLongRunDay={setPreferredLongRunDay}
            raceElevation={raceElevation}
            onRaceElevation={setRaceElevation}
            availableDays={availableDays}
            onAvailableDays={setAvailableDays}
            currentWeeklyKm={currentWeeklyKm}
            onCurrentWeeklyKm={setCurrentWeeklyKm}
            longRunCapKm={longRunCapKm}
            onLongRunCapKm={setLongRunCapKm}
            easyRunMinKm={easyRunMinKm}
            onEasyRunMinKm={setEasyRunMinKm}
          />
        )}
        {step === 3 && generatedPlan && (
          <StepPreview plan={generatedPlan} useMiles={useMiles} />
        )}

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-[var(--radius-input)] bg-danger/10 px-4 py-3 text-sm text-danger animate-fade-in"
          >
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" strokeWidth={2} />
            <span>{error}</span>
          </div>
        )}
      </div>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 material hairline-t px-4 py-4 safe-bottom">
        <div className="max-w-md mx-auto">
          {step < 3 ? (
            <Button full size="lg" onClick={handleNext} disabled={!canAdvance()}>
              {step === 2 ? "Generate Plan" : "Continue"}
            </Button>
          ) : (
            <Button full size="lg" onClick={handleConfirm} busy={saving}>
              {saving ? "Saving plan..." : "Start Training"}
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
