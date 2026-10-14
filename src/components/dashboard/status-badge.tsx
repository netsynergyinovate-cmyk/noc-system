import {
  CircleCheck,
  CircleX,
  Info,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { cn } from "cn";
import { healthLabels } from "@/lib/dashboard/health";
import { incidentSeverityLabels } from "@/lib/dashboard/incidents";
import type {
  BillingStatus,
  CustomerHealth,
  IncidentSeverity,
} from "@/lib/dashboard/types";
import { BillingStatusBadge } from "./billing-status-badge";

const badgeBase =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap";

// Status selalu memakai ikon dan teks, bukan warna saja.
const healthStyles = {
  ok: { Icon: CircleCheck, className: "bg-success/10 text-success" },
  warning: { Icon: TriangleAlert, className: "bg-warning/10 text-warning" },
  critical: {
    Icon: CircleX,
    className: "bg-destructive/10 text-destructive",
  },
} as const;

export function HealthBadge({ health }: { health: CustomerHealth }) {
  const { Icon, className } = healthStyles[health];
  return (
    <span className={cn(badgeBase, className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {healthLabels[health]}
    </span>
  );
}

const severityStyles = {
  info: { Icon: Info, className: "bg-secondary text-foreground" },
  warning: { Icon: TriangleAlert, className: "bg-warning/10 text-warning" },
  critical: {
    Icon: OctagonAlert,
    className: "bg-destructive/10 text-destructive",
  },
} as const;

// Tingkat anomali; ikon dan teks membedakannya, tidak hanya warna.
export function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const { Icon, className } = severityStyles[severity];
  return (
    <span className={cn(badgeBase, className)}>
      <Icon className="size-3.5" aria-hidden="true" />
      {incidentSeverityLabels[severity]}
    </span>
  );
}

// Nama lama untuk pemakai yang sudah ada (tabel Pelanggan). Komponennya sendiri,
// termasuk keadaan netral untuk status yang belum diketahui, ada di
// billing-status-badge.tsx.
export function BillingBadge({ status }: { status: BillingStatus }) {
  return <BillingStatusBadge status={status} />;
}
