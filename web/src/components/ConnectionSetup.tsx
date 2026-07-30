"use client";

import { Check, Watch, Calendar, HeartPulse, PenLine } from "lucide-react";
import { haptic } from "@/lib/haptics";
import type { ConnectionId } from "@/lib/device-setup";

// ── Connection setup ─────────────────────────────────────────────────────────
// The step that asks what the athlete actually has, instead of assuming a watch.
//
// Controlled on purpose: the create wizard drives its own pinned CTA and owns
// the PUT, so this file owns only the option list and the copy. That keeps the
// "has the athlete answered?" question in one place (the caller, from
// GET /api/user/device-setup) rather than being decided twice.

function StravaGlyph() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
    </svg>
  );
}

/**
 * Why Apple Health is a dead row and not a toggle: HealthKit has no web API, so
 * there is nothing a web app can connect to. A toggle that saved a preference we
 * can never honour would be a straight lie, and a disabled toggle still reads as
 * "coming, tap me". A plain row with a reason is the honest shape.
 */
export const APPLE_HEALTH_REASON =
  "Apple Health has no web connection, it needs the phone app.";

export function AppleHealthRow({ layout = "card" }: { layout?: "card" | "list" }) {
  const list = layout === "list";
  return (
    <div
      data-testid="connection-unavailable-apple-health"
      className={
        list
          ? "flex items-center justify-between gap-3 px-4 py-4"
          : "flex items-start gap-3 rounded-[var(--radius-card)] border border-hairline bg-elevated/50 p-4"
      }
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          className={`flex shrink-0 items-center justify-center rounded-full bg-bg text-text-3 ${
            list ? "h-9 w-9 rounded-lg" : "h-10 w-10"
          }`}
        >
          <HeartPulse className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className={`${list ? "text-[15px] font-medium" : "text-[15px] font-bold"} text-text-3`}>
            Apple Health
          </p>
          <p className={`${list ? "text-[13px]" : "mt-0.5 text-[12.5px] leading-relaxed"} text-text-3`}>
            {APPLE_HEALTH_REASON}
          </p>
        </div>
      </div>
      <span className="shrink-0 self-start rounded-full bg-elevated px-2.5 py-1 text-[12px] font-semibold text-text-3">
        Not yet
      </span>
    </div>
  );
}

function OptionRow({
  testId,
  label,
  sub,
  glyph,
  selected,
  onToggle,
}: {
  testId: string;
  label: string;
  sub: string;
  glyph: React.ReactNode;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      data-testid={testId}
      onClick={() => {
        haptic("light");
        onToggle();
      }}
      className={`press flex w-full items-start gap-3 rounded-[var(--radius-card)] border p-4 text-left ${
        selected ? "border-accent bg-accent/10" : "border-hairline bg-elevated"
      }`}
    >
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          selected ? "bg-accent text-on-accent" : "bg-bg text-text-2"
        }`}
      >
        {glyph}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`block text-[15px] font-bold ${selected ? "text-accent-fg" : "text-text-1"}`}>
          {label}
        </span>
        <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-2">{sub}</span>
      </span>
      {selected && (
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent">
          <Check className="h-3 w-3 text-on-accent" strokeWidth={3} />
        </span>
      )}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-xs font-semibold uppercase tracking-widest text-text-3">
      {children}
    </span>
  );
}

export function ConnectionSetup({
  selected,
  onChange,
  garminOffered,
  onSkip,
}: {
  selected: ConnectionId[];
  onChange: (next: ConnectionId[]) => void;
  /**
   * Decided by the server, never guessed here: Garmin is one physical watch on
   * installation-level worker credentials, so only the owner can ever be shown
   * it. See /api/user/device-setup.
   */
  garminOffered: boolean;
  /** Submits an empty selection. Carries the same weight as connecting. */
  onSkip?: () => void;
}) {
  function toggle(id: ConnectionId) {
    onChange(selected.includes(id) ? selected.filter((c) => c !== id) : [...selected, id]);
  }

  return (
    <div className="flex flex-col gap-6" data-testid="connection-setup">
      <div className="flex flex-col gap-2.5">
        <SectionLabel>Bring your runs in</SectionLabel>
        <OptionRow
          testId="connection-option-strava"
          label="Strava"
          sub="Your runs import automatically, with pace, heart rate and the route."
          glyph={<StravaGlyph />}
          selected={selected.includes("strava")}
          onToggle={() => toggle("strava")}
        />
        {garminOffered && (
          <OptionRow
            testId="connection-option-garmin"
            label="Garmin"
            sub="Workouts get sent to your watch, and sleep, resting heart rate and HRV come back and feed your readiness score."
            glyph={<Watch className="h-4.5 w-4.5" strokeWidth={2} />}
            selected={selected.includes("garmin")}
            onToggle={() => toggle("garmin")}
          />
        )}
        <AppleHealthRow />
      </div>

      {/* Own section so nobody reads a push target as an import. */}
      <div className="flex flex-col gap-2.5">
        <SectionLabel>Send your sessions out</SectionLabel>
        <OptionRow
          testId="connection-option-gcal"
          label="Google Calendar"
          sub="Your sessions appear in your calendar. Nothing comes back in."
          glyph={<Calendar className="h-4.5 w-4.5" strokeWidth={2} />}
          selected={selected.includes("gcal")}
          onToggle={() => toggle("gcal")}
        />
      </div>

      {onSkip && (
        <div className="flex flex-col gap-2.5">
          <SectionLabel>Or record by hand</SectionLabel>
          <button
            type="button"
            data-testid="connection-skip"
            onClick={() => {
              haptic("medium");
              onSkip();
            }}
            className="press flex w-full items-start gap-3 rounded-[var(--radius-card)] border border-hairline bg-elevated p-4 text-left"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bg text-text-2">
              <PenLine className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold text-text-1">
                I&apos;ll record by hand
              </span>
              <span className="mt-0.5 block text-[12.5px] leading-relaxed text-text-2">
                You log runs from the Activities tab, and readiness comes from your daily
                check-in.
              </span>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
