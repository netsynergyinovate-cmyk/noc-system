"use client";

import {
  ALERT_CATEGORY_MAP,
  type AlertCategoryKey,
} from "@/lib/dashboard/alert-categories";
import { cn } from "cn";

interface AlertCategoryBadgeProps {
  category: Exclude<AlertCategoryKey, "all"> | string;
  size?: "sm" | "md";
  short?: boolean;
  className?: string;
}

export function AlertCategoryBadge({
  category,
  size = "md",
  short = false,
  className,
}: AlertCategoryBadgeProps) {
  const meta =
    ALERT_CATEGORY_MAP[category as Exclude<AlertCategoryKey, "all">] ??
    ALERT_CATEGORY_MAP.other;
  const Icon = meta.Icon;

  return (
    <span
      data-testid="alert-category-badge"
      data-category={meta.key}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border font-mono font-medium tracking-tight uppercase",
        meta.badgeClass,
        size === "sm"
          ? "px-1.5 py-0.2 text-[9.5px] leading-tight"
          : "px-2 py-0.5 text-[10.5px]",
        className,
      )}
    >
      <Icon
        className={cn("shrink-0", size === "sm" ? "size-2.5" : "size-3")}
        aria-hidden="true"
      />
      <span>{short ? meta.shortLabel : meta.label}</span>
    </span>
  );
}
