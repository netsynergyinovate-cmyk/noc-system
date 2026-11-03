"use client";

import { WifiOff } from "lucide-react";
import { useSession } from "@/components/session-provider";
import {
  describeLastOk,
  diagnoseUnreachable,
  unreachableRouters,
} from "@/lib/dashboard/router-health";
import { useDashboardStore } from "@/lib/dashboard/store";
import { selectPreviewEnabled } from "@/lib/session-store";

// Peringatan di SEMUA halaman bila backend tidak bisa membaca router. Tanpa ini
// dasbor terlihat normal padahal datanya beku: pelanggan tetap "online", grafik
// berhenti, dan alert lain tidak mungkin berubah. Hanya mode live (demo tidak
// punya router sungguhan). Datanya didorong backend lewat telemetri, tanpa polling.
export function RouterHealthBanner() {
  const isDemo = useSession(selectPreviewEnabled);
  const health = useDashboardStore((s) => s.telemetry?.routers);
  // Detik pesan terakhir dari backend: dasar kalimat "terakhir diperbarui ...".
  const now = useDashboardStore((s) => s.lastUpdateAt) ?? 0;

  const down = unreachableRouters(health ?? []);
  if (isDemo || down.length === 0) return null;

  return (
    <div
      className="mb-6 flex flex-col gap-3"
      data-testid="router-health-banner"
    >
      {down.map((r) => {
        const d = diagnoseUnreachable(r.lastError);
        return (
          <div
            key={r.routerId}
            role="alert"
            data-cause={d.cause}
            className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm"
          >
            <div className="flex items-center gap-2 font-semibold text-destructive">
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span>
                {r.name} tidak terjangkau: {d.title}
              </span>
            </div>
            <p className="mt-2 text-foreground">{d.hint}</p>
            {d.command && (
              <pre className="mt-2 overflow-x-auto rounded-md bg-background/70 p-2 font-mono text-xs">
                {d.command}
              </pre>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Data di dasbor <strong>tidak diperbarui</strong> selama router
              tidak terbaca: status online pelanggan dan grafik yang tampil
              adalah yang terakhir diketahui. {describeLastOk(r.lastOkAt, now)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {r.host} · gagal {r.failures}× berturut-turut
              {r.lastError ? ` · ${r.lastError}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
