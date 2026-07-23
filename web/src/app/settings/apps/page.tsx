"use client";

import { useState, useEffect } from "react";
import { ListGroup } from "@/components/ui/List";
import { Button } from "@/components/ui/Button";
import { Switch } from "@/components/ui/8bit-switch";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import { loadSettings, saveSettings } from "@/lib/settings";
import { AlertCircle, Watch } from "lucide-react";

// ── Integration connection rows (moved from /settings) ──────────────────────

function StravaConnection() {
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/integrations/strava/status")
      // A transient non-ok must not read as "disconnected" (that implies the
      // user must reconnect); surface an honest "couldn't check" instead.
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((d) => setStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setStatus("error"));
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

  interface BackfillResult {
    inserted?: number;
    alreadySynced?: number;
    oldest?: string | null;
    remaining?: number;
    rateLimited?: boolean;
    done?: boolean;
  }

  async function runSync(opts?: { full?: boolean }) {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      let totalInserted = 0;
      let dup = 0;
      let oldestSeen: string | null = null;
      let rateLimited = false;
      // Full history imports in chunks (the server caps per-invocation work to
      // respect Strava's shared app quota) — loop until done.
      for (let pass = 0; pass < 25; pass++) {
        const res = await apiFetch("/api/strava/backfill", {
          method: "POST",
          ...(opts?.full
            ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ full: true }) }
            : {}),
        });
        if (!res.ok) throw new Error("Sync failed");
        const data = (await res.json().catch(() => null)) as BackfillResult | null;
        totalInserted += data?.inserted ?? 0;
        dup = data?.alreadySynced ?? dup;
        if (data?.oldest) oldestSeen = data.oldest;
        if (data?.rateLimited) {
          rateLimited = true;
          break;
        }
        if (!opts?.full || data?.done !== false) break;
        setSyncResult(`Importing history… ${totalInserted} so far (${data?.remaining ?? "?"} to go)`);
      }
      haptic("success");
      const oldest = oldestSeen
        ? ` · history back to ${new Date(oldestSeen).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
        : "";
      if (rateLimited) {
        setSyncResult(
          `Imported ${totalInserted} — Strava's rate limit reached. Run again in ~15 minutes to continue where it left off.`
        );
      } else {
        setSyncResult(
          totalInserted === 0
            ? `Up to date — no new activities${dup ? ` (${dup} already synced)` : ""}${oldest}.`
            : `Synced ${totalInserted} new ${totalInserted === 1 ? "activity" : "activities"}${dup ? ` · ${dup} already synced` : ""}${oldest}.`
        );
      }
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
              {status === "loading" ? "Checking…" : status === "connected" ? "Connected" : status === "error" ? "Couldn't reach the server" : "Auto-sync your activities"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent-fg">
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
        ) : status === "error" ? (
          <span className="shrink-0 rounded-full bg-elevated px-2.5 py-1 text-[12px] font-semibold text-text-3">
            Couldn&apos;t check
          </span>
        ) : null}
      </div>

      {status === "connected" && (
        <div className="mt-3 flex items-center gap-2">
          <Button variant="secondary" size="sm" busy={syncing} onClick={() => runSync()}>
            Sync now
          </Button>
          <Button variant="danger" size="sm" busy={disconnecting} onClick={handleDisconnect}>
            Disconnect
          </Button>
        </div>
      )}
      {status === "connected" && (
        <button
          type="button"
          disabled={syncing}
          onClick={() => runSync({ full: true })}
          className="press mt-2 text-left text-[13px] font-semibold text-accent-fg disabled:opacity-50"
        >
          Sync entire history
        </button>
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
  const [status, setStatus] = useState<"loading" | "connected" | "disconnected" | "error">("loading");
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/integrations/gcal/status")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("status"))))
      .then((d) => setStatus(d.connected ? "connected" : "disconnected"))
      .catch(() => setStatus("error"));
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
              {status === "loading" ? "Checking…" : status === "connected" ? "Connected" : status === "error" ? "Couldn't reach the server" : "Sync workouts to your calendar"}
            </p>
          </div>
        </div>

        {status === "connected" ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent-fg">
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
        ) : status === "error" ? (
          <span className="shrink-0 rounded-full bg-elevated px-2.5 py-1 text-[12px] font-semibold text-text-3">
            Couldn&apos;t check
          </span>
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

function GarminConnection() {
  const [status, setStatus] = useState<
    "loading" | "unconfigured" | "healthy" | "auth_dead" | "unreachable"
  >("loading");
  const [syncWorkouts, setSyncWorkouts] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/garmin/status")
      .then((r) => r.json())
      .then((d) => {
        if (!d.configured) {
          setStatus("unconfigured");
          return;
        }
        // Worker up but Garmin session dead → "reconnect", not a false green.
        setStatus(!d.healthy ? "unreachable" : d.authenticated ? "healthy" : "auth_dead");
        // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from server
        setSyncWorkouts(Boolean(d.syncWorkouts));
      })
      .catch(() => setStatus("unreachable"));
  }, []);

  async function handleToggle(value: boolean) {
    setSyncWorkouts(value); // optimistic
    setSaving(true);
    setError(null);
    // Local mirror for instant UI elsewhere.
    saveSettings({ ...loadSettings(), garminSyncWorkouts: value });
    try {
      const res = await apiFetch("/api/garmin/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syncWorkouts: value }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setSyncWorkouts(!value);
      saveSettings({ ...loadSettings(), garminSyncWorkouts: !value });
      setError("Couldn't save the setting. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportResult(null);
    setError(null);
    try {
      const res = await apiFetch("/api/garmin/import", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        if (data?.error === "garmin_auth") {
          setError("Reconnect Garmin on the worker.");
        } else {
          setError("Import failed. Try again later.");
        }
        haptic("warning");
        return;
      }
      haptic("success");
      const skipped = (data?.skippedDuplicates ?? 0) as number;
      setImportResult(
        `Imported ${data?.imported ?? 0}${skipped ? ` · skipped ${skipped} duplicates` : ""}`
      );
    } catch {
      haptic("warning");
      setError("Import failed. Try again later.");
    } finally {
      setImporting(false);
    }
  }

  const subtitle =
    status === "loading"
      ? "Checking…"
      : status === "unconfigured"
        ? "Garmin worker not deployed yet"
        : status === "healthy"
          ? "Connected"
          : status === "auth_dead"
            ? "Garmin session expired — reconnect on the worker"
            : "Worker unreachable";

  return (
    <div className="px-4 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#007CC3]">
            <Watch className="h-4 w-4 text-white" strokeWidth={2} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-medium text-text-1">Garmin</p>
            <p className="truncate text-[13px] text-text-3">{subtitle}</p>
          </div>
        </div>

        {status === "healthy" ? (
          <span className="shrink-0 rounded-full bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent-fg">
            Connected
          </span>
        ) : status === "auth_dead" ? (
          <span className="shrink-0 rounded-full bg-warn/10 px-2.5 py-1 text-[12px] font-semibold text-warn">
            Reconnect
          </span>
        ) : status === "unreachable" ? (
          <span className="shrink-0 rounded-full bg-danger/10 px-2.5 py-1 text-[12px] font-semibold text-danger">
            Offline
          </span>
        ) : null}
      </div>

      {status === "unconfigured" && (
        <p className="mt-2 text-[12px] text-text-3">
          Set GARMIN_WORKER_URL and GARMIN_WORKER_TOKEN to enable pushing workouts
          to the watch and importing watch activities.
        </p>
      )}

      {(status === "healthy" || status === "auth_dead" || status === "unreachable") && (
        <>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[14px] text-text-1">Send workouts to watch</p>
            <Switch
              checked={syncWorkouts}
              onChange={(v) => {
                if (!saving) void handleToggle(v);
              }}
              aria-label="Send workouts to watch"
            />
          </div>
          <p className="mt-1 text-[12px] text-text-3">
            Pushes upcoming runs (next 14 days) to your Garmin calendar and keeps
            them in step when the plan changes.
          </p>
          <div className="mt-3">
            <Button variant="secondary" size="sm" busy={importing} onClick={handleImport}>
              Import activities now
            </Button>
          </div>
        </>
      )}

      {importResult && !error && (
        <p className="mt-2 text-[12px] text-text-3">{importResult}</p>
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

export default function ConnectedAppsPage() {
  return (
    <SettingsSubpage title="Connected Apps">
      <ListGroup>
        <StravaConnection />
        <div className="border-t border-hairline/60" />
        <GCalConnection />
        <div className="border-t border-hairline/60" />
        <GarminConnection />
      </ListGroup>
    </SettingsSubpage>
  );
}
