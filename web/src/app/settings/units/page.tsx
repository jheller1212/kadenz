"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { ListGroup } from "@/components/ui/List";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { SettingsSubpage, RadioRow } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

export default function UnitsSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);

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

  return (
    <SettingsSubpage title="Units of Measure">
      {settings && (
        <>
          <ListGroup header="Plan Display Unit" footer="Used for distances and paces everywhere in the app: Today, plan, activities, stats and insights. Plan setup inputs stay in kilometres.">
            <RadioRow
              title="Kilometres"
              selected={settings.units === "km"}
              onSelect={() => update({ units: "km" })}
            />
            <RadioRow
              title="Miles"
              selected={settings.units === "miles"}
              onSelect={() => update({ units: "miles" })}
            />
          </ListGroup>

          <section className="mb-6">
            <div className="mb-2 flex items-center gap-1.5 px-4">
              <h3 className="text-[13px] font-semibold uppercase tracking-wide text-text-3">
                Workout Targets
              </h3>
              <TransitionLink href="/settings/rpe" aria-label="What is RPE?" className="press -m-1 p-1">
                <Info className="h-4 w-4 text-text-3" strokeWidth={2} />
              </TransitionLink>
            </div>
            <div className="overflow-hidden k-card">
              <RadioRow
                title="Running Pace"
                selected={settings.workoutTargetMode === "pace"}
                onSelect={() => update({ workoutTargetMode: "pace" })}
              />
              <RadioRow
                title="RPE"
                subtitle="Rate of Perceived Exertion"
                selected={settings.workoutTargetMode === "rpe"}
                onSelect={() => update({ workoutTargetMode: "rpe" })}
              />
            </div>
          </section>

          <ListGroup header="Weight Tracking">
            <RadioRow
              title="Kilograms"
              selected={settings.weightUnit === "kg"}
              onSelect={() => update({ weightUnit: "kg" })}
            />
            <RadioRow
              title="Pounds"
              selected={settings.weightUnit === "lbs"}
              onSelect={() => update({ weightUnit: "lbs" })}
            />
          </ListGroup>

          <ListGroup header="Temperature">
            <RadioRow
              title="Celsius"
              selected={settings.tempUnit === "celsius"}
              onSelect={() => update({ tempUnit: "celsius" })}
            />
            <RadioRow
              title="Fahrenheit"
              selected={settings.tempUnit === "fahrenheit"}
              onSelect={() => update({ tempUnit: "fahrenheit" })}
            />
          </ListGroup>
        </>
      )}
    </SettingsSubpage>
  );
}
