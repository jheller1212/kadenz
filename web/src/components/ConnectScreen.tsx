"use client";

import { motion } from "motion/react";
import { Activity, CalendarDays, Dumbbell } from "lucide-react";
import { KadenzMark } from "@/components/ui/KadenzMark";

// Full-screen sign-in / onboarding shown when the app has no valid session.
// Connecting Strava mints the session cookie (see api/auth/strava/callback).
export function ConnectScreen() {
  return (
    <main className="min-h-dvh flex flex-col bg-bg px-6 safe-top">
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 22 }}
          className="mb-6 flex h-20 w-20 items-center justify-center rounded-[26%]"
          style={{ background: "var(--k-signature-grad)" }}
        >
          <KadenzMark className="h-11 w-11 text-[#0B0B0F]" />
        </motion.div>
        <h1 className="font-display text-[38px] uppercase tracking-[0.04em] text-text-1">Kadenz</h1>
        <p className="mt-2 max-w-[280px] text-[15px] leading-relaxed text-text-2">
          A running plan and a real strength programme, both built around the training you actually do.
        </p>

        <div className="mt-9 flex w-full max-w-[300px] flex-col gap-3 text-left">
          <Feature icon={<CalendarDays className="h-5 w-5" />} text="Weekly plans that adapt to your real runs" />
          <Feature icon={<Dumbbell className="h-5 w-5" />} text="Kraft strength, coupled to your running phase" />
          <Feature icon={<Activity className="h-5 w-5" />} text="Auto-synced from Strava, no manual logging" />
        </div>
      </div>

      <div className="pb-[max(env(safe-area-inset-bottom),24px)] pt-4">
        <motion.a
          href="/api/auth/strava"
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-[#FC4C02] text-[16px] font-bold text-white"
          style={{ touchAction: "manipulation" }}
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
          </svg>
          Continue with Strava
        </motion.a>
        <p className="mt-3 text-center text-[12px] leading-snug text-text-3">
          Signing in with Strava connects your activities and keeps you logged in on this device.
        </p>
      </div>
    </main>
  );
}

function Feature({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-accent-fg">
        {icon}
      </span>
      <span className="text-[14px] font-medium text-text-1">{text}</span>
    </div>
  );
}
