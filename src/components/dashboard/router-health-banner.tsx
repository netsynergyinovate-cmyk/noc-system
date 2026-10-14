"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { useSession } from "@/components/session-provider";
import { backendGet } from "@/lib/dashboard/backend-api";
import {
  describeLastOk,
  diagnoseUnreachable,
  unreachableRouters,
  type RouterHealth,
} from "@/lib/dashboard/router-health";
import { selectPreviewEnabled } from "@/lib/session-store";

const POLL_MS = 10_000;

// Peringatan di SEMUA halaman bila backend tidak bisa membaca router. Tanpa ini
// dasbor terlihat normal padahal datanya beku: pelanggan tetap "online", grafik
// berhenti, dan alert lain tidak mungkin berubah. Hanya mode live (demo tidak
// punya router sungguhan).
export function RouterHealthBanner() {
  const isDemo = useSession(selectPreviewEnabled);
  const [health, setHealth] = useState<RouterHealth[]>([]);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (isDemo) return;
    let alive = true;
    const load = async () => {
      try {
        const data = await backendGet<RouterHealth[]>("/api/v1/routers/health");
        if (alive) {
          setHealth(data);
          setNow(Math.floor(Date.now() / 1000));
        }
      } catch {
        // Backend sendiri tidak terjangkau: itu urusan indikator koneksi dasbor.
      }
    };
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [isDemo]);

  const down = unreachableRouters(health);
  if (isDemo || down.length === 0) return null;

  return (
    <div className="mb-6 flex flex-col gap-3" data-testid="router-health-banner">
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
              Data di dasbor <strong>tidak diperbarui</strong> selama router tidak terbaca: status online pelanggan
              dan grafik yang tampil adalah yang terakhir diketahui. {describeLastOk(r.lastOkAt, now)}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {r.host} · gagal {r.failures}× berturut-turut{r.lastError ? ` · ${r.lastError}` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
