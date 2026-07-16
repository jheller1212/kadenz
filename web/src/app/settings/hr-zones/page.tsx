"use client";

import { useEffect, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { haptic } from "@/lib/haptics";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { estimateMaxHr, getHrZones } from "@/lib/plan-engine/hr-zones";

const DEFAULT_AGE = 35;
const DEFAULT_RESTING_HR = 60;

const ZONE_META = [
  { key: "z1", name: "Zone 1", label: "Recovery", color: "#9CA3AF", desc: "Very easy — warm-ups, cool-downs, and recovery." },
  { key: "z2", name: "Zone 2", label: "Aerobic", color: "#3B82F6", desc: "Comfortable base pace that builds endurance." },
  { key: "z3", name: "Zone 3", label: "Tempo", color: "#22C55E", desc: "Steady, comfortably hard sustained efforts." },
  { key: "z4", name: "Zone 4", label: "Threshold", color: "#F97316", desc: "Hard efforts right at your lactate threshold." },
  { key: "z5", name: "Zone 5", label: "Anaerobic", color: "#EF4444", desc: "Maximal intervals and sprint finishes." },
] as const;

function EditSheet({
  open,
  onClose,
  settings,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  settings: UserSettings;
  onSave: (patch: Partial<UserSettings>) => void;
}) {
  const [birthYear, setBirthYear] = useState("");
  const [maxHr, setMaxHr] = useState("");

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync fields on open
    setBirthYear(settings.birthYear ? String(settings.birthYear) : "");
    setMaxHr(settings.maxHrOverride ? String(settings.maxHrOverride) : "");
  }, [open, settings]);

  function save() {
    const yearNum = parseInt(birthYear, 10);
    const maxNum = parseInt(maxHr, 10);
    const currentYear = new Date().getFullYear();
    onSave({
      birthYear:
        Number.isFinite(yearNum) && yearNum > 1900 && yearNum <= currentYear ? yearNum : null,
      maxHrOverride: Number.isFinite(maxNum) && maxNum >= 100 && maxNum <= 230 ? maxNum : null,
    });
    haptic("success");
    onClose();
  }

  const inputClass =
    "w-full rounded-xl bg-elevated px-4 py-3 text-[15px] text-text-1 placeholder:text-text-3 outline-none focus:ring-2 focus:ring-accent";

  return (
    <Sheet open={open} onClose={onClose} title="Heart Rate Zones">
      <div className="flex flex-col gap-4 pb-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-text-2">Birth year</span>
          <input
            type="number"
            inputMode="numeric"
            value={birthYear}
            onChange={(e) => setBirthYear(e.target.value)}
            placeholder="e.g. 1990"
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-text-2">Max HR (optional override)</span>
          <input
            type="number"
            inputMode="numeric"
            value={maxHr}
            onChange={(e) => setMaxHr(e.target.value)}
            placeholder={`Estimated: ${estimateMaxHr(DEFAULT_AGE)} bpm`}
            className={inputClass}
          />
        </label>
        <p className="text-[12px] leading-snug text-text-3">
          Leave Max HR empty to estimate it from your age (Tanaka: 208 − 0.7 × age).
        </p>
        <Button onClick={save}>Save</Button>
      </div>
    </Sheet>
  );
}

export default function HrZonesSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(loadSettings());
  }, []);

  function update(patch: Partial<UserSettings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
  }

  const age = settings?.birthYear
    ? new Date().getFullYear() - settings.birthYear
    : DEFAULT_AGE;
  const maxHr = settings?.maxHrOverride ?? estimateMaxHr(age);
  const zones = getHrZones(DEFAULT_RESTING_HR, age, maxHr);

  return (
    <SettingsSubpage
      title="Heart Rate Zones"
      right={
        <button
          type="button"
          onClick={() => {
            haptic("light");
            setEditOpen(true);
          }}
          className="press px-2 text-[16px] font-semibold text-accent"
        >
          Edit
        </button>
      }
    >
      <p className="mb-4 px-1 text-[14px] leading-relaxed text-text-2">
        Your zones are based on your age
        {settings?.maxHrOverride
          ? ` and a max heart rate of ${maxHr} bpm`
          : ` (estimated max heart rate ${maxHr} bpm)`}
        . {settings?.birthYear ? "" : "Tap Edit to add your birth year for accurate zones. "}
        Training in the right zone keeps easy days easy and hard days effective.
      </p>

      {settings && (
        <div className="overflow-hidden k-card">
          {ZONE_META.map(({ key, name, label, color, desc }, i) => {
            const zone = zones[key];
            return (
              <div
                key={key}
                className={`flex items-center gap-3 px-4 py-3.5 ${i > 0 ? "border-t border-hairline/60" : ""}`}
              >
                <span
                  aria-hidden
                  className="h-9 w-1 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-text-1">
                    {name} <span className="font-medium text-text-2">· {label}</span>
                  </span>
                  <span className="block truncate text-[13px] text-text-3">{desc}</span>
                </span>
                <span className="shrink-0 text-[15px] font-semibold tabular-nums text-text-1">
                  {key === "z5" ? `Max ${maxHr}` : `< ${zone.max}`}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="mt-2 px-4 text-[12px] leading-snug text-text-3">
        Upper bounds in bpm, computed with the Karvonen (heart-rate reserve) method.
      </p>

      {settings && (
        <EditSheet
          open={editOpen}
          onClose={() => setEditOpen(false)}
          settings={settings}
          onSave={update}
        />
      )}
    </SettingsSubpage>
  );
}
