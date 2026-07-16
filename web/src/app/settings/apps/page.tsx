"use client";

import { useState, useEffect } from "react";
import { ListGroup } from "@/components/ui/List";
import { Button } from "@/components/ui/Button";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { haptic } from "@/lib/haptics";
import { apiFetch } from "@/lib/api";
import { AlertCircle } from "lucide-react";

// ── Integration connection rows (moved from /settings) ──────────────────────

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

  async function runSync(sinceMonths?: number) {
    setSyncing(true);
    setError(null);
    setSyncResult(null);
    try {
      const body = sinceMonths
        ? JSON.stringify({ since: new Date(Date.now() - sinceMonths * 30.4 * 24 * 3600_000).toISOString() })
        : undefined;
      const res = await apiFetch("/api/strava/backfill", {
        method: "POST",
        ...(body ? { headers: { "Content-Type": "application/json" }, body } : {}),
      });
      if (!res.ok) throw new Error("Sync failed");
      const data = (await res.json().catch(() => null)) as { inserted?: number; alreadySynced?: number } | null;
      haptic("success");
      const n = data?.inserted ?? 0;
      const dup = data?.alreadySynced ?? 0;
      setSyncResult(
        n === 0
          ? `Up to date — no new activities${dup ? ` (${dup} already synced)` : ""}.`
          : `Synced ${n} new ${n === 1 ? "activity" : "activities"}${dup ? ` · ${dup} already synced` : ""}.`
      );
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
          onClick={() => runSync(12)}
          className="press mt-2 text-left text-[13px] font-semibold text-accent disabled:opacity-50"
        >
          Sync full history (last 12 months)
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

export default function ConnectedAppsPage() {
  return (
    <SettingsSubpage title="Connected Apps">
      <ListGroup>
        <StravaConnection />
        <div className="border-t border-hairline/60" />
        <GCalConnection />
      </ListGroup>
    </SettingsSubpage>
  );
}
