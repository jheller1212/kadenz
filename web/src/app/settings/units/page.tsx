"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";
import { ListGroup } from "@/components/ui/List";
import { TransitionLink } from "@/components/ui/TransitionLink";
import { SettingsSubpage, RadioRow } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

// Mirrors the two units the server also needs. localStorage stays the
// client's source of truth and is written first, so a radio button never
// waits on a round trip; this copy is what the cron reads when it builds the
// watch label, the calendar event and the push reminder, none of which can
// see localStorage. A failed mirror is logged and otherwise ignored: the
// worst case is one server-generated title in the other unit, which is
// exactly today's behaviour, so it is not worth blocking the screen over.
function mirrorUnitsToServer(settings: UserSettings) {
  void fetch("/api/user/units", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      distanceUnit: settings.units,
      weightUnit: settings.weightUnit,
    }),
  }).catch((err) => console.error("Failed to mirror units to server:", err));
}

export default function UnitsSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    const local = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(local);
    // Push the current preference up on open, not just on change. Every
    // athlete already has one stored locally from before the server column
    // existed, and without this they would keep getting km on the watch until
    // they happened to toggle something on this screen.
    mirrorUnitsToServer(local);
  }, []);

  function update(patch: Partial<UserSettings>) {
    if (!settings) return;
    const updated = { ...settings, ...patch };
    setSettings(updated);
    saveSettings(updated);
    if (patch.units !== undefined || patch.weightUnit !== undefined) {
      mirrorUnitsToServer(updated);
    }
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
