"use client";

import { Download, Dumbbell, Activity } from "lucide-react";
import { SettingsSubpage } from "@/components/ui/SettingsSubpage";
import { haptic } from "@/lib/haptics";

// Plain browser downloads (same-origin GET, cookie auth carries over
// automatically) rather than a fetch+blob dance — the export routes stream,
// so there's nothing to buffer client-side either.
function ExportRow({
  href,
  title,
  description,
  icon: Icon,
}: {
  href: string;
  title: string;
  description: string;
  icon: typeof Download;
}) {
  return (
    <a
      href={href}
      download
      onClick={() => haptic("light")}
      className="press flex w-full items-center gap-3 rounded-[var(--radius-card)] bg-surface px-4 py-3.5 text-left"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated">
        <Icon className="h-[18px] w-[18px] text-text-2" strokeWidth={1.9} />
      </span>
      <span className="flex-1">
        <span className="block text-[15px] font-semibold text-text-1">{title}</span>
        <span className="block text-[12px] text-text-3">{description}</span>
      </span>
      <Download className="h-4 w-4 shrink-0 text-text-3" strokeWidth={2} />
    </a>
  );
}

export default function ExportDataSettingsPage() {
  return (
    <SettingsSubpage title="Export data">
      <p className="mb-4 px-1 text-[13px] leading-relaxed text-text-3">
        Your training history as CSV, readable without this app. Distances in
        km, durations in seconds, dates in ISO 8601.
      </p>
      <div className="flex flex-col gap-2.5">
        <ExportRow
          href="/api/export/activities"
          title="Activities"
          description="Every run: date, type, distance, duration, pace, heart rate, elevation"
          icon={Activity}
        />
        <ExportRow
          href="/api/export/strength-sets"
          title="Strength sets"
          description="Every logged set: date, exercise, weight, reps, RPE, feel"
          icon={Dumbbell}
        />
      </div>
    </SettingsSubpage>
  );
}
