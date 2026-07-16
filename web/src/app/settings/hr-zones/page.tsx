"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";
import { loadSettings, saveSettings } from "@/lib/settings";
import { estimateMaxHr } from "@/lib/plan-engine/hr-zones";

// ── Heart Rate Zones — Benchmark-style: the user adjusts each zone's upper bound
// directly; age only seeds the defaults. ─────────────────────────────────────

const ZONES = [
  { name: "Zone 1: Recovery", desc: "Easy effort for warm-ups, cool-downs, and active recovery.", color: "#64748B" },
  { name: "Zone 2: Endurance", desc: "Comfortable effort that burns fat and builds endurance.", color: "#3B82F6" },
  { name: "Zone 3: Tempo", desc: "Challenging but sustainable. Improves aerobic fitness and muscle strength.", color: "#22C55E" },
  { name: "Zone 4: Threshold", desc: "Hard effort. Builds speed and power while training your body to tolerate lactic acid.", color: "#F2A113" },
  { name: "Zone 5: Anaerobic", desc: "Maximum effort. Pushes your body to its limit — best kept for short bursts.", color: "#E0402E" },
];

const DEFAULT_PCTS = [0.75, 0.82, 0.86, 0.91];

function defaultsFor(maxHr: number): number[] {
  return DEFAULT_PCTS.map((p) => Math.round(maxHr * p));
}

