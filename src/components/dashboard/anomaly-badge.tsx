"use client";

import Link from "next/link";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { summarizeAlertSeverity } from "@/lib/dashboard/alerts";
import { formatInteger } from "@/lib/dashboard/format";
import { useDashboardStore } from "@/lib/dashboard/store";

const tones = {
  ok: {
    Icon: CircleCheck,
    className: "border-success/40 bg-success/10 text-success",
  },
  warning: {
    Icon: TriangleAlert,
    className: "border-warning/40 bg-warning/10 text-warning",
  },
  critical: {
    Icon: OctagonAlert,
    className: "border-destructive/40 bg-destructive/10 text-destructive",
  },
} as const;

// Indikator di dasbor: berapa anomali yang sedang aktif, dengan warna menurut
// yang paling genting, dan tautan ke daftar alert aktif. Ikon dan tulisan ikut
// berubah (bukan hanya warna). Tautannya dibungkus region status supaya
// perubahan angkanya diumumkan ke pembaca layar tanpa menghilangkan peran tautan.
// Angkanya dari store alert yang diisi hub (alert-sync.ts), sama dengan yang
// dibaca halaman Alert, jadi alert baru terlihat dalam hitungan detik tanpa
// membuka halaman lain.
export function AnomalyBadge() {
  const active = useAlertStore((state) => state.active);
  const connection = useDashboardStore((state) => state.connection);
  const disconnected = connection === "disconnected";

  if (!active) {
    return (
      <span
        role="status"
        className={cn(
          "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground",
          !disconnected && "animate-pulse motion-reduce:animate-none",
        )}
      >
        {disconnected ? "Anomali belum bisa dimuat" : "Memuat anomali…"}
      </span>
    );
  }

  const { total, critical, tone } = summarizeAlertSeverity(active);
  const { Icon, className } = tones[tone];
  const text =
    total === 0
      ? "Tidak ada anomali aktif"
      : critical > 0
        ? `${formatInteger(total)} anomali aktif, ${formatInteger(critical)} kritis`
        : `${formatInteger(total)} anomali aktif`;

  return (
    <span role="status" className="inline-flex">
      <Link
        href="/app/alert"
        data-testid="anomaly-badge"
        data-tone={tone}
        data-count={total}
        data-critical={critical}
        aria-label={`${text}. Buka daftar alert aktif`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium whitespace-nowrap outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50",
          className,
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {text}
        {disconnected && <span className="sr-only"> (koneksi terputus)</span>}
      </Link>
    </span>
  );
}
