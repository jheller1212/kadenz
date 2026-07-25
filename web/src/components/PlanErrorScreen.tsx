"use client";

import { motion } from "motion/react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useOnline } from "@/lib/useOnline";

/**
 * Failure counterpart to PlanBuildingLoader. The handoff calls for the calm
 * error pattern rather than leaving a bar spinning: say what happened, offer
 * the way back, and never lose the answers the athlete just gave (the wizard
 * is still mounted underneath, so Try again re-submits the same config).
 */
export function PlanErrorScreen({
  message,
  onRetry,
  onBack,
}: {
  message?: string | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  const online = useOnline();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24 }}
      className="k-dark-surface fixed inset-0 z-[60] flex flex-col items-center justify-center px-8"
      style={{ background: "var(--k-bg-grad)" }}
      role="alert"
    >
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-elevated text-text-3">
        {online ? <AlertTriangle size={24} /> : <WifiOff size={24} />}
      </div>

      <h1 className="w-full text-center text-[24px] font-extrabold leading-tight tracking-tight text-text-1">
        {online ? "Couldn't build your plan" : "You're offline"}
      </h1>

      <p className="mt-3 w-full max-w-[300px] text-center text-[14px] leading-relaxed text-text-3">
        {online
          ? (message ??
            "Something went wrong while generating it. Your answers are saved, so you can try again.")
          : "Check your connection and try again. Your answers are saved."}
      </p>

      <div className="mt-9 w-full max-w-[320px]">
        <Button full size="lg" onClick={onRetry}>
          Try again
        </Button>
        <div className="mt-3">
          <Button full size="lg" variant="secondary" onClick={onBack}>
            Back to setup
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
