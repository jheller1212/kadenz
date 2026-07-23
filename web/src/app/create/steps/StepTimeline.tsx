"use client";

import { AlertCircle, CalendarDays } from "lucide-react";
import { haptic } from "@/lib/haptics";
import { formatRaceDate, isoDateOffset, isoNextMonday, isoToday, weeksBetween } from "./data";

export function StepTimeline({
  goalType,
  startDate,
  onStartDate,
  raceDate,
  onRaceDate,
  raceLocked,
  blockWeeks,
  onBlockWeeks,
}: {
  goalType: "distance" | "race";
  startDate: string;
  onStartDate: (v: string) => void;
  raceDate: string;
  onRaceDate: (v: string) => void;
  /** True when a popular race locked the race date. */
  raceLocked: boolean;
  blockWeeks: 8 | 12 | 16;
  onBlockWeeks: (w: 8 | 12 | 16) => void;
}) {
  const buildWeeks = weeksBetween(startDate, raceDate);
  const today = isoToday();
  const nextMonday = isoNextMonday();

  return (
    <div className="flex flex-col gap-6">
      {/* Start date */}
      <div className="flex flex-col gap-2.5">
        <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Start date</span>
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { label: "Start today", value: today },
            { label: "Start next Monday", value: nextMonday },
          ].map(({ label, value }) => {
            const selected = startDate === value;
            return (
              <button
                key={label}
                onClick={() => {
                  haptic("light");
                  onStartDate(value);
                }}
                aria-pressed={selected}
                className={`press rounded-2xl bg-surface px-4 py-3.5 text-[14px] font-bold transition-shadow ${
                  selected
                    ? "text-accent-fg [box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                    : "text-text-1 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <input
          type="date"
          value={startDate}
          onChange={(e) => onStartDate(e.target.value)}
          min={isoDateOffset(-7)}
          aria-label="Plan start date"
          className="rounded-[var(--radius-input)] bg-elevated px-4 py-3 text-sm text-text-1 transition-shadow focus:outline-none focus:ring-2 focus:ring-accent"
        />
      </div>

      {goalType === "race" ? (
        <div className="flex flex-col gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Race date</span>
          {raceLocked ? (
            <div className="flex items-center gap-3 rounded-2xl bg-surface p-4 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]">
              <CalendarDays className="h-5 w-5 shrink-0 text-accent-fg" strokeWidth={2} />
              <div>
                <p className="text-[15px] font-bold text-text-1">{formatRaceDate(raceDate)}</p>
                <p className="text-[12px] text-text-3">Locked to your race</p>
              </div>
            </div>
          ) : (
            <input
              type="date"
              value={raceDate}
              onChange={(e) => onRaceDate(e.target.value)}
              min={startDate || today}
              aria-label="Race date"
              className="rounded-[var(--radius-input)] bg-elevated px-4 py-3 text-sm text-text-1 transition-shadow focus:outline-none focus:ring-2 focus:ring-accent"
            />
          )}

          {buildWeeks > 0 ? (
            <div className="rounded-2xl bg-accent/10 px-4 py-3.5">
              <p className="text-[15px] font-bold text-accent-fg">
                You have a {buildWeeks}-week build
              </p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-text-2">
                From {formatRaceDate(startDate)} to race day on {formatRaceDate(raceDate)}.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-[var(--radius-input)] bg-warn/10 px-4 py-3 text-xs leading-relaxed text-warn">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
              <span>Race date must be after your start date.</span>
            </div>
          )}
          {buildWeeks > 0 && buildWeeks < 4 && (
            <div className="flex items-start gap-2 rounded-[var(--radius-input)] bg-warn/10 px-4 py-3 text-xs leading-relaxed text-warn">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={2} />
              <span>Very short training window, expect a sharpening block rather than a full build.</span>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Plan length</span>
          <div className="grid grid-cols-3 gap-2.5" role="radiogroup" aria-label="Plan length">
            {([8, 12, 16] as const).map((w) => {
              const selected = blockWeeks === w;
              return (
                <button
                  key={w}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    haptic("light");
                    onBlockWeeks(w);
                  }}
                  className={`press flex flex-col items-center rounded-2xl bg-surface px-3 py-4 transition-shadow ${
                    selected
                      ? "[box-shadow:0_0_0_2px_var(--k-accent),var(--k-shadow-card)]"
                      : "[box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
                  }`}
                >
                  <span className={`text-2xl font-extrabold tabular-nums ${selected ? "text-accent-fg" : "text-text-1"}`}>
                    {w}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">weeks</span>
                </button>
              );
            })}
          </div>
          <p className="text-[12px] leading-relaxed text-text-3">
            Your plan finishes with a goal-pace time trial on {formatRaceDate(raceDate)}.
          </p>
        </div>
      )}
    </div>
  );
}
