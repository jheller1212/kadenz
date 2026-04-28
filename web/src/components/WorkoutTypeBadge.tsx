// WorkoutType is a union of both the mock-data types and plan-engine types.
// We define it locally here so the badge works for both sources.
type WorkoutType =
  | "easy"
  | "tempo"
  | "interval"
  | "long"
  | "rest"
  | "recovery"
  | "race";

interface Props {
  type: WorkoutType;
}

const config: Record<WorkoutType, { label: string; className: string }> = {
  easy: {
    label: "Easy",
    className: "bg-[#1A3A2A] text-[#4ADE80]",
  },
  tempo: {
    label: "Tempo",
    className: "bg-[#3A2A00] text-[#FFB547]",
  },
  interval: {
    label: "Interval",
    className: "bg-[#2A1A3A] text-[#C084FC]",
  },
  long: {
    label: "Long",
    className: "bg-[#1A2A3A] text-[#60A5FA]",
  },
  rest: {
    label: "Rest",
    className: "bg-elevated text-text-3",
  },
  recovery: {
    label: "Recovery",
    className: "bg-[#1A3A2A] text-[#4ADE80]",
  },
  race: {
    label: "Race",
    className: "bg-[#3A0000] text-[#FF4D4D]",
  },
};

export function WorkoutTypeBadge({ type }: Props) {
  const { label, className } = config[type];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wider uppercase ${className}`}
    >
      {label}
    </span>
  );
}
