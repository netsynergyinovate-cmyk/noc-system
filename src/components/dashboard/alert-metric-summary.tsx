"use client";

import { useMemo } from "react";
import { CheckCircle2, Flame, History, TriangleAlert } from "lucide-react";
import { computeAlertKpi } from "@/lib/dashboard/alert-board-mock";
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
    () => computeAlertKpi(active ?? [], resolved ?? [], now),
    [active, resolved, now],
  );
  return (
    <section aria-label="Ringkasan alert" className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4 [&>[data-slot=card]]:gap-0 [&>[data-slot=card]]:rounded [&>[data-slot=card]]:px-3 [&>[data-slot=card]]:py-2 [&_p.text-2xl]:mt-0 [&_p.text-2xl]:font-mono [&_p.text-2xl]:text-lg">
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
