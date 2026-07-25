"use client";

import { motion } from "motion/react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { haptic } from "@/lib/haptics";

/**
 * Asks before the OS asks.
 *
 * A browser permission prompt can only be shown once: a decline is effectively
 * permanent, and the OS dialog gives no room to say why the app wants it. This
 * sheet makes the case first, so the real prompt is only ever triggered by
 * someone who already said yes. "Not now" leaves the permission untouched and
 * askable later.
 */
export function PermissionPrimer({
  icon: Icon,
  title,
  body,
  allowLabel = "Allow",
  onAllow,
  onDismiss,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  allowLabel?: string;
  onAllow: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-[80] flex items-end justify-center"
      style={{ background: "var(--k-scrim, rgba(0,0,0,.5))" }}
      onClick={onDismiss}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ duration: 0.34, ease: [0.32, 0.72, 0, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[430px] rounded-t-[var(--radius-sheet,24px)] bg-surface px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-7 [box-shadow:var(--k-ring-hairline),var(--k-shadow-card)]"
      >
        <div className="flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent text-on-accent">
            <Icon size={24} strokeWidth={2.2} />
          </span>
          <h2 className="mt-5 w-full text-[20px] font-extrabold tracking-tight text-text-1">
            {title}
          </h2>
          <p className="mt-2 w-full text-[14px] leading-relaxed text-text-3">{body}</p>
        </div>

        <div className="mt-7">
          <Button
            full
            size="lg"
            onClick={() => {
              haptic("medium");
              onAllow();
            }}
          >
            {allowLabel}
          </Button>
          <div className="mt-2">
            <Button full size="lg" variant="ghost" onClick={onDismiss}>
              Not now
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
