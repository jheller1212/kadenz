"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { haptic } from "@/lib/haptics";

// iOS grouped inset list. Wrap Rows in a ListGroup; optional section header.
export function ListGroup({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      {header && (
        <h3 className="mb-2 px-4 text-[13px] font-semibold uppercase tracking-wide text-text-3">
          {header}
        </h3>
      )}
      <div className="overflow-hidden rounded-[var(--radius-card)] bg-surface">
        {children}
      </div>
      {footer && (
        <p className="mt-2 px-4 text-[12px] leading-snug text-text-3">{footer}</p>
      )}
    </section>
  );
}

interface RowProps {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned accessory (value text, Switch, badge…). */
  accessory?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
}

export function Row({
  icon,
  title,
  subtitle,
  accessory,
  onClick,
  chevron,
  danger,
}: RowProps) {
  const interactive = !!onClick;
  return (
    <button
      disabled={!interactive}
      onClick={() => {
        if (!interactive) return;
        haptic("light");
        onClick();
      }}
      style={{ touchAction: "manipulation" }}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left
        first:border-t-0 border-t border-hairline/60
        ${interactive ? "active:bg-elevated" : ""}`}
    >
      {icon && (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-elevated">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-[15px] font-medium ${
            danger ? "text-danger" : "text-text-1"
          }`}
        >
          {title}
        </span>
        {subtitle && (
          <span className="block truncate text-[13px] text-text-3">{subtitle}</span>
        )}
      </span>
      {accessory && <span className="shrink-0 text-[15px] text-text-2">{accessory}</span>}
      {chevron && <ChevronRight className="h-4 w-4 shrink-0 text-text-3" />}
    </button>
  );
}
