"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ListGroup, Row } from "@/components/ui/List";
import { RadioRow, SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { Switch } from "@/components/ui/8bit-switch";
import { apiFetch } from "@/lib/api";
import { haptic } from "@/lib/haptics";
import { loadSettings, saveSettings } from "@/lib/settings";
import { subscribeToPush, unsubscribeFromPush, pushSupported } from "@/lib/reminders/subscribe-client";

const LEAD_OPTIONS = [15, 30, 60, 120] as const;

interface ReminderConfig {
  enabled: boolean;
  leadMinutes: number;
  defaultTimeOfDay: string;
}

/**
 * Reminders need the Notifications permission first — this page doesn't ask
 * for it itself (that's the primer's job, see /settings/permissions), it
 * just explains the dependency and links there.
 */
export default function RemindersSettingsPage() {
  const router = useRouter();
  const [permission, setPermission] = useState<"unset" | "allowed" | "declined" | null>(null);
  const [config, setConfig] = useState<ReminderConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setPermission(loadSettings().notificationsPermission);
    apiFetch("/api/reminders/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((d: ReminderConfig) => setConfig(d))
      .catch(() => setError("Couldn't load reminder settings."));
  }, []);

  async function persist(next: ReminderConfig) {
    const prev = config;
    setConfig(next); // optimistic
    setSaving(true);
    setError(null);
    try {
      const res = await apiFetch("/api/reminders/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) throw new Error("save failed");
      saveSettings({
        ...loadSettings(),
        remindersEnabled: next.enabled,
        reminderLeadMinutes: next.leadMinutes,
        reminderDefaultTime: next.defaultTimeOfDay,
      });
    } catch {
      setConfig(prev); // roll back
      setError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(enabled: boolean) {
    if (!config || saving) return;
    if (enabled && pushSupported()) {
      const subscribed = await subscribeToPush();
      if (!subscribed) {
        setError("Couldn't set up push on this device. Try again.");
        return;
      }
    }
    if (!enabled) void unsubscribeFromPush();
    await persist({ ...config, enabled });
  }

  const notificationsAllowed = permission === "allowed";

  return (
    <SettingsSubpage title="Reminders">
      {!notificationsAllowed && permission !== null && (
        <ListGroup footer="Reminders need notifications on first.">
          <Row
            title="Turn on notifications"
            subtitle="Required before reminders can fire"
            chevron
            onClick={() => router.push("/settings/permissions")}
          />
        </ListGroup>
      )}

      {notificationsAllowed && config && (
        <>
          <ListGroup footer="Sent as a push notification for today's workout once it's within the lead time below. Completed and skipped sessions never get one.">
            <div className="flex items-center justify-between gap-3 px-4 py-3.5">
              <p className="text-[15px] font-medium text-text-1">Workout reminders</p>
              <Switch
                checked={config.enabled}
                onChange={(v) => void handleToggle(v)}
                aria-label="Workout reminders"
              />
            </div>
          </ListGroup>

          {config.enabled && (
            <div className="mt-6">
              <h3 className="mb-2 px-4 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                Remind me before
              </h3>
              <ListGroup>
                {LEAD_OPTIONS.map((minutes) => (
                  <RadioRow
                    key={minutes}
                    title={minutes < 60 ? `${minutes} minutes` : `${minutes / 60} hour${minutes > 60 ? "s" : ""}`}
                    selected={config.leadMinutes === minutes}
                    onSelect={() => {
                      haptic("light");
                      void persist({ ...config, leadMinutes: minutes });
                    }}
                  />
                ))}
              </ListGroup>

              <h3 className="mb-2 mt-6 px-4 text-[11px] font-semibold uppercase tracking-wider text-text-3">
                Default time
              </h3>
              <ListGroup footer="Used for workouts with no specific time of day set.">
                <div className="flex items-center justify-between gap-3 px-4 py-3.5">
                  <p className="text-[15px] font-medium text-text-1">Time</p>
                  <input
                    type="time"
                    value={config.defaultTimeOfDay}
                    onChange={(e) => void persist({ ...config, defaultTimeOfDay: e.target.value })}
                    className="rounded-[var(--radius-input)] bg-elevated px-3 py-2 text-[15px] font-semibold tabular-nums text-text-1 outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              </ListGroup>
            </div>
          )}
        </>
      )}

      {error && <p className="mt-3 px-4 text-[13px] text-danger">{error}</p>}
    </SettingsSubpage>
  );
}
