"use client";

import { useEffect, useState } from "react";
import { ListGroup } from "@/components/ui/List";
import { SettingsSubpage, RadioRow } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

export default function HapticsSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(loadSettings());
  }, []);

  function setEnabled(hapticsEnabled: boolean) {
    if (!settings) return;
    const updated = { ...settings, hapticsEnabled };
    setSettings(updated);
    saveSettings(updated);
  }

  return (
    <SettingsSubpage title="Haptics">
      {settings && (
        <ListGroup footer="Vibration feedback for taps, toggles, and timers. Haptics depend on your device and may not fire on every interaction.">
          <RadioRow
            title="On"
            selected={settings.hapticsEnabled}
            onSelect={() => setEnabled(true)}
          />
          <RadioRow
            title="Off"
            selected={!settings.hapticsEnabled}
            onSelect={() => setEnabled(false)}
          />
        </ListGroup>
      )}
    </SettingsSubpage>
  );
}
