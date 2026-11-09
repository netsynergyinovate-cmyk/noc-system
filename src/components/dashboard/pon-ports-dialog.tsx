"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DashboardOlt } from "@/lib/dashboard/olts";
import {
  getMockPonPorts,
  type PonPortSummary,
} from "@/lib/dashboard/pon-ports";

interface Props {
  olt: DashboardOlt | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PonPortsDialog({ olt, open, onOpenChange }: Props) {
  // Hasil API disimpan bersama id OLT-nya: hasil OLT lain diabaikan tanpa efek reset.
  const [fetched, setFetched] = useState<{
    oltId: string;
    ports: PonPortSummary[];
  } | null>(null);
  const oltId = olt?.id;

  useEffect(() => {
    if (!open || !oltId) return;
    const ctrl = new AbortController();
    fetch(`/api/olts/${encodeURIComponent(oltId)}/pon`, { signal: ctrl.signal })
      .then(async (res) => {
        // 404 = OLT tidak dikenal / mock ditolak saat mode live: jangan jatuh ke data tiruan.
        if (res.status === 404) return setFetched({ oltId, ports: [] });
        if (!res.ok) return;
        const body = (await res.json()) as { data?: PonPortSummary[] };
        if (Array.isArray(body.data)) setFetched({ oltId, ports: body.data });
      })
      .catch(() => {}); // jaringan gagal: pakai fallback demo (jika ada)
    return () => ctrl.abort();
  }, [open, oltId]);

  const isMock = !!oltId?.startsWith("olt-");
  const ports = useMemo(() => {
    if (!olt) return [];
    if (fetched?.oltId === olt.id) return fetched.ports;
    return isMock ? getMockPonPorts(olt.id, olt.totalPonPorts, olt.name) : [];
  }, [olt, fetched, isMock]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto sm:max-w-4xl"
        data-testid="pon-ports-dialog"
      >
        <DialogHeader>
          <DialogTitle>Port PON {olt?.name}</DialogTitle>
          <DialogDescription>
            Daftar port PON beserta utilisasi dan redaman optik.
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {isMock ? "Data tiruan (mode demo)." : "Data terhubung ke OLT nyata."}
        </p>
        {ports.length === 0 && (
          <div
            data-testid="pon-ports-empty"
            className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground"
          >
            Tidak ada port PON yang terdaftar pada OLT ini.
          </div>
        )}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ports.map((p) => {
            const pct = Math.round((p.onuCount / p.capacity) * 100);
            return (
              <li
                key={p.id}
                className="space-y-2 rounded-md border p-3 text-sm"
                data-testid="pon-port-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.name}</span>
                  {p.status === "up" ? (
                    <Badge variant="default">UP</Badge>
                  ) : (
                    <Badge variant="destructive">DOWN</Badge>
                  )}
                </div>
                <div className="text-xs tabular-nums">
                  {p.onuCount}/{p.capacity} ONU ({p.onlineOnuCount} online)
                </div>
                <div
                  role="progressbar"
                  aria-label={`Utilisasi ${p.name}`}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-1.5 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  <div>TX Power {p.txPowerDbm} dBm</div>
                  <div>Rerata RX {p.avgRxPowerDbm} dBm</div>
                </div>
                <Link
                  href={`/app/cpe/pon/${p.id}`}
                  className="text-xs text-primary underline-offset-2 hover:underline"
                >
                  Detail PON
                </Link>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
