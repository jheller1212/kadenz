"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { TrainingDifficulty, TrainingVolume } from "@/lib/plan-engine/types";
import { Segmented } from "@/components/ui/Segmented";
import { Switch } from "@/components/ui/8bit-switch";
import { haptic } from "@/lib/haptics";

export function StepPreferences({
  trainingVolume,
  onVolume,
  trainingDifficulty,
  onDifficulty,
  paceLongRuns,
  onPaceLongRuns,
  currentWeeklyKm,
  onCurrentWeeklyKm,
  longRunCapKm,
  onLongRunCapKm,
  easyRunMinKm,
  onEasyRunMinKm,
  hillyArea,
  onHillyArea,
}: {
  trainingVolume: TrainingVolume;
  onVolume: (v: TrainingVolume) => void;
  trainingDifficulty: TrainingDifficulty;
  onDifficulty: (v: TrainingDifficulty) => void;
  paceLongRuns: boolean;
  onPaceLongRuns: (v: boolean) => void;
  currentWeeklyKm: number;
  onCurrentWeeklyKm: (v: number) => void;
  longRunCapKm: number;
  onLongRunCapKm: (v: number) => void;
  easyRunMinKm: number;
  onEasyRunMinKm: (v: number) => void;
  hillyArea: boolean;
  onHillyArea: (v: boolean) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      {/* Volume */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Weekly volume</span>
        <Segmented
          options={[
            { value: "low", label: "Low" },
            { value: "medium", label: "Normal" },
            { value: "high", label: "High" },
          ]}
          value={trainingVolume === "beginner" ? "low" : trainingVolume === "elite" ? "high" : trainingVolume}
          onChange={(v) => onVolume(v as TrainingVolume)}
        />
        <p className="text-xs text-text-3">
          {(trainingVolume === "low" || trainingVolume === "beginner") && "Gentler mileage ramp. Great alongside a busy life."}
          {trainingVolume === "medium" && "The standard build for your race distance."}
          {(trainingVolume === "high" || trainingVolume === "elite") && "More km per week for a bigger aerobic engine."}
        </p>
      </div>

      {/* Difficulty */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Workout intensity</span>
        <Segmented
          options={[
            { value: "easy", label: "Low" },
            { value: "moderate", label: "Normal" },
            { value: "hard", label: "High" },
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

      {/* Long-run pace targets */}
      <div className="flex items-center justify-between rounded-2xl bg-surface p-4 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]">
        <div className="min-w-0 pr-3">
          <p className="text-[15px] font-bold text-text-1">Add pace targets to long runs</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-text-2">
            Off = run long runs by feel; workouts show distance only.
          </p>
        </div>
        <Switch checked={paceLongRuns} onChange={onPaceLongRuns} aria-label="Pace targets on long runs" />
      </div>

      {/* Advanced */}
      <div className="flex flex-col gap-3">
        <button
          onClick={() => {
            haptic("light");
            setAdvancedOpen((o) => !o);
          }}
          aria-expanded={advancedOpen}
          className="press flex items-center justify-between py-1"
        >
          <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Advanced</span>
          <ChevronDown
            className={`h-4 w-4 text-text-3 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            strokeWidth={2}
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
                {/* Current weekly km */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-text-2">Current weekly km</span>
                    <span className="text-sm font-bold tabular-nums text-accent">{currentWeeklyKm} km</span>
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
                  {currentWeeklyKm === 0 && (
                    <p className="text-xs leading-relaxed text-text-3">
                      No worries — we&apos;ll start you at ~10 km/week and build up slowly.
                    </p>
                  )}
                </div>

                {/* Long run cap */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-text-2">Long run cap</span>
                    <span className="text-sm font-bold tabular-nums text-accent">
                      {longRunCapKm === 0 ? "No cap" : `${longRunCapKm} km`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={42}
                    step={1}
                    value={longRunCapKm}
                    onChange={(e) => onLongRunCapKm(Number(e.target.value))}
                    className="w-full accent-[var(--k-progress)]"
                    aria-label={`Long run cap: ${longRunCapKm === 0 ? "none" : longRunCapKm + " km"}`}
                  />
                </div>

                {/* Easy run minimum */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold text-text-2">Easy run minimum</span>
                    <span className="text-sm font-bold tabular-nums text-accent">
                      {easyRunMinKm === 0 ? "No min" : `${easyRunMinKm} km`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={15}
                    step={1}
                    value={easyRunMinKm}
                    onChange={(e) => onEasyRunMinKm(Number(e.target.value))}
                    className="w-full accent-[var(--k-progress)]"
                    aria-label={`Easy run minimum: ${easyRunMinKm === 0 ? "none" : easyRunMinKm + " km"}`}
                  />
                </div>

                {/* Hilly area */}
                <div className="flex items-center justify-between">
                  <div className="min-w-0 pr-3">
                    <p className="text-[13px] font-semibold text-text-2">Hilly area</p>
                    <p className="text-[12px] text-text-3">Slows pace targets by ~8% for elevation.</p>
                  </div>
                  <Switch checked={hillyArea} onChange={onHillyArea} aria-label="Hilly area" />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
