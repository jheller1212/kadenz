"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/8bit-switch";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";

const COUNTDOWN_OPTS = [0, 3, 5, 10];

export default function RecordingSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(loadSettings());
  }, []);

  // Speech-synthesis voices load asynchronously on some platforms.
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const load = () => {
      const all = window.speechSynthesis.getVoices();
      const en = all.filter((v) => v.lang?.toLowerCase().startsWith("en"));
      setVoices(en.length > 0 ? en : all);
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
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
            {settings.runAudio && settings.runVoice && voices.length > 0 && (
              <Row
                title="Voice"
                subtitle="Which voice reads your cues"
                accessory={
                  <select
                    value={settings.runVoiceName ?? ""}
                    onChange={(e) => update({ runVoiceName: e.target.value || null })}
                    aria-label="Voice"
                    className="max-w-[150px] truncate rounded-lg bg-elevated px-2 py-1.5 text-[13px] font-semibold text-text-1"
                  >
                    <option value="">Default</option>
                    {voices.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                }
              />
            )}
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
            <div className={settings.runGps ? "" : "pointer-events-none opacity-40"}>
              <Row
                title="Pace alerts"
                subtitle="Call out when you drift outside the target pace range"
                accessory={
                  <Switch
                    checked={settings.runPaceAlerts}
                    onChange={(v) => update({ runPaceAlerts: v })}
                    aria-label="Pace alerts"
                  />
                }
              />
            </div>
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
            <div className={settings.runGps ? "" : "pointer-events-none opacity-40"}>
              <Row
                title="Auto-pause"
                subtitle="Pause the clock when you stop, resume when you move again"
                accessory={
                  <Switch
                    checked={settings.runAutoPause}
                    onChange={(v) => update({ runAutoPause: v })}
                    aria-label="Auto-pause"
                  />
                }
              />
            </div>
            <div className={settings.runGps ? "" : "pointer-events-none opacity-40"}>
              <Row
                title="Pause warning"
                subtitle="Remind me (voice) if I'm paused and start moving again"
                accessory={
                  <Switch
                    checked={settings.runPauseWarning}
                    onChange={(v) => update({ runPauseWarning: v })}
                    aria-label="Pause warning"
                  />
                }
              />
            </div>
          </ListGroup>

          <ListGroup header="Starting">
            <Row
              title="Countdown"
              subtitle="Count in before the clock starts"
              accessory={
                <div className="flex gap-1" role="group" aria-label="Countdown length">
                  {COUNTDOWN_OPTS.map((s) => {
                    const active = settings.runCountdownSeconds === s;
                    return (
                      <button
                        key={s}
                        onClick={() => update({ runCountdownSeconds: s })}
                        className={`press h-8 min-w-[34px] rounded-lg px-2 text-[13px] font-semibold ${
                          active ? "bg-accent text-on-accent" : "bg-elevated text-text-2"
                        }`}
                      >
                        {s === 0 ? "Off" : `${s}s`}
                      </button>
                    );
                  })}
                </div>
              }
            />
            <div className={settings.runGps ? "" : "pointer-events-none opacity-40"}>
              <Row
                title="Start on motion"
                subtitle="Begin automatically when you start moving instead of tapping Start"
                accessory={
                  <Switch
                    checked={settings.runStartOnMotion}
                    onChange={(v) => update({ runStartOnMotion: v })}
                    aria-label="Start on motion"
                  />
                }
              />
            </div>
          </ListGroup>
        </>
      )}
    </SettingsSubpage>
  );
}
