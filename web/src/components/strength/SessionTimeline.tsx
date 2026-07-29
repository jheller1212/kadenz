// ── Session start / finish / real duration ───────────────────────────────────
// startedAt/endedAt (PR #95, migration 0046) are derived from the first and
// last logged set's createdAt, not from a button tap — they're null until the
// first set is logged, so this only ever renders once there's something to
// show. durationMinutes (session.durationMinutes) is the real elapsed time
// between those two timestamps; it must never carry the "~" estimate prefix
// that targetDurationMinutes/the plan estimate get elsewhere on this page.

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function SessionTimeline({
  startedAt,
  endedAt,
  durationMinutes,
}: {
  startedAt: string | null;
  endedAt: string | null;
  durationMinutes: number | null;
}) {
  if (!startedAt) return null;

  return (
    <section className="k-card p-4">
      <div className="flex items-end gap-6">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-text-3">Started</p>
          <p className="text-[17px] font-extrabold tabular-nums text-text-1">
            {formatClock(startedAt)}
          </p>
        </div>
        {endedAt && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-3">Finished</p>
            <p className="text-[17px] font-extrabold tabular-nums text-text-1">
              {formatClock(endedAt)}
            </p>
          </div>
        )}
        {durationMinutes != null && (
          <div>
            <p className="text-[11px] uppercase tracking-wide text-text-3">Duration</p>
            <p className="text-[17px] font-extrabold tabular-nums text-text-1">
              {durationMinutes}
              <span className="text-[12px] font-semibold text-text-3"> min</span>
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
