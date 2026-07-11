"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { NavBar } from "@/components/ui/NavBar";
import { BottomNav } from "@/components/BottomNav";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/Switch";
import { Segmented } from "@/components/ui/Segmented";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/feedback";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { AlertCircle, Plus } from "lucide-react";

// ── Integration connection rows ─────────────────────────────────────────────

function StravaConnection() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/integrations/strava/status")
      .then((r) => r.json())
      .then((d) => setStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setStatus("disconnected"));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/strava/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect Strava");
      setStatus("disconnected");
    } catch {
      setError("Couldn't disconnect Strava. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  async function handleSyncNow() {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const res = await apiFetch("/api/strava/backfill", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      const data = (await res.json().catch(() => null)) as { processed?: number } | null;
      haptic("success");
      const n = data?.processed ?? 0;
      setSyncResult(n === 0 ? "Up to date — no new activities." : `Synced ${n} new ${n === 1 ? "activity" : "activities"}.`);
    } catch {
      haptic("warning");
      setError("Sync failed. Try again later.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#FC4C02]">
            <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-text-1">Strava</p>
            <p className="truncate text-[13px] text-text-3">
              {status === "loading" ? "Checking…" : status === "connected" ? "Connected" : "Auto-sync your activities"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent">
            Connected
          </span>
        ) : status === "disconnected" ? (
          <a
            href="/api/auth/strava"
            onClick={() => haptic("medium")}
            className="press shrink-0 rounded-full bg-[#FC4C02] px-4 py-2 text-[13px] font-semibold text-white"
          >
            Connect
          </a>
        ) : null}
      </div>

      {status === "connected" && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" busy={syncing} onClick={handleSyncNow}>
            Sync now
          </Button>
          <Button variant="danger" size="sm" busy={disconnecting} onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      )}

      {syncResult && !error && (
        <p className="mt-2 text-[12px] text-text-3">{syncResult}</p>
      )}
      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          {error}
        </p>
      )}
    </div>
  );
}

function GCalConnection() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected">("loading");
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/integrations/gcal/status")
      .then((r) => r.json())
      .then((d) => setStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setStatus("disconnected"));
  }, []);

  async function handleDisconnect() {
    setDisconnecting(true);
    setError(null);
    try {
      const res = await apiFetch("/api/gcal/disconnect", { method: "POST" });
      if (!res.ok) throw new Error("Failed to disconnect Google Calendar");
      setStatus("disconnected");
    } catch {
      setError("Couldn't disconnect Google Calendar. Try again.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500">
            <svg className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-text-1">Google Calendar</p>
            <p className="truncate text-[13px] text-text-3">
              {status === "loading" ? "Checking…" : status === "connected" ? "Connected" : "Sync workouts to your calendar"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent">
            Connected
          </span>
        ) : status === "disconnected" ? (
          <a
            href="/api/auth/google"
            onClick={() => haptic("medium")}
            className="press shrink-0 rounded-full bg-blue-500 px-4 py-2 text-[13px] font-semibold text-white"
          >
            Connect
          </a>
        ) : null}
      </div>

      {status === "connected" && (
        <div className="mt-3">
          <Button variant="danger" size="sm" busy={disconnecting} onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      )}

      {error && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-danger">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} />
          {error}
        </p>
      )}
    </div>
  );
}

