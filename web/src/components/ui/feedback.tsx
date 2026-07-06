"use client";

import type { ReactNode } from "react";

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Loading"
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
