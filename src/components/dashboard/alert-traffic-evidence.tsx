"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ActiveAlert, ResolvedAlert } from "@/lib/dashboard/alerts";

interface AlertTrafficEvidenceProps {
  alert: ActiveAlert | ResolvedAlert;
}

export function AlertTrafficEvidence({ alert }: AlertTrafficEvidenceProps) {
  // PRD §3.4 Fase 4: Bukti trafik pada jam kejadian alert.
  // Menyediakan tautan dua arah antara alert dan analisis trafik NetFlow pada rentang waktu kejadian.
  if (!alert.startedAt) return null;

  const fromSec = Math.max(0, alert.startedAt - 1800); // 30 menit sebelum kejadian
  const toSec = "endedAt" in alert && alert.endedAt ? alert.endedAt + 1800 : alert.startedAt + 3600;
  const routerParam = alert.routerId ? `&routerId=${encodeURIComponent(alert.routerId)}` : "";
  const alertIdParam = `&alertId=${encodeURIComponent(alert.id)}`;
  const href = `/app/netflow?from=${fromSec}&to=${toSec}${routerParam}${alertIdParam}`;

  return (
    <Button
      asChild
      variant="outline"
      size="sm"
      className="h-7 gap-1 px-2 text-xs font-mono"
      data-testid="alert-traffic-evidence-btn"
      title="Buka bukti trafik NetFlow pada jam kejadian alert ini"
    >
      <Link href={href}>
        <Activity className="size-3.5 text-primary" aria-hidden="true" />
        <span>Bukti Trafik</span>
      </Link>
    </Button>
  );
}
