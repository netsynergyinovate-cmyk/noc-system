"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getOnuStatusMeta, type OnuStatus } from "@/lib/dashboard/onu-status";

export function OnuStatusBadge({ status, className }: { status: OnuStatus | string; className?: string }) {
  const meta = getOnuStatusMeta(status);
  return (
    <Badge
      variant="outline"
      title={meta.description}
      data-testid="onu-status-badge"
      data-status={status}
      className={cn(meta.badgeClass, className)}
    >
      <span
        aria-hidden="true"
        className={cn("mr-1.5 inline-block size-2", status === "los" ? "rounded-sm" : "rounded-full", meta.dotClass)}
      />
      {meta.label}
    </Badge>
  );
}
