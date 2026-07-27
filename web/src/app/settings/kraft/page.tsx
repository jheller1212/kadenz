"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/8bit-switch";
import { Segmented } from "@/components/ui/Segmented";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { apiFetch } from "@/lib/api";

// Persist the rest-length preference to the strength plan (server) so it drives
// the plan's prescriptions, not just the guided-session countdown. Reconciles
// the schedule; a no-op if there's no active plan.
function patchPlanRest(restSeconds: number) {
  apiFetch("/api/strength/plan-settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restSeconds }),
  }).catch(() => {});
}

const VOLUME_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "loud", label: "Loud" },
];

export default function KraftSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    const s = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(s);
    // Reconcile the plan's rest with the local preference on open — if they've
    // drifted (e.g. the preference predates this wiring), push local → server.
    apiFetch("/api/strength/plan-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((ps) => {
        if (ps && ps.restSeconds !== s.kraftRestSeconds) patchPlanRest(s.kraftRestSeconds);
      })
      .catch(() => {});
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
            <div className="border-t border-hairline/60 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[15px] font-medium text-text-1">Volume</span>
                <Segmented
                  className="w-60"
                  options={VOLUME_OPTIONS}
                  value={settings.cueVolume}
                  onChange={(v) => update({ cueVolume: v as UserSettings["cueVolume"] })}
                />
              </div>
              <p className="mt-1 text-[12px] text-text-3">Applies to strength and guided-run cues</p>
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
                  onChange={(v) => {
                    const n = parseInt(v);
                    update({ kraftRestSeconds: n });
                    // Also the rest your plan prescribes, not just the timer.
                    patchPlanRest(n);
                  }}
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

          <ListGroup header="Warm-up">
            <Row
              title="Suggest warm-up sets"
              subtitle="Pre-fill a warm-up ramp before your heavy lifts. Turn off if you warm up another way — you can still mark a set as a warm-up by hand"
              accessory={
                <Switch
                  checked={settings.kraftWarmupSuggestions}
                  onChange={(v) => update({ kraftWarmupSuggestions: v })}
                  aria-label="Suggest warm-up sets"
                />
              }
            />
          </ListGroup>
        </>
      )}
    </SettingsSubpage>
  );
}
