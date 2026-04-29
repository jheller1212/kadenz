"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BottomNav } from "@/components/BottomNav";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

// ── Toggle component ────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-sm font-semibold text-text-1">{label}</p>
        {description && <p className="text-xs text-text-3 mt-0.5">{description}</p>}
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
          checked ? "bg-accent" : "bg-elevated"
        }`}
      >
        <div
          className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
    </div>
  );
}

// ── Option selector ─────────────────────────────────────────────────────────

function OptionGroup<T extends string>({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  options: { value: T; label: string; sublabel?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="py-3">
      <p className="text-sm font-semibold text-text-1">{label}</p>
      {description && <p className="text-xs text-text-3 mt-0.5">{description}</p>}
      <div className="mt-3 flex flex-col gap-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-3 px-4 py-3 rounded-[var(--radius-input)] border transition-all text-left ${
              value === opt.value
                ? "border-accent bg-accent/10"
                : "border-hairline bg-elevated"
            }`}
          >
            <div
              className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                value === opt.value ? "border-accent" : "border-text-3"
              }`}
            >
              {value === opt.value && <div className="w-2.5 h-2.5 rounded-full bg-accent" />}
            </div>
            <div>
              <p className={`text-sm font-medium ${value === opt.value ? "text-accent" : "text-text-1"}`}>
                {opt.label}
              </p>
              {opt.sublabel && <p className="text-xs text-text-3">{opt.sublabel}</p>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Section divider ─────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="pt-5 pb-2">
      <p className="text-xs font-semibold text-text-3 uppercase tracking-widest">{title}</p>
    </div>
  );
}

// ── Main Settings Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    setSettings(loadSettings());
  }, []);

  function update(patch: Partial<UserSettings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
  }

  if (!settings) {
    return (
      <div className="min-h-screen bg-bg">
        <BottomNav active="today" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <main className="mx-auto flex w-full max-w-md flex-col px-4 pb-28 pt-10">
        {/* Header */}
        <header className="flex items-center gap-3 mb-6">
          <Link
            href="/"
            className="w-9 h-9 rounded-full bg-elevated border border-hairline flex items-center justify-center text-text-2"
            aria-label="Back"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-extrabold text-text-1">Settings</h1>
        </header>

        {/* Appearance */}
        <SectionHeader title="Appearance" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-4">
          <OptionGroup
            label="Theme"
            options={[
              { value: "light" as const, label: "Light", sublabel: "Clean white, Benchmark-inspired" },
              { value: "dark" as const, label: "Dark", sublabel: "Dark mode, easy on the eyes" },
            ]}
            value={settings.theme}
            onChange={(v) => {
              update({ theme: v });
              // Apply immediately
              if (v === "light") document.documentElement.classList.add("light");
              else document.documentElement.classList.remove("light");
            }}
          />
        </div>

        {/* Pace Targets */}
        <SectionHeader title="Pace Targets" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-4 divide-y divide-hairline">
          <Toggle
            checked={settings.paceTargets}
            onChange={(v) => update({ paceTargets: v })}
            label="Pace targets"
            description="Show target pace ranges on all workouts"
          />
          <Toggle
            checked={settings.paceTargetsEasyRuns}
            onChange={(v) => update({ paceTargetsEasyRuns: v })}
            label="Pace targets on easy runs"
            description="Show pace guidance on easy and recovery runs"
          />
        </div>

        {/* Units of Measure */}
        <SectionHeader title="Units of Measure" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-4 divide-y divide-hairline">
          <OptionGroup
            label="Distance & pace"
            description="Affects plan generation and all displays"
            options={[
              { value: "km" as const, label: "Kilometers", sublabel: "Pace in min/km" },
              { value: "miles" as const, label: "Miles", sublabel: "Pace in min/mi" },
            ]}
            value={settings.units}
            onChange={(v) => update({ units: v })}
          />
          <OptionGroup
            label="Temperature"
            options={[
              { value: "celsius" as const, label: "Celsius (°C)" },
              { value: "fahrenheit" as const, label: "Fahrenheit (°F)" },
            ]}
            value={settings.tempUnit}
            onChange={(v) => update({ tempUnit: v })}
          />
        </div>

        {/* Workout Targets */}
        <SectionHeader title="Workout Targets" />
        <div className="rounded-[var(--radius-card)] border border-hairline bg-surface px-4">
          <OptionGroup
            label="Target metric"
            description="How workout intensity is displayed"
            options={[
              { value: "pace" as const, label: "Running Pace", sublabel: "Target pace ranges per block" },
              { value: "rpe" as const, label: "RPE (Rate of Perceived Exertion)", sublabel: "Effort-based intensity scale" },
            ]}
            value={settings.workoutTargetMode}
            onChange={(v) => update({ workoutTargetMode: v })}
          />
          {settings.workoutTargetMode === "rpe" && (
            <div className="pb-3">
              <Link
                href="/settings/rpe"
                className="flex items-center gap-2 text-sm font-medium text-accent active:opacity-70 transition-opacity"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" />
                  <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
                </svg>
                What is RPE?
              </Link>
            </div>
          )}
        </div>

        {/* App info */}
        <div className="mt-8 text-center">
          <p className="text-xs text-text-3">Kadenz · Version 1.0</p>
        </div>
      </main>

      <BottomNav active="today" />
    </div>
  );
}
