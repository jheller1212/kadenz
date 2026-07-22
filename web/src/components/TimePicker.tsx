"use client";

import { WheelPicker } from "@/components/ui/WheelPicker";

interface TimePickerProps {
  hours: number;
  minutes: number;
  seconds: number;
  onHours: (v: number) => void;
  onMinutes: (v: number) => void;
  onSeconds: (v: number) => void;
}

function WheelColumn({
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
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <WheelPicker min={0} max={max} value={value} onChange={onChange} />
      <span className="text-[10px] font-medium uppercase tracking-wider text-text-3">{label}</span>
    </div>
  );
}

// Three thumb-scrollable drums (hours : minutes : seconds) —
// the centered row is the selected value.
export function TimePicker({ hours, minutes, seconds, onHours, onMinutes, onSeconds }: TimePickerProps) {
  return (
    <div className="flex items-center justify-center gap-1 k-card border border-hairline py-3 px-2">
      <WheelColumn value={hours} onChange={onHours} max={9} label="hrs" />
      <span className="pb-5 text-2xl font-bold text-text-3">:</span>
      <WheelColumn value={minutes} onChange={onMinutes} max={59} label="min" />
      <span className="pb-5 text-2xl font-bold text-text-3">:</span>
      <WheelColumn value={seconds} onChange={onSeconds} max={59} label="sec" />
    </div>
  );
}
