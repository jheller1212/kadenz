"use client";

import { useState } from "react";
import { AlertCircle, Check, Search } from "lucide-react";
import type { RaceDistance } from "@/lib/plan-engine/types";
import { TimePicker } from "@/components/TimePicker";
import { Segmented } from "@/components/ui/Segmented";
import { haptic } from "@/lib/haptics";
import {
  DISTANCE_OPTIONS,
  GOAL_TIME_RANGES,
  DISTANCE_LABEL,
  POPULAR_RACES,
  formatRaceDate,
  formatSeconds,
  isoToday,
  weeksBetween,
  type PopularRace,
} from "./data";

export type GoalTab = "distances" | "races";

export function getGoalTimeWarning(raceDistance: RaceDistance | null, totalSeconds: number): string | null {
  if (!raceDistance || totalSeconds <= 0) return null;
  const range = GOAL_TIME_RANGES[raceDistance];
  const label = DISTANCE_LABEL[raceDistance];
  if (totalSeconds < range.wr) {
    return `That's faster than the world record for ${label}. Please enter a realistic goal time.`;
  }
  if (totalSeconds < range.elite) {
    return "That's an elite-level time. This app is designed for recreational runners — pacing may not suit sub-elite athletes.";
  }
  if (totalSeconds > range.slow) {
    return `That's quite slow for a ${label}. Consider walking intervals or a run/walk plan instead.`;
  }
  return null;
}

export function StepGoal({
  tab,
  onTab,
  raceDistance,
  onDistance,
  selectedRaceId,
  onRace,
  hours,
  minutes,
  seconds,
  onHours,
  onMinutes,
  onSeconds,
}: {
  tab: GoalTab;
  onTab: (t: GoalTab) => void;
  raceDistance: RaceDistance | null;
  onDistance: (d: RaceDistance) => void;
  selectedRaceId: string | null;
  onRace: (r: PopularRace) => void;
  hours: number;
  minutes: number;
  seconds: number;
  onHours: (v: number) => void;
  onMinutes: (v: number) => void;
  onSeconds: (v: number) => void;
}) {
  const [query, setQuery] = useState("");
  const totalSeconds = hours * 3600 + minutes * 60 + seconds;
  const warning = getGoalTimeWarning(raceDistance, totalSeconds);

  const selectedRace = POPULAR_RACES.find((r) => r.id === selectedRaceId) ?? null;
  const shortWindow = selectedRace ? weeksBetween(isoToday(), selectedRace.date) < 4 : false;

  const q = query.trim().toLowerCase();
  const filteredRaces = POPULAR_RACES.filter(
    (r) => !q || r.name.toLowerCase().includes(q) || r.location.toLowerCase().includes(q)
  );

  return (
    <div className="flex flex-col gap-5">
      <Segmented
        options={[
          { value: "distances", label: "Distances" },
          { value: "races", label: "Popular Races" },
        ]}
        value={tab}
        onChange={(v) => onTab(v as GoalTab)}
      />

      {tab === "distances" && (
        <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Race distance">
          {DISTANCE_OPTIONS.map(({ distance, label, sublabel }) => {
            const selected = selectedRaceId === null && raceDistance === distance;
            return (
              <button
                key={distance}
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  haptic("light");
                  onDistance(distance);
                }}
                className={`press flex flex-col items-start rounded-2xl bg-surface p-4 text-left transition-shadow focus:outline-none focus:ring-2 focus:ring-accent ${
                  selected
                    ? "[box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                    : "[box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
                }`}
              >
                <span className={`text-2xl font-extrabold tracking-tight ${selected ? "text-accent" : "text-text-1"}`}>
                  {label}
                </span>
                <span className="mt-0.5 text-xs text-text-3">{sublabel}</span>
                {selected && (
                  <span className="mt-2 flex h-4 w-4 items-center justify-center rounded-full bg-accent">
                    <Check className="h-2.5 w-2.5 text-on-accent" strokeWidth={3} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {tab === "races" && (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 rounded-[var(--radius-input)] bg-elevated px-3.5 py-3">
            <Search className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search races"
              aria-label="Search races"
              className="w-full bg-transparent text-[15px] text-text-1 placeholder:text-text-3 focus:outline-none"
            />
          </label>

          <div className="flex flex-col gap-2.5" role="radiogroup" aria-label="Popular races">
            {filteredRaces.map((race) => {
              const selected = selectedRaceId === race.id;
              return (
                <button
                  key={race.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    haptic("light");
                    onRace(race);
                  }}
                  className={`press flex w-full items-center gap-3 rounded-2xl bg-surface p-4 text-left transition-shadow ${
                    selected
                      ? "[box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                      : "[box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold tracking-tight text-text-1">{race.name}</span>
                    <span className="mt-0.5 block text-[13px] text-text-2">
                      {race.location} · {DISTANCE_LABEL[race.distance]}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block text-[13px] font-semibold tabular-nums ${selected ? "text-accent" : "text-text-2"}`}>
                      {formatRaceDate(race.date)}
                    </span>
                  </span>
                </button>
              );
            })}
            {filteredRaces.length === 0 && (
              <p className="py-4 text-center text-[14px] text-text-3">
                No race found. Pick a distance instead and set your own race date.
              </p>
            )}
          </div>
          <p className="text-[12px] leading-relaxed text-text-3">
            Can&apos;t find your race? Choose its distance under Distances and set the date yourself in a later step.
          </p>
        </div>
      )}

      {shortWindow && selectedRace && (
        <div className="flex items-start gap-2 rounded-[var(--radius-input)] bg-warn/10 px-4 py-3 text-xs leading-relaxed text-warn">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
          <span>
            Very short training window — {selectedRace.name} is less than 4 weeks away. The plan will focus on
            sharpening, not building fitness.
          </span>
        </div>
      )}

      {raceDistance && (
        <div className="flex flex-col gap-3">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-3">
            Goal finish time · {DISTANCE_LABEL[raceDistance]}
          </span>
          <TimePicker
            hours={hours}
            minutes={minutes}
            seconds={seconds}
            onHours={onHours}
            onMinutes={onMinutes}
            onSeconds={onSeconds}
          />
          {totalSeconds > 0 && (
            <p className="text-center text-xs text-text-3">Goal: {formatSeconds(totalSeconds)}</p>
          )}
          {warning && (
            <div className="flex items-start gap-2 rounded-[var(--radius-input)] bg-warn/10 px-4 py-3 text-xs leading-relaxed text-warn">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
              <span>{warning}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
