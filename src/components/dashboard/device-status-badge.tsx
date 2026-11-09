import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Loader2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import {
  type ConnectionStatus,
  getStatusBadgeModel,
} from "@/lib/dashboard/device-config";

interface Props {
  status: ConnectionStatus;
  isTesting?: boolean;
  latencyMs?: number | null;
  showLatency?: boolean;
  className?: string;
}

const STYLE = {
  testing: {
    variant: "outline",
    cls: "border-blue-500/40 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    Icon: Loader2,
  },
  connected: {
    variant: "outline",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
    Icon: CheckCircle2,
  },
  error: { variant: "destructive", cls: "", Icon: AlertCircle },
  timeout: {
    variant: "outline",
    cls: "border-warning/40 bg-warning/10 text-warning",
    Icon: Clock,
  },
  untested: {
    variant: "outline",
    cls: "text-muted-foreground",
    Icon: CircleDashed,
  },
} as const;

export function DeviceStatusBadge({
  status,
  isTesting = false,
  latencyMs = null,
  showLatency = true,
  className,
}: Props) {
  const m = getStatusBadgeModel(status, isTesting, latencyMs, showLatency);
  const { variant, cls, Icon } = STYLE[m.kind];
  return (
    <Badge
      role="status"
      aria-label={m.ariaLabel}
      aria-busy={m.busy ? "true" : undefined}
      data-testid="device-status"
      data-status={m.kind}
      variant={variant}
      className={cn("gap-1", cls, className)}
    >
      <Icon
        className={m.busy ? "animate-spin" : undefined}
        aria-hidden="true"
      />
      {m.label}
    </Badge>
  );
}
