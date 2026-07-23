"use client";

import { haptic } from "@/lib/haptics";
import { DAY_OPTIONS } from "./data";

export function StepAvailability({
  daysPerWeek,
  availableDays,
  onAvailableDays,
  longRunDay,
  onLongRunDay,
}: {
  daysPerWeek: number;
  availableDays: number[];
  onAvailableDays: (days: number[]) => void;
  longRunDay: number | null;
  onLongRunDay: (day: number) => void;
}) {
  const remaining = daysPerWeek - availableDays.length;
  const selectedDayOptions = DAY_OPTIONS.filter((d) => availableDays.includes(d.value));

  function toggle(day: number) {
    haptic("light");
    if (availableDays.includes(day)) {
      onAvailableDays(availableDays.filter((d) => d !== day));
    } else {
      onAvailableDays([...availableDays, day]);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Day pills */}
      <div className="flex flex-col gap-2.5">
        <div className="flex justify-between gap-1.5" role="group" aria-label="Available days">
          {DAY_OPTIONS.map(({ name, value }) => {
            const on = availableDays.includes(value);
            return (
              <button
                key={value}
                onClick={() => toggle(value)}
                aria-pressed={on}
                className={`press flex h-12 flex-1 flex-col items-center justify-center rounded-full text-[13px] font-bold transition-colors ${
                  on
                    ? "bg-accent text-on-accent"
                    : "bg-surface text-text-2 [box-shadow:var(--k-ring-hairline)]"
                }`}
              >
                {name.charAt(0)}
                <span className="sr-only">{name}</span>
              </button>
            );
          })}
        </div>
        <p className="text-[13px] text-text-3" aria-live="polite">
          {remaining > 0
            ? `Pick ${remaining} more ${remaining === 1 ? "day" : "days"}`
            : "All set, workouts will only land on these days."}
        </p>
        <p className="text-[12px] leading-relaxed text-text-3">
          Pick at least {daysPerWeek}, extra days give your plan room to breathe and space for
          strength work.
        </p>
      </div>

      {/* Long run day, only among the chosen days */}
      {availableDays.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <span className="text-xs font-semibold uppercase tracking-widest text-text-3">Long run day</span>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Long run day">
            {selectedDayOptions.map(({ name, value }) => {
              const selected = longRunDay === value;
              return (
                <button
                  key={value}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    haptic("light");
                    onLongRunDay(value);
                  }}
                  className={`press rounded-full px-4 py-2.5 text-[14px] font-semibold transition-colors ${
                    selected
                      ? "bg-accent text-on-accent"
                      : "bg-surface text-text-2 [box-shadow:var(--k-ring-hairline)]"
                  }`}
                >
                  {name}
                </button>
              );
            })}
          </div>
          <p className="text-[12px] leading-relaxed text-text-3">
            Your longest run of the week. Most runners pick a weekend day.
          </p>
        </div>
      )}
    </div>
  );
}
