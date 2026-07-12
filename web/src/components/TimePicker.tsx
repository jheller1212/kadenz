"use client";

import { useRef } from "react";

interface TimePickerProps {
  hours: number;
  minutes: number;
  seconds: number;
  onHours: (v: number) => void;
  onMinutes: (v: number) => void;
  onSeconds: (v: number) => void;
}

function TimeColumn({
  value,
  onChange,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
  label: string;
}) {
  const holdRef = useRef<ReturnType<typeof setInterval>>(undefined);

  function increment() {
    onChange(value >= max ? 0 : value + 1);
  }
  function decrement() {
    onChange(value <= 0 ? max : value - 1);
  }

  function startHold(fn: () => void) {
    fn();
    holdRef.current = setInterval(fn, 120);
  }
  function stopHold() {
    if (holdRef.current) clearInterval(holdRef.current);
  }

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onPointerDown={() => startHold(increment)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        className="w-16 h-10 flex items-center justify-center rounded-t-lg bg-elevated active:bg-hairline transition-colors touch-none select-none"
        aria-label={`Increase ${label}`}
      >
        <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        </svg>
      </button>
      <div className="w-16 h-14 flex items-center justify-center bg-surface border-y border-hairline">
        <span className="text-3xl font-extrabold text-text-1 tabular-nums select-none">
          {value.toString().padStart(2, "0")}
        </span>
      </div>
      <button
        onPointerDown={() => startHold(decrement)}
        onPointerUp={stopHold}
        onPointerLeave={stopHold}
        className="w-16 h-10 flex items-center justify-center rounded-b-lg bg-elevated active:bg-hairline transition-colors touch-none select-none"
        aria-label={`Decrease ${label}`}
      >
        <svg className="w-4 h-4 text-text-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <span className="text-[10px] text-text-3 uppercase tracking-wider font-medium mt-0.5">{label}</span>
    </div>
  );
}

export function TimePicker({ hours, minutes, seconds, onHours, onMinutes, onSeconds }: TimePickerProps) {
  return (
    <div className="flex items-start justify-center gap-2 k-card border border-hairline py-4 px-3">
      <TimeColumn value={hours} onChange={onHours} max={9} label="hrs" />
      <span className="text-2xl font-bold text-text-3 mt-12">:</span>
      <TimeColumn value={minutes} onChange={onMinutes} max={59} label="min" />
      <span className="text-2xl font-bold text-text-3 mt-12">:</span>
      <TimeColumn value={seconds} onChange={onSeconds} max={59} label="sec" />
    </div>
  );
}
