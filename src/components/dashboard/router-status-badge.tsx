import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import type { ConnectionStatus } from "@/lib/dashboard/device-config";
import { getRouterStatusBadgeModel } from "@/lib/dashboard/router-status";

export { getRouterStatusBadgeModel };

interface Props {
  active?: boolean;
  status?: ConnectionStatus;
  isTesting?: boolean;
  latencyMs?: number | null;
  showLatency?: boolean;
  label?: string;
  size?: "sm" | "default";
  className?: string;
}

const STYLE = {
  connected: {
    cls: "border-success/50 bg-success/10 text-success",
    Icon: CheckCircle2,
  },
  error: {
    cls: "border-destructive/50 bg-destructive/10 text-destructive",
    Icon: AlertCircle,
  },
  timeout: { cls: "border-warning/40 bg-warning/10 text-warning", Icon: Clock },
  testing: {
    cls: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    Icon: Loader2,
  },
  untested: { cls: "border-border text-muted-foreground", Icon: CircleDashed },
} as const;

export function RouterStatusBadge({
  size = "default",
  className,
  ...opts
}: Props) {
  const model = getRouterStatusBadgeModel(opts);
  const { cls, Icon } = STYLE[model.kind];
  return (
    <Badge
      variant="outline"
      role="status"
      aria-label={model.ariaLabel}
      aria-busy={model.busy ? "true" : undefined}
      data-testid="router-status-badge"
      data-status={model.kind}
      className={cn(
        "gap-1",
        size === "sm" && "px-1.5 text-[10px]",
        cls,
        className,
      )}
    >
      <Icon
        className={cn("size-3", model.busy && "animate-spin")}
        aria-hidden="true"
      />
      {model.label}
    </Badge>
  );
}