// ── Main Settings Page ──────────────────────────────────────────────────────

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    // Deferred to after hydration on purpose (localStorage isn't available
    // during SSR, and reading it in render would cause a hydration mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      <main className="min-h-dvh bg-bg">
        <NavBar title="Me" large />
        <div className="flex flex-col gap-3 px-4 pb-tabbar">
          <Skeleton className="h-40" />
          <Skeleton className="h-24" />
          <Skeleton className="h-32" />
        </div>
        <BottomNav />
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-bg">
      <NavBar title="Me" large />

      <div className="px-4 pb-tabbar">
        {/* Appearance */}
        <ListGroup header="Appearance">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[15px] font-medium text-text-1">Theme</span>
            <Segmented
              className="w-40"
              options={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
              ]}
              value={settings.theme}
              onChange={(v) => {
                update({ theme: v });
                if (v === "light") document.documentElement.classList.add("light");
                else document.documentElement.classList.remove("light");
              }}
            />
          </div>
        </ListGroup>

        {/* Pace Targets */}
        <ListGroup header="Pace Targets">
          <Row
            title="Pace targets"
            subtitle="Show target pace ranges on all workouts"
            accessory={
              <Switch
                checked={settings.paceTargets}
                onChange={(v) => update({ paceTargets: v })}
                aria-label="Pace targets"
              />
            }
          />
          <Row
            title="Pace targets on easy runs"
            subtitle="Show pace guidance on easy and recovery runs"
            accessory={
              <Switch
                checked={settings.paceTargetsEasyRuns}
                onChange={(v) => update({ paceTargetsEasyRuns: v })}
                aria-label="Pace targets on easy runs"
              />
            }
          />
        </ListGroup>

        {/* Units of Measure */}
        <ListGroup header="Units of Measure" footer="Affects plan generation and all displays.">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[15px] font-medium text-text-1">Distance &amp; pace</span>
            <Segmented
              className="w-40"
              options={[
                { value: "km", label: "km" },
                { value: "miles", label: "mi" },
              ]}
              value={settings.units}
              onChange={(v) => update({ units: v })}
            />
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[15px] font-medium text-text-1">Temperature</span>
            <Segmented
              className="w-40"
              options={[
                { value: "celsius", label: "°C" },
                { value: "fahrenheit", label: "°F" },
              ]}
              value={settings.tempUnit}
              onChange={(v) => update({ tempUnit: v })}
            />
          </div>
        </ListGroup>

        {/* Workout Targets */}
        <ListGroup header="Workout Targets">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-[15px] font-medium text-text-1">Target metric</span>
            <Segmented
              className="w-40"
              options={[
                { value: "pace", label: "Pace" },
                { value: "rpe", label: "RPE" },
              ]}
              value={settings.workoutTargetMode}
              onChange={(v) => update({ workoutTargetMode: v })}
            />
          </div>
          {settings.workoutTargetMode === "rpe" && (
            <Row
              title="What is RPE?"
              subtitle="Rate of Perceived Exertion explained"
              chevron
              onClick={() => router.push("/settings/rpe")}
            />
          )}
        </ListGroup>

        {/* Kraft — strength sessions */}
        <ListGroup header="Kraft — Strength Sessions" footer="Customize the guided workout player.">
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
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[15px] font-medium text-text-1">Rest length</span>
              <Segmented
                className="w-52"
                options={[
                  { value: "60", label: "60s" },
                  { value: "75", label: "75s" },
                  { value: "90", label: "90s" },
                  { value: "120", label: "120s" },
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
          <Row
            title='"Get ready" lead-in'
            subtitle="5-second countdown after skipping rest before the set timer starts"
            accessory={
              <Switch
                checked={settings.kraftGetReady}
                onChange={(v) => update({ kraftGetReady: v })}
                aria-label="Get ready lead-in"
              />
            }
          />
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
          {settings.kraftAudio && (
            <Row
              title="Spoken cues"
              subtitle="Announce exercises and counts out loud"
              accessory={
                <Switch
                  checked={settings.kraftVoice}
                  onChange={(v) => update({ kraftVoice: v })}
                  aria-label="Spoken cues"
                />
              }
            />
          )}
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

        {/* Guided run */}
        <ListGroup header="Guided Run" footer="Live coaching while you run the workout step by step.">
          <Row
            title="GPS tracking"
            subtitle="Live distance, pace, and split cues (needs location permission)"
            accessory={
              <Switch
                checked={settings.runGps}
                onChange={(v) => update({ runGps: v })}
                aria-label="GPS tracking"
              />
            }
          />
          {settings.runGps && (
            <Row
              title="Split announcements"
              subtitle={`Call out each completed ${settings.units === "miles" ? "mile" : "km"} and its time`}
              accessory={
                <Switch
                  checked={settings.runSplitCues}
                  onChange={(v) => update({ runSplitCues: v })}
                  aria-label="Split announcements"
                />
              }
            />
          )}
          <Row
            title="Audio cues"
            subtitle="Beeps for step changes and rest countdowns"
            accessory={
              <Switch
                checked={settings.runAudio}
                onChange={(v) => update({ runAudio: v })}
                aria-label="Guided run audio cues"
              />
            }
          />
          {settings.runAudio && (
            <Row
              title="Spoken cues"
              subtitle="Announce each step and its target out loud"
              accessory={
                <Switch
                  checked={settings.runVoice}
                  onChange={(v) => update({ runVoice: v })}
                  aria-label="Guided run spoken cues"
                />
              }
            />
          )}
          <Row
            title="Keep screen awake"
            subtitle="Stop the screen sleeping during a run"
            accessory={
              <Switch
                checked={settings.runKeepAwake}
                onChange={(v) => update({ runKeepAwake: v })}
                aria-label="Keep screen awake during run"
              />
            }
          />
        </ListGroup>

        {/* Integrations */}
        <ListGroup header="Integrations">
          <StravaConnection />
          <div className="border-t border-hairline/60" />
          <GCalConnection />
        </ListGroup>

        {/* Plan management */}
        <ListGroup header="Plan">
          <Row
            icon={<Plus className="h-4 w-4 text-text-2" strokeWidth={1.9} />}
            title="Create new plan"
            subtitle="Start a fresh training plan"
            chevron
            onClick={() => router.push("/create")}
          />
        </ListGroup>

        {/* App info */}
        <p className="mb-4 text-center text-[12px] text-text-3">Kadenz · Version 1.0</p>
      </div>

      <BottomNav />
    </main>
  );
}