export default function HrZonesPage() {
  const router = useRouter();
  const [birthYear, setBirthYear] = useState<number | null>(null);
  const [maxHr, setMaxHr] = useState(185);
  const [bounds, setBounds] = useState<number[]>(defaultsFor(185));
  const [dirty, setDirty] = useState(false);
  const [adjusting, setAdjusting] = useState<number | null>(null); // 0-3 = zone bound, 4 = max
  const [draft, setDraft] = useState(0);

  useEffect(() => {
    const s = loadSettings();
    const age = s.birthYear ? new Date().getFullYear() - s.birthYear : 35;
    const max = s.maxHrOverride ?? estimateMaxHr(age);
    setBirthYear(s.birthYear ?? null);
    setMaxHr(max);
    setBounds(s.hrZoneBounds && s.hrZoneBounds.length === 4 ? s.hrZoneBounds : defaultsFor(max));
  }, []);

  function openAdjust(idx: number) {
    haptic("light");
    setAdjusting(idx);
    setDraft(idx === 4 ? maxHr : bounds[idx]);
  }

  function applyDraft() {
    if (adjusting == null) return;
    haptic("medium");
    if (adjusting === 4) {
      const next = Math.max(bounds[3] + 1, Math.min(230, draft));
      setMaxHr(next);
    } else {
      const lo = adjusting === 0 ? 80 : bounds[adjusting - 1] + 1;
      const hi = adjusting === 3 ? maxHr - 1 : bounds[adjusting + 1] - 1;
      const next = [...bounds];
      next[adjusting] = Math.max(lo, Math.min(hi, draft));
      setBounds(next);
    }
    setDirty(true);
    setAdjusting(null);
  }

  function save() {
    haptic("success");
    saveSettings({ ...loadSettings(), hrZoneBounds: bounds, maxHrOverride: maxHr });
    setDirty(false);
    router.push("/settings");
  }

  function reset() {
    haptic("light");
    const age = birthYear ? new Date().getFullYear() - birthYear : 35;
    const max = estimateMaxHr(age);
    setMaxHr(max);
    setBounds(defaultsFor(max));
    saveSettings({ ...loadSettings(), hrZoneBounds: null, maxHrOverride: null });
    setDirty(false);
  }

  function saveBirthYear(v: string) {
    const year = parseInt(v, 10);
    const valid = Number.isFinite(year) && year > 1920 && year <= new Date().getFullYear() - 5;
    setBirthYear(valid ? year : null);
    saveSettings({ ...loadSettings(), birthYear: valid ? year : null });
    const s = loadSettings();
    if (!s.hrZoneBounds && !s.maxHrOverride && valid) {
      const max = estimateMaxHr(new Date().getFullYear() - year);
      setMaxHr(max);
      setBounds(defaultsFor(max));
    }
  }

  return (
    <main className="min-h-dvh bg-bg pb-12">
      <div
        className="flex items-center justify-between px-4 pb-2"
        style={{ paddingTop: "max(env(safe-area-inset-top), 16px)" }}
      >
        <button type="button" aria-label="Back" onClick={() => router.push("/settings")} className="press p-1">
          <ArrowLeft className="h-6 w-6 text-text-1" strokeWidth={2} />
        </button>
        <p className="text-[17px] font-bold text-text-1">Customise HR Zones</p>
        <button
          type="button"
          disabled={!dirty}
          onClick={save}
          className="press text-[15px] font-bold text-accent disabled:opacity-40"
        >
          Save
        </button>
      </div>

      <div className="px-4">
        <p className="mt-2 text-[14px] leading-relaxed text-text-2">
          Heart rate zones indicate how much training load a run puts on your
          body. By default they're estimated from your age — adjust any
          boundary to match what you know from testing or your watch.
        </p>

        <div className="mt-4 k-card p-4">
          {ZONES.map((z, i) => {
            const isMax = i === 4;
            const bpm = isMax ? maxHr : bounds[i];
            const pct = isMax ? null : Math.round((bounds[i] / maxHr) * 100);
            return (
              <div key={z.name}>
                <div className="flex gap-3 py-2">
                  <span className="mt-0.5 h-9 w-1 shrink-0 rounded-full" style={{ backgroundColor: z.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-text-1">{z.name}</p>
                    <p className="mt-0.5 text-[13px] leading-snug text-text-3">{z.desc}</p>
                  </div>
                </div>
                <div className="mb-1 flex items-center justify-end gap-3 border-b border-hairline pb-2">
                  <span className="text-[13px] font-semibold text-text-3">{isMax ? "Max" : `${pct}%`}</span>
                  <button
                    type="button"
                    onClick={() => openAdjust(i === 4 ? 4 : i)}
                    className="press rounded-full bg-elevated px-3.5 py-1.5 text-[15px] font-bold tabular-nums text-text-1"
                  >
                    {bpm} bpm
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <button
          type="button"
          onClick={reset}
          className="press mt-5 w-full text-center text-[15px] font-bold text-text-1"
        >
          Reset Heart Rate Zones
        </button>

        <div className="mt-6 flex items-center justify-between k-card p-4">
          <div>
            <p className="text-[14px] font-semibold text-text-1">Birth year</p>
            <p className="text-[12px] text-text-3">Seeds the age-based defaults</p>
          </div>
          <input
            type="number"
            inputMode="numeric"
            defaultValue={birthYear ?? ""}
            placeholder="1990"
            onBlur={(e) => saveBirthYear(e.target.value)}
            className="w-24 rounded-[var(--radius-input)] bg-elevated px-3 py-2 text-center text-[15px] font-bold text-text-1 outline-none"
          />
        </div>
      </div>

      <Sheet
        open={adjusting != null}
        onClose={() => setAdjusting(null)}
        title={adjusting === 4 ? "Adjust Max HR" : `Adjust Zone ${(adjusting ?? 0) + 1}`}
      >
        <div className="flex flex-col gap-5 px-4 pb-6">
          <div className="flex items-center justify-center gap-5">
            <button
              type="button"
              aria-label="Lower"
              onClick={() => { haptic("light"); setDraft((v) => v - 1); }}
              className="press flex h-11 w-11 items-center justify-center rounded-full bg-elevated"
            >
              <Minus className="h-5 w-5 text-text-1" strokeWidth={2.2} />
            </button>
            <span className="min-w-[120px] text-center text-[34px] font-extrabold tabular-nums text-text-1">
              {draft} <span className="text-[15px] font-semibold text-text-3">bpm</span>
            </span>
            <button
              type="button"
              aria-label="Higher"
              onClick={() => { haptic("light"); setDraft((v) => v + 1); }}
              className="press flex h-11 w-11 items-center justify-center rounded-full bg-elevated"
            >
              <Plus className="h-5 w-5 text-text-1" strokeWidth={2.2} />
            </button>
          </div>
          <div className="flex justify-center gap-2">
            {[-5, +5].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => { haptic("light"); setDraft((v) => v + d); }}
                className="press rounded-full bg-elevated px-4 py-1.5 text-[13px] font-bold text-text-2"
              >
                {d > 0 ? `+${d}` : d}
              </button>
            ))}
          </div>
          <Button full onClick={applyDraft}>Done</Button>
        </div>
      </Sheet>
    </main>
  );
}
