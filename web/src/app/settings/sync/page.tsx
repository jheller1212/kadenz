"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { apiFetch } from "@/lib/api";

interface Counts { pending: number; processing: number; failed: number; completed: number }
interface Failure {
  target: string;
  action: string;
  entityType: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}
interface Health {
  byTarget: Record<string, Counts>;
  lastProcessedAt: string | null;
  oldestPendingMinutes: number | null;
  failures: Failure[];
}

const TARGET_LABEL: Record<string, string> = { gcal: "Google Calendar", garmin: "Garmin" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function StatusPill({ tone, children }: { tone: "ok" | "warn" | "off"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-accent/10 text-accent"
      : tone === "warn"
      ? "bg-danger/10 text-danger"
      : "bg-elevated text-text-3";
  return <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${cls}`}>{children}</span>;
}

export default function SyncSettingsPage() {
  const [garmin, setGarmin] = useState<{ configured: boolean; authenticated: boolean } | null | "error">(null);
  const [gcal, setGcal] = useState<boolean | null | "error">(null);
  const [strava, setStrava] = useState<boolean | null | "error">(null);
  const [health, setHealth] = useState<Health | null | "error">(null);

  useEffect(() => {
    let alive = true;
    const j = (r: Response) => (r.ok ? r.json() : Promise.reject(new Error("status")));
    apiFetch("/api/garmin/status").then(j).then((d) => alive && setGarmin(d)).catch(() => alive && setGarmin("error"));
    apiFetch("/api/integrations/gcal/status").then(j).then((d) => alive && setGcal(Boolean(d.connected))).catch(() => alive && setGcal("error"));
    apiFetch("/api/integrations/strava/status").then(j).then((d) => alive && setStrava(Boolean(d.connected))).catch(() => alive && setStrava("error"));
    apiFetch("/api/sync/health").then(j).then((d) => alive && setHealth(d)).catch(() => alive && setHealth("error"));
    return () => { alive = false; };
  }, []);

  const garminPill =
    garmin === "error" ? <StatusPill tone="warn">Couldn&apos;t check</StatusPill>
    : garmin === null ? <StatusPill tone="off">…</StatusPill>
    : !garmin.configured ? <StatusPill tone="off">Not set up</StatusPill>
    : garmin.authenticated ? <StatusPill tone="ok">Connected</StatusPill>
    : <StatusPill tone="warn">Reconnect</StatusPill>;

  const boolPill = (v: boolean | null | "error") =>
    v === "error" ? <StatusPill tone="warn">Couldn&apos;t check</StatusPill>
    : v === null ? <StatusPill tone="off">…</StatusPill>
    : v ? <StatusPill tone="ok">Connected</StatusPill>
    : <StatusPill tone="off">Not connected</StatusPill>;

  const targets = health && health !== "error" ? Object.keys(health.byTarget) : [];

  return (
    <SettingsSubpage title="Sync">
      <ListGroup header="Integrations">
        <Row title="Garmin" subtitle="Workouts sent to your watch" accessory={garminPill} />
        <Row title="Google Calendar" subtitle="Sessions on your calendar" accessory={boolPill(gcal)} />
        <Row title="Strava" subtitle="Activities imported automatically" accessory={boolPill(strava)} />
      </ListGroup>

      {health === "error" ? (
        <ListGroup header="Queue">
          <Row title="Couldn't load sync status" subtitle="Try again in a moment" />
        </ListGroup>
      ) : health ? (
        <>
          <ListGroup header="Queue">
            <Row
              title="Last synced"
              accessory={<span className="text-[14px] text-text-2">{ago(health.lastProcessedAt)}</span>}
            />
            {targets.length === 0 ? (
              <Row title="Nothing queued" subtitle="Everything is up to date" />
            ) : (
              targets.map((t) => {
                const c = health.byTarget[t];
                const waiting = c.pending + c.processing;
                const tone = c.failed > 0 ? "warn" : waiting > 0 ? "off" : "ok";
                const text =
                  c.failed > 0 ? `${c.failed} failed`
                  : waiting > 0 ? `${waiting} waiting`
                  : "Up to date";
                return (
                  <Row
                    key={t}
                    title={TARGET_LABEL[t] ?? t}
                    subtitle={
                      health.oldestPendingMinutes != null && waiting > 0
                        ? `Oldest waiting ${health.oldestPendingMinutes} min`
                        : undefined
                    }
                    accessory={<StatusPill tone={tone}>{text}</StatusPill>}
                  />
                );
              })
            )}
          </ListGroup>

          {health.failures.length > 0 && (
            <ListGroup header="Recent errors">
              {health.failures.map((f, i) => (
                <Row
                  key={i}
                  title={`${TARGET_LABEL[f.target] ?? f.target} · ${f.entityType.replace("_", " ")} ${f.action}`}
                  subtitle={f.lastError ? f.lastError.slice(0, 120) : `Failed after ${f.attempts} attempts`}
                />
              ))}
            </ListGroup>
          )}
        </>
      ) : (
        <ListGroup header="Queue">
          <Row title="Loading…" />
        </ListGroup>
      )}
    </SettingsSubpage>
  );
}
