interface Props {
  plannedKm: number;
  completedKm: number;
  daysCompleted: number;
  totalDays: number;
}

export function QuickStats({
  plannedKm,
  completedKm,
  daysCompleted,
  totalDays,
}: Props) {
  const pct = plannedKm > 0 ? Math.round((completedKm / plannedKm) * 100) : 0;

  return (
    <div
      className="k-card p-4 flex gap-4"
      role="region"
      aria-label="Weekly stats"
    >
      {/* Weekly km */}
      <div className="flex-1 flex flex-col gap-1">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">
          Weekly km
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold tabular-nums text-text-1">
            {completedKm}
          </span>
          <span className="text-sm text-text-3">/ {plannedKm} km</span>
        </div>
        {/* Progress bar */}
        <div
          className="h-1 rounded-full bg-elevated overflow-hidden mt-1"
          role="progressbar"
          aria-valuenow={completedKm}
          aria-valuemin={0}
          aria-valuemax={plannedKm}
          aria-label={`${completedKm} of ${plannedKm} km completed`}
        >
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Divider */}
      <div className="w-px bg-hairline" aria-hidden="true" />

      {/* Days done */}
      <div className="flex-1 flex flex-col gap-1">
        <span className="text-xs font-semibold text-text-3 uppercase tracking-widest">
          Days done
        </span>
        <div className="flex items-baseline gap-1">
          <span className="text-xl font-bold tabular-nums text-text-1">
            {daysCompleted}
          </span>
          <span className="text-sm text-text-3">/ {totalDays}</span>
        </div>
        {/* Pip row */}
        <div className="flex gap-1 mt-1" aria-hidden="true">
          {Array.from({ length: totalDays }).map((_, i) => (
            <div
              key={i}
              className={`h-1 flex-1 rounded-full ${
                i < daysCompleted ? "bg-accent" : "bg-elevated"
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
