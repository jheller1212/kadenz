"use client";

import type { ReactNode } from "react";
import { AlertTriangle, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useOnline } from "@/lib/useOnline";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Loading"
      data-testid="spinner"
    />
  );
}

// Shimmering placeholder block for loading states.
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`animate-shimmer rounded-[var(--radius-input)] bg-elevated ${className}`}
      aria-hidden="true"
    />
  );
}

/**
 * The counterpart to EmptyState, for when a screen failed rather than has
 * nothing to show. Keeping them distinct matters: a failed fetch rendered as
 * an empty state tells the athlete their plan is gone, which is a lie.
 */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center animate-fade-in">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-elevated text-text-3">
        {offline ? <WifiOff size={22} /> : <AlertTriangle size={22} />}
      </div>
      <h2 className="text-[17px] font-bold text-text-1">
        {offline ? "You're offline" : title}
      </h2>
      <p className="mt-1.5 max-w-[280px] text-[14px] leading-relaxed text-text-3">
        {offline
          ? "Check your connection and try again. Anything you logged is saved and will sync."
          : (message ?? "That didn't load. It's usually temporary.")}
      </p>
      {onRetry && (
        <div className="mt-6">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Slim, non-blocking notice that the device is offline. Sits under the header
 * rather than over the content: going offline shouldn't hide the plan the
 * athlete already has on screen.
 */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-elevated px-4 py-2 text-[12px] font-semibold text-text-2 animate-fade-in"
    >
      <WifiOff size={13} />
      Offline, showing your last synced data
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-8 py-16 text-center animate-fade-in">
      {icon && <div className="mb-4 text-text-3">{icon}</div>}
      <h2 className="text-[17px] font-bold text-text-1">{title}</h2>
      {message && (
        <p className="mt-1.5 max-w-[280px] text-[14px] leading-relaxed text-text-3">
          {message}
        </p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
