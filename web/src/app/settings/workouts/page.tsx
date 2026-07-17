"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/8bit-switch";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

export default function WorkoutSettingsPage() {
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
    <SettingsSubpage title="Workouts">
      {settings && (
        <ListGroup footer="Turning pace targets off on easy runs helps you run by feel and keep recovery days genuinely easy.">
          <Row
            title="Pace Targets"
            accessory={
              <Switch
                checked={settings.paceTargets}
                onChange={(v) => update({ paceTargets: v })}
                aria-label="Pace targets"
              />
            }
          />
          <Row
            title="Pace Targets on Easy Run"
            accessory={
              <Switch
                checked={settings.paceTargetsEasyRuns}
                onChange={(v) => update({ paceTargetsEasyRuns: v })}
                aria-label="Pace targets on easy runs"
              />
            }
          />
          <Row
            title="Pace Targets on Long Run"
            accessory={
              <Switch
                checked={settings.paceTargetsLongRuns}
                onChange={(v) => update({ paceTargetsLongRuns: v })}
                aria-label="Pace targets on long runs"
              />
            }
          />
        </ListGroup>
      )}
    </SettingsSubpage>
  );
}
