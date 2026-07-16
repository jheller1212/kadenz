"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/8bit-switch";
import { Segmented } from "@/components/ui/Segmented";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

export default function KraftSettingsPage() {
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
    <SettingsSubpage title="Kraft">
      {settings && (
        <>
          <ListGroup header="Audio Cues">
            <Row
              title="Audio cues"
              subtitle="Beeps for the last 5 seconds of rest & get-ready"
              accessory={
                <Switch
                  checked={settings.kraftAudio}
                  onChange={(v) => update({ kraftAudio: v })}
                  aria-label="Audio cues"
                />
              }
            />
            <div className={settings.kraftAudio ? "" : "pointer-events-none opacity-40"}>
              <Row
                title="Voice cues"
                subtitle="Announce exercises and counts out loud"
                accessory={
                  <Switch
                    checked={settings.kraftVoice}
                    onChange={(v) => update({ kraftVoice: v })}
                    aria-label="Voice cues"
                  />
                }
              />
            </div>
            <Row
              title='"Get ready" countdown'
              subtitle="5-second lead-in before the set timer starts"
              accessory={
                <Switch
                  checked={settings.kraftGetReady}
                  onChange={(v) => update({ kraftGetReady: v })}
                  aria-label="Get ready countdown"
                />
              }
            />
          </ListGroup>

          <ListGroup header="Timers">
            <Row
              title="Rest timer"
              subtitle="Auto-start a countdown after each set"
              accessory={
                <Switch
                  checked={settings.kraftRestTimer}
                  onChange={(v) => update({ kraftRestTimer: v })}
                  aria-label="Rest timer"
                />
              }
            />
            {settings.kraftRestTimer && (
              <div className="flex items-center justify-between gap-3 border-t border-hairline/60 px-4 py-3">
                <span className="text-[15px] font-medium text-text-1">Default rest</span>
                <Segmented
                  className="w-44"
                  options={[
                    { value: "30", label: "30s" },
                    { value: "60", label: "60s" },
                    { value: "90", label: "90s" },
                  ]}
                  value={String(settings.kraftRestSeconds)}
                  onChange={(v) => update({ kraftRestSeconds: parseInt(v) })}
                />
              </div>
            )}
            <Row
              title="Set timer"
              subtitle="Show a live timer while you perform a set"
              accessory={
                <Switch
                  checked={settings.kraftSetTimer}
                  onChange={(v) => update({ kraftSetTimer: v })}
                  aria-label="Set timer"
                />
              }
            />
          </ListGroup>

          <ListGroup header="Screen">
            <Row
              title="Keep screen awake"
              subtitle="Stop the screen sleeping during a session"
              accessory={
                <Switch
                  checked={settings.kraftKeepAwake}
                  onChange={(v) => update({ kraftKeepAwake: v })}
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
