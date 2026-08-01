"use client";

import { useState, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";

export interface WellnessLog {
  date: string;
  energy: number | null;
  sleepQuality: number | null;
  soreness: number | null;
  bodyweightKg: number | null;
}

const SCALES: Array<{ key: "energy" | "sleepQuality" | "soreness"; label: string; low: string; high: string }> = [
  { key: "energy", label: "Energy", low: "Drained", high: "Fresh" },
  { key: "sleepQuality", label: "Sleep", low: "Poor", high: "Great" },
  { key: "soreness", label: "Soreness", low: "None", high: "Very sore" },
];

function todayIso(): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday avoids TZ edge flips
  return d.toISOString();
}

/** Today's window, latest row wins — shared by the mount fetch and the
 * bootstrap-seeded path so both pick the same row the same way. */
function latestOf(rows: WellnessLog[]): WellnessLog | undefined {
  return rows[rows.length - 1];
}

// `initial` lets the Today screen's one bootstrap call (/api/today/bootstrap)
// seed today's check-in without a second request on mount — see page.tsx.
// `undefined` (bootstrap didn't cover this, or its wellness section failed)
// falls back to the original self-fetch.
export function WellnessCheckIn({ initial }: { initial?: WellnessLog[] }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(initial !== undefined);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(() => {
    const log = initial ? latestOf(initial) : undefined;
    return log ? Date.now() : null;
  });
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, number | null>>(() => {
    const log = initial ? latestOf(initial) : undefined;
    return {
      energy: log?.energy ?? null,
      sleepQuality: log?.sleepQuality ?? null,
      soreness: log?.soreness ?? null,
    };
  });
  const [weight, setWeight] = useState<string>(() => {
    const log = initial ? latestOf(initial) : undefined;
    return log?.bodyweightKg ? String(log.bodyweightKg) : "";
  });

  useEffect(() => {
    if (initial !== undefined) return;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    apiFetch(`/api/wellness?from=${start.toISOString()}&to=${end.toISOString()}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: WellnessLog[]) => {
        const log = latestOf(rows);
        if (log) {
          setValues({
            energy: log.energy,
            sleepQuality: log.sleepQuality,
            soreness: log.soreness,
          });
          if (log.bodyweightKg) setWeight(String(log.bodyweightKg));
          setSavedAt(Date.now());
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `initial` is a one-time seed, checked only for its presence
  }, []);

  async function save(next: Record<string, number | null>, weightStr: string) {
    setSaving(true);
    setError(null);
    try {
      const bodyweightKg = weightStr ? parseFloat(weightStr.replace(",", ".")) : null;
      const res = await apiFetch("/api/wellness", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: todayIso(),
          energy: next.energy,
          sleepQuality: next.sleepQuality,
          soreness: next.soreness,
          bodyweightKg: bodyweightKg && Number.isFinite(bodyweightKg) && bodyweightKg > 0 ? bodyweightKg : null,
        }),
      });
      if (res.ok) {
        haptic("light");
        // Only nullness matters (see `done`); a pure bump avoids Date.now() in render-reachable code.
        setSavedAt((n) => (n ?? 0) + 1);
        // Let the readiness card (and anything else) recompute immediately.
        window.dispatchEvent(new Event("kadenz:wellness-saved"));
      } else {
        setError("Couldn't save.");
      }
    } catch {
      setError("Couldn't save.");
    } finally {
      setSaving(false);
    }
  }

  function pick(key: string, n: number) {
    const next = { ...values, [key]: values[key] === n ? null : n };
    setValues(next);
    save(next, weight);
  }

  if (!loaded) return null;

  const done = savedAt !== null && Object.values(values).some((v) => v !== null);

  return (
    <div className="mx-5 k-card">
      <button
        type="button"
        onClick={() => {
          haptic("light");
          setOpen(!open);
        }}
        className="press flex w-full items-center justify-between p-4"
      >
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold text-text-1">Daily check-in</span>
          {done && !open && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#4ADE80]/15">
              <Check className="h-3 w-3 text-[#4ADE80]" strokeWidth={3} />
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-text-3 transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2.5}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-4 px-4 pb-4">
          {SCALES.map(({ key, label, low, high }) => (
            <div key={key}>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[13px] font-semibold text-text-2">{label}</span>
                <span className="text-[10px] text-text-3">
                  {low} → {high}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    disabled={saving}
                    onClick={() => pick(key, n)}
                    className={`press rounded-md py-2 text-[13px] font-bold tabular-nums ${
                      values[key] === n ? "bg-accent text-black" : "bg-elevated text-text-2"
                    } disabled:opacity-50`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] font-semibold text-text-2">Bodyweight</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min={0}
                placeholder="—"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                onBlur={() => weight && save(values, weight)}
                className="w-20 rounded-[var(--radius-input)] bg-elevated px-2 py-2 text-center text-[15px] font-semibold text-text-1 outline-none tabular-nums focus:ring-2 focus:ring-accent/40"
              />
              <span className="text-[13px] text-text-3">kg</span>
            </div>
          </div>

          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
      )}
    </div>
  );
}
