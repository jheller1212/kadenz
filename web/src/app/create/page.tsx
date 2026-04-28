"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlanConfig, RaceDistance, TrainingVolume, TrainingDifficulty, GeneratedPlan } from "@/lib/plan-engine/types";
import { generatePlan } from "@/lib/plan-engine/plan-generator";
import { getPaceZones, formatPace } from "@/lib/plan-engine/pace-zones";

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

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isoDateOffset(weeksFromToday: number): string {
  const date = new Date();
  date.setDate(date.getDate() + weeksFromToday * 7);
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
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? "bg-accent text-on-accent"
                    : active
                    ? "bg-accent/20 border border-accent text-accent"
                    : "bg-elevated border border-hairline text-text-3"
                }`}
                aria-current={active ? "step" : undefined}
              >
                {done ? (
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  i + 1
                )}
              </div>
              <span className={`text-[9px] font-medium uppercase tracking-wider ${active ? "text-accent" : done ? "text-text-2" : "text-text-3"}`}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-px flex-1 w-6 mb-3 ${i < current ? "bg-accent" : "bg-hairline"}`} />
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
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-2xl font-extrabold text-text-1 tracking-tight">Pick your race</h2>
        <p className="text-sm text-text-2 mt-1">What distance are you training for?</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {RACE_OPTIONS.map(({ distance, label, sublabel }) => {
          const selected = value === distance;
          return (
            <button
              key={distance}
              onClick={() => onChange(distance)}
              className={`flex flex-col items-start p-4 rounded-[var(--radius-card)] border transition-all active:scale-[0.97] ${
                selected
                  ? "border-accent bg-accent/10"
                  : "border-hairline bg-surface"
              }`}
              aria-pressed={selected}
            >
              <span className={`text-2xl font-extrabold tracking-tight ${selected ? "text-accent" : "text-text-1"}`}>
                {label}
              </span>
              <span className="text-xs text-text-3 mt-0.5">{sublabel}</span>
              {selected && (
                <div className="mt-2 w-4 h-4 rounded-full bg-accent flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-on-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
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
}) {
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-extrabold text-text-1 tracking-tight">Set your goal</h2>
        <p className="text-sm text-text-2 mt-1">Enter your target finish time and race date.</p>
      </div>

      {/* Goal time picker */}
      <div className="flex flex-col gap-3">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Goal finish time</span>
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface border border-hairline p-5">
          {/* Hours */}
          <div className="flex flex-col items-center gap-1 flex-1">
            <button
              onClick={() => onHours(Math.min(hours + 1, 9))}
              className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-text-2 active:scale-90 transition-transform"
              aria-label="Increase hours"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <span className="text-3xl font-bold text-text-1 tabular-nums w-12 text-center">
              {hours.toString().padStart(2, "0")}
            </span>
            <button
              onClick={() => onHours(Math.max(hours - 1, 0))}
              className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-text-2 active:scale-90 transition-transform"
              aria-label="Decrease hours"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <span className="text-[10px] text-text-3 uppercase tracking-wider">hrs</span>
          </div>

          <span className="text-3xl font-bold text-text-3 mb-6">:</span>

          {/* Minutes */}
          <div className="flex flex-col items-center gap-1 flex-1">
            <button
              onClick={() => onMinutes(minutes === 59 ? 0 : minutes + 1)}
              className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-text-2 active:scale-90 transition-transform"
              aria-label="Increase minutes"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <span className="text-3xl font-bold text-text-1 tabular-nums w-12 text-center">
              {minutes.toString().padStart(2, "0")}
            </span>
            <button
              onClick={() => onMinutes(minutes === 0 ? 59 : minutes - 1)}
              className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-text-2 active:scale-90 transition-transform"
              aria-label="Decrease minutes"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <span className="text-[10px] text-text-3 uppercase tracking-wider">min</span>
          </div>

          <span className="text-3xl font-bold text-text-3 mb-6">:</span>

          {/* Seconds */}
          <div className="flex flex-col items-center gap-1 flex-1">
            <button
              onClick={() => onSeconds(seconds === 59 ? 0 : seconds + 1)}
              className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-text-2 active:scale-90 transition-transform"
              aria-label="Increase seconds"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
              </svg>
            </button>
            <span className="text-3xl font-bold text-text-1 tabular-nums w-12 text-center">
              {seconds.toString().padStart(2, "0")}
            </span>
            <button
              onClick={() => onSeconds(seconds === 0 ? 59 : seconds - 1)}
              className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center text-text-2 active:scale-90 transition-transform"
              aria-label="Decrease seconds"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <span className="text-[10px] text-text-3 uppercase tracking-wider">sec</span>
          </div>
        </div>
        {totalSeconds > 0 && (
          <p className="text-xs text-text-3 text-center">Goal: {formatSeconds(totalSeconds)}</p>
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
              className="rounded-[var(--radius-input)] bg-surface border border-hairline px-4 py-3 text-text-1 text-sm focus:outline-none focus:border-accent transition-colors"
              min={new Date().toISOString().split("T")[0]}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-text-2">Race date</span>
            <input
              type="date"
              value={raceDate}
              onChange={(e) => onRaceDate(e.target.value)}
              className="rounded-[var(--radius-input)] bg-surface border border-hairline px-4 py-3 text-text-1 text-sm focus:outline-none focus:border-accent transition-colors"
              min={startDate || new Date().toISOString().split("T")[0]}
            />
          </label>
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Training Preferences ──────────────────────────────────────────────

function OptionPill({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={selected}
      className={`px-4 py-2 rounded-full text-sm font-semibold border transition-all active:scale-95 ${
        selected ? "bg-accent text-on-accent border-accent" : "bg-surface text-text-2 border-hairline"
      }`}
    >
      {children}
    </button>
  );
}

function StepPreferences({
  daysPerWeek,
  onDaysPerWeek,
  trainingVolume,
  onVolume,
  trainingDifficulty,
  onDifficulty,
  preferredLongRunDay,
  onLongRunDay,
  hillyArea,
  onHillyArea,
  currentWeeklyKm,
  onCurrentWeeklyKm,
  longRunCapKm,
  onLongRunCapKm,
}: {
  daysPerWeek: number;
  onDaysPerWeek: (v: number) => void;
  trainingVolume: TrainingVolume;
  onVolume: (v: TrainingVolume) => void;
  trainingDifficulty: TrainingDifficulty;
  onDifficulty: (v: TrainingDifficulty) => void;
  preferredLongRunDay: number;
  onLongRunDay: (v: number) => void;
  hillyArea: boolean;
  onHillyArea: (v: boolean) => void;
  currentWeeklyKm: number;
  onCurrentWeeklyKm: (v: number) => void;
  longRunCapKm: number;
  onLongRunCapKm: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-extrabold text-text-1 tracking-tight">Training preferences</h2>
        <p className="text-sm text-text-2 mt-1">Customize your plan to fit your lifestyle.</p>
      </div>

      {/* Days per week */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Days per week</span>
          <span className="text-sm font-bold text-accent">{daysPerWeek} days</span>
        </div>
        <div className="flex items-center gap-3 rounded-[var(--radius-card)] bg-surface border border-hairline px-4 py-4">
          <button
            onClick={() => onDaysPerWeek(Math.max(3, daysPerWeek - 1))}
            disabled={daysPerWeek <= 3}
            className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center text-text-2 disabled:opacity-30 active:scale-90 transition-transform"
            aria-label="Decrease days"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
            </svg>
          </button>
          <div className="flex-1 flex gap-1 justify-center">
            {[3, 4, 5, 6].map((d) => (
              <div
                key={d}
                className={`h-2 flex-1 rounded-full transition-colors ${d <= daysPerWeek ? "bg-accent" : "bg-hairline"}`}
              />
            ))}
          </div>
          <button
            onClick={() => onDaysPerWeek(Math.min(6, daysPerWeek + 1))}
            disabled={daysPerWeek >= 6}
            className="w-9 h-9 rounded-full bg-elevated flex items-center justify-center text-text-2 disabled:opacity-30 active:scale-90 transition-transform"
            aria-label="Increase days"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Volume */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Training volume</span>
        <div className="flex gap-2">
          {(["low", "medium", "high"] as TrainingVolume[]).map((v) => (
            <OptionPill key={v} selected={trainingVolume === v} onClick={() => onVolume(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </OptionPill>
          ))}
        </div>
        <p className="text-xs text-text-3">
          {trainingVolume === "low" && "25–55 km/week peak. Good for first-timers."}
          {trainingVolume === "medium" && "40–80 km/week peak. Balanced approach."}
          {trainingVolume === "high" && "55–110 km/week peak. For experienced runners."}
        </p>
      </div>

      {/* Difficulty */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Workout intensity</span>
        <div className="flex gap-2">
          {(["easy", "moderate", "hard"] as TrainingDifficulty[]).map((d) => (
            <OptionPill key={d} selected={trainingDifficulty === d} onClick={() => onDifficulty(d)}>
              {d.charAt(0).toUpperCase() + d.slice(1)}
            </OptionPill>
          ))}
        </div>
        <p className="text-xs text-text-3">
          {trainingDifficulty === "easy" && "1 quality session/week. More easy miles."}
          {trainingDifficulty === "moderate" && "1 quality session/week with variety."}
          {trainingDifficulty === "hard" && "2 quality sessions/week. Tempo + intervals."}
        </p>
      </div>

      {/* Preferred long run day */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Long run day</span>
        <div className="flex gap-1.5 flex-wrap">
          {DAY_NAMES.map((name, i) => (
            <button
              key={name}
              onClick={() => onLongRunDay(i)}
              aria-pressed={preferredLongRunDay === i}
              className={`w-10 h-10 rounded-full text-sm font-semibold border transition-all active:scale-95 ${
                preferredLongRunDay === i
                  ? "bg-accent text-on-accent border-accent"
                  : "bg-surface text-text-2 border-hairline"
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Current weekly km */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">Current weekly km</span>
          <span className="text-sm font-bold text-accent">{currentWeeklyKm} km</span>
        </div>
        <input
          type="range"
          min={0}
          max={120}
          step={5}
          value={currentWeeklyKm}
          onChange={(e) => onCurrentWeeklyKm(Number(e.target.value))}
          className="w-full accent-[#C8FF3C]"
          aria-label={`Current weekly km: ${currentWeeklyKm}`}
        />
        <div className="flex justify-between text-[10px] text-text-3">
          <span>0 km</span>
          <span>120 km</span>
        </div>
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

      {/* Hilly area */}
      <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-surface border border-hairline px-4 py-4">
        <div>
          <p className="text-sm font-semibold text-text-1">Hilly area</p>
          <p className="text-xs text-text-3 mt-0.5">Adjusts paces for elevation (+8% effort)</p>
        </div>
        <button
          role="switch"
          aria-checked={hillyArea}
          onClick={() => onHillyArea(!hillyArea)}
          className={`relative w-12 h-6 rounded-full transition-colors ${hillyArea ? "bg-accent" : "bg-elevated"}`}
        >
          <div
            className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
              hillyArea ? "translate-x-7" : "translate-x-1"
            }`}
          />
        </button>
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
      <span className="text-sm font-semibold text-text-1 tabular-nums">{pace} /km</span>
    </div>
  );
}

function StepPreview({ plan }: { plan: GeneratedPlan }) {
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
        <div className="rounded-[var(--radius-card)] bg-surface border border-hairline p-4 flex flex-col gap-1">
          <span className="text-xs text-text-3 uppercase tracking-wider">Weeks</span>
          <span className="text-2xl font-extrabold text-accent">{plan.planLengthWeeks}</span>
        </div>
        <div className="rounded-[var(--radius-card)] bg-surface border border-hairline p-4 flex flex-col gap-1">
          <span className="text-xs text-text-3 uppercase tracking-wider">VDOT</span>
          <span className="text-2xl font-extrabold text-accent">{plan.vdot}</span>
        </div>
        <div className="rounded-[var(--radius-card)] bg-surface border border-hairline p-4 flex flex-col gap-1">
          <span className="text-xs text-text-3 uppercase tracking-wider">Days/wk</span>
          <span className="text-2xl font-extrabold text-accent">{plan.daysPerWeek}</span>
        </div>
      </div>

      {/* Pace zones */}
      <div className="rounded-[var(--radius-card)] bg-surface border border-hairline p-4 flex flex-col gap-1">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest mb-2">Pace zones</span>
        <PaceRow label="Easy / Long" pace={formatPace(paces.E.targetPaceSecKm)} />
        <PaceRow label="Marathon" pace={formatPace(paces.M.targetPaceSecKm)} />
        <PaceRow label="Tempo / Threshold" pace={formatPace(paces.T.targetPaceSecKm)} />
        <PaceRow label="Interval (VO2max)" pace={formatPace(paces.I.targetPaceSecKm)} />
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
  const [startDate, setStartDate] = useState(() => isoDateOffset(0));
  const [raceDate, setRaceDate] = useState(() => isoDateOffset(16));

  // Step 3
  const [daysPerWeek, setDaysPerWeek] = useState(4);
  const [trainingVolume, setTrainingVolume] = useState<TrainingVolume>("medium");
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
        return goalValid && datesValid;
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
          trainingVolume,
          trainingDifficulty,
          preferredLongRunDay,
          hillyArea,
          currentWeeklyKm,
          longRunCapKm,
        };
        const plan = generatePlan(config);
        setGeneratedPlan(plan);
        setStep(3);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to generate plan");
      }
      return;
    }
    if (step < 3) setStep((prev) => (prev + 1) as Step);
  }

  function handleBack() {
    if (step > 0) setStep((prev) => (prev - 1) as Step);
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
        trainingVolume,
        trainingDifficulty,
        preferredLongRunDay,
        hillyArea,
        currentWeeklyKm,
        longRunCapKm,
      };

      const res = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `Server error ${res.status}`);
      }

      const savedPlan = await res.json();
      router.push(`/plan?id=${savedPlan.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save plan");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <main className="flex-1 flex flex-col max-w-md mx-auto w-full px-4 pt-10 pb-32 gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <button
            onClick={step > 0 ? handleBack : () => router.push("/")}
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center text-text-2"
            aria-label={step > 0 ? "Go back" : "Close"}
          >
            {step > 0 ? (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
          <div className="flex-1">
            <StepIndicator current={step} />
          </div>
        </div>

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
          />
        )}
        {step === 2 && (
          <StepPreferences
            daysPerWeek={daysPerWeek}
            onDaysPerWeek={setDaysPerWeek}
            trainingVolume={trainingVolume}
            onVolume={setTrainingVolume}
            trainingDifficulty={trainingDifficulty}
            onDifficulty={setTrainingDifficulty}
            preferredLongRunDay={preferredLongRunDay}
            onLongRunDay={setPreferredLongRunDay}
            hillyArea={hillyArea}
            onHillyArea={setHillyArea}
            currentWeeklyKm={currentWeeklyKm}
            onCurrentWeeklyKm={setCurrentWeeklyKm}
            longRunCapKm={longRunCapKm}
            onLongRunCapKm={setLongRunCapKm}
          />
        )}
        {step === 3 && generatedPlan && (
          <StepPreview plan={generatedPlan} />
        )}

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-input)] bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}
      </main>

      {/* Sticky CTA */}
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg/90 backdrop-blur-md border-t border-hairline px-4 py-4">
        <div className="max-w-md mx-auto">
          {step < 3 ? (
            <button
              onClick={handleNext}
              disabled={!canAdvance()}
              className="w-full rounded-[var(--radius-input)] bg-accent text-on-accent font-bold text-sm py-4 active:scale-[0.98] transition-transform disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {step === 2 ? "Generate Plan" : "Continue"}
            </button>
          ) : (
            <button
              onClick={handleConfirm}
              disabled={saving}
              className="w-full rounded-[var(--radius-input)] bg-accent text-on-accent font-bold text-sm py-4 active:scale-[0.98] transition-transform disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? "Saving plan..." : "Start Training"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
