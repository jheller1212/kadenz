"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/8bit-switch";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

export default function RecordingSettingsPage() {
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
    <SettingsSubpage title="Recording">
      {settings && (
        <>
          <ListGroup header="Audio Cues">
            <Row
              title="Audio cues"
              subtitle="Beeps for step changes and rest countdowns"
              accessory={
                <Switch
                  checked={settings.runAudio}
                  onChange={(v) => update({ runAudio: v })}
                  aria-label="Audio cues"
                />
              }
            />
            <div className={settings.runAudio ? "" : "pointer-events-none opacity-40"}>
              <Row
                title="Voice cues"
                subtitle="Announce each step and its target out loud"
                accessory={
                  <Switch
                    checked={settings.runVoice}
                    onChange={(v) => update({ runVoice: v })}
                    aria-label="Voice cues"
                  />
                }
              />
            </div>
            <Row
              title="Run splits"
              subtitle={`Call out each completed ${settings.units === "miles" ? "mile" : "km"} and its time`}
              accessory={
                <Switch
                  checked={settings.runSplitCues}
                  onChange={(v) => update({ runSplitCues: v })}
                  aria-label="Run splits"
                />
              }
            />
          </ListGroup>

          <ListGroup header="Tracking">
            <Row
              title="GPS tracking"
              subtitle="Live distance, pace, and splits (needs location permission)"
              accessory={
                <Switch
                  checked={settings.runGps}
                  onChange={(v) => update({ runGps: v })}
                  aria-label="GPS tracking"
                />
              }
            />
            <Row
              title="Keep screen awake"
              subtitle="Stop the screen sleeping during a run"
              accessory={
                <Switch
                  checked={settings.runKeepAwake}
                  onChange={(v) => update({ runKeepAwake: v })}
                  aria-label="Keep screen awake"
                />
              }
            />
          </ListGroup>
        </>
      )}
    </SettingsSubpage>
  );
}
