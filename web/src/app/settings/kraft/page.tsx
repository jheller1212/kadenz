"use client";

import { useEffect, useState } from "react";
import { ListGroup, Row } from "@/components/ui/List";
import { Switch } from "@/components/ui/8bit-switch";
import { Segmented } from "@/components/ui/Segmented";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { loadSettings, saveSettings, type UserSettings } from "@/lib/settings";
import { apiFetch } from "@/lib/api";
import { TransitionLink } from "@/components/ui/TransitionLink";
import {
  COMPLAINT_LABELS,
  STRENGTH_COMPLAINTS,
  type Complaint,
} from "@/lib/strength/types";
import { complaintWorkSlugs } from "@/lib/strength/complaint-work";
import { EXERCISE_BY_SLUG } from "@/lib/strength/program";

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

// ── Complaints ────────────────────────────────────────────────────────────────
//
// Complaints shape every session an athlete gets: "achilles" adds the explosive
// and HSR calf block to their upper/lower/full body work, and each other
// complaint adds one targeted exercise (see lib/strength/program.ts
// TARGETED_WORK). Until now they were collected once, in the setup wizard, and
// never shown again, so an athlete whose injury had healed had no way to stop
// the work it added. This is where they change.
//
// A change takes effect on every session still to come: the plan is rebuilt
// from its template on each read, so nothing needs regenerating. Sessions the
// athlete has already started keep what they were built with, and nothing
// logged is ever removed (see schema.ts strengthSessions.complaints).

/** The exercises a complaint adds, named, so the athlete can see what a
 *  toggle actually does to their sessions rather than guessing. */
function complaintWorkNames(complaint: Complaint): string {
  const names = complaintWorkSlugs(complaint)
    .map((slug) => EXERCISE_BY_SLUG[slug]?.name)
    .filter((n): n is string => !!n);
  // Variants of the same slot (a box step-down or the wall sit fallback) both
  // appear; the athlete gets one of them, so show the first and stop.
  return names[0] ?? "";
}

const ACHILLES_WORK = complaintWorkSlugs("achilles")
  .map((slug) => EXERCISE_BY_SLUG[slug]?.name)
  .filter((n): n is string => !!n);

const VOLUME_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "loud", label: "Loud" },
];

export default function KraftSettingsPage() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  // Complaints live on the server (strength_plan_settings), not in the local
  // settings blob: they shape the plan the scheduler, calendar and watch all
  // build from, so the server has to be the copy that decides.
  const [complaints, setComplaints] = useState<Complaint[] | null>(null);
  const [hasPlan, setHasPlan] = useState<boolean | null>(null);
  const [confirmStopAchilles, setConfirmStopAchilles] = useState(false);
  const [complaintError, setComplaintError] = useState<string | null>(null);

  useEffect(() => {
    const s = loadSettings();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only
    setSettings(s);
    // Reconcile the plan's rest with the local preference on open — if they've
    // drifted (e.g. the preference predates this wiring), push local → server.
    apiFetch("/api/strength/plan-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((ps) => {
        setHasPlan(!!ps);
        const known = new Set<string>(STRENGTH_COMPLAINTS);
        setComplaints(
          ((ps?.complaints ?? []) as string[]).filter((c): c is Complaint => known.has(c))
        );
        if (ps && ps.restSeconds !== s.kraftRestSeconds) patchPlanRest(s.kraftRestSeconds);
      })
      .catch(() => setHasPlan(false));
  }, []);

  // Optimistic: the switch moves at once and rolls back if the save fails, so
  // the screen never shows a setting the plan is not actually built from.
  async function saveComplaints(next: Complaint[]) {
    const previous = complaints ?? [];
    setComplaints(next);
    setComplaintError(null);
    try {
      const res = await apiFetch("/api/strength/plan-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ complaints: next }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch {
      setComplaints(previous);
      setComplaintError("Could not save that. Check your connection and try again.");
    }
  }

  function toggleComplaint(c: Complaint, on: boolean) {
    const current = complaints ?? [];
    // Stopping the Achilles work ends a graded rehab protocol part-way, so it
    // asks first. Every other complaint adds one exercise and toggles freely.
    if (!on && c === "achilles") {
      setConfirmStopAchilles(true);
      return;
    }
    saveComplaints(on ? [...current, c] : current.filter((x) => x !== c));
  }

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

          <ListGroup
            header="Complaints"
            footer={
              hasPlan === false
                ? undefined
                : "Your next sessions follow this. Sessions you have already started keep the exercises they began with, and nothing you have logged is removed."
            }
          >
            {hasPlan === false ? (
              <TransitionLink href="/strength/setup">
                <Row
                  title="Set up Kraft first"
                  subtitle="Complaints are part of setup, and shape the exercises you get"
                  chevron
                />
              </TransitionLink>
            ) : (
              <>
                {STRENGTH_COMPLAINTS.map((c) => {
                  const on = (complaints ?? []).includes(c);
                  return (
                    <Row
                      key={c}
                      title={COMPLAINT_LABELS[c]}
                      subtitle={
                        c === "achilles"
                          ? `Adds ${ACHILLES_WORK.length} exercises: ${ACHILLES_WORK.join(", ")}`
                          : `Adds ${complaintWorkNames(c)} to lower and full body days`
                      }
                      accessory={
                        <Switch
                          checked={on}
                          onChange={(v) => toggleComplaint(c, v)}
                          aria-label={COMPLAINT_LABELS[c]}
                        />
                      }
                    />
                  );
                })}
                {complaintError && (
                  <div className="border-t border-hairline/60 px-4 py-3 text-[13px] font-medium text-danger">
                    {complaintError}
                  </div>
                )}
              </>
            )}
          </ListGroup>

          <ListGroup header="Warm-up">
            <Row
              title="Suggest warm-up sets"
              subtitle="Pre-fill a warm-up ramp before your heavy lifts. Turn off if you warm up another way, you can still mark a set as a warm-up by hand"
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

      {/* Stopping Achilles work ends a graded protocol, so it says what stops
          and what happens on re-report before the athlete commits. Accurate,
          not a warning: healed tendons are the point of the programme. */}
      <Sheet
        open={confirmStopAchilles}
        onClose={() => setConfirmStopAchilles(false)}
        title="Stop the Achilles work?"
      >
        <div className="flex flex-col gap-4 px-4 pb-6">
          <p className="text-[14px] leading-relaxed text-text-2">
            Your next sessions drop {ACHILLES_WORK.join(", ")}. The calf raises follow a
            week by week loading protocol, so stopping ends it part-way.
          </p>
          <p className="text-[14px] leading-relaxed text-text-2">
            Everything you have logged stays, including your pain scores and calf raise
            history. If you report Achilles pain again later, the calf protocol starts
            again at week 1 rather than picking up where you left off.
          </p>
          <Button
            variant="primary"
            size="lg"
            full
            onClick={() => {
              setConfirmStopAchilles(false);
              saveComplaints((complaints ?? []).filter((x) => x !== "achilles"));
            }}
          >
            Stop Achilles work
          </Button>
          <Button variant="secondary" size="lg" full onClick={() => setConfirmStopAchilles(false)}>
            Keep it
          </Button>
        </div>
      </Sheet>
    </SettingsSubpage>
  );
}
