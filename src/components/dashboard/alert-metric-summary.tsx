"use client";

import { useMemo } from "react";
import {
  CheckCircle2,
  Flame,
  FlaskConical,
  History,
  TriangleAlert,
} from "lucide-react";
import {
  generateMockAlertKpi,
  isAlertBoardMockActive,
} from "@/lib/dashboard/alert-board-mock";
import { formatInteger } from "@/lib/dashboard/format";
import { useNowMinute } from "@/lib/dashboard/use-now";
import { MetricCard } from "./metric-card";

interface Props {
  active: readonly { severity?: string }[] | null;
  resolved: readonly { endedAt?: number }[] | null;
}

// Empat kartu ringkasan di atas daftar alert aktif. Angka dihitung dari dua
// daftar di store; yang belum tiba dihitung kosong.
export function AlertMetricSummary({ active, resolved }: Props) {
  const now = useNowMinute();
  const kpi = useMemo(
    () => generateMockAlertKpi(active ?? [], resolved ?? [], now),
    [active, resolved, now],
  );

  return (
    <section aria-label="Ringkasan alert" className="flex flex-col gap-3">
      {isAlertBoardMockActive(kpi.sourceStatus) && (
        <p
          data-testid="alert-mock-badge"
          className="inline-flex w-fit flex-wrap items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
        >
          <FlaskConical className="size-3.5" aria-hidden="true" />
          Data Tiruan Alert (Fase 2)
          <span className="font-normal">
            · Wajib dialihkan ke Go WebSocket Hub di Fase 5
          </span>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Alert Kritis Aktif"
          value={formatInteger(kpi.criticalCount)}
          hint={`dari ${formatInteger(kpi.totalActive)} alert aktif`}
          Icon={Flame}
          tone="danger"
        />
        <MetricCard
          label="Peringatan Berjalan"
          value={formatInteger(kpi.warningCount)}
          hint="Alert tingkat peringatan yang masih aktif"
          Icon={TriangleAlert}
          tone="warning"
        />
        <MetricCard
          label="Selesai 24 Jam Terakhir"
          value={formatInteger(kpi.resolvedPast24h)}
          hint="Alert yang berhenti dalam 24 jam"
          Icon={CheckCircle2}
          tone="success"
        />
        <MetricCard
          label="Total Riwayat 7 Hari"
          value={formatInteger(kpi.resolvedPast7d)}
          hint="Alert selesai dalam 7 hari"
          Icon={History}
        />
      </div>
    </section>
  );
}
