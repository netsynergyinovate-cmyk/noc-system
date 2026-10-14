"use client";

import { useMemo } from "react";
import { CircleCheck, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "cn";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { alertBadge, type AlertBadgeModel } from "@/lib/dashboard/alert-badge";
import { summarizeAlertSeverity } from "@/lib/dashboard/alerts";
import { useDashboardStore } from "@/lib/dashboard/store";

// Warna dan ikon menurut yang paling genting, sama dengan lencana di dasbor
// (anomaly-badge.tsx). Ikon dan angka ikut berubah, jadi artinya tidak hanya warna.
// Tintanya (10%) ditumpuk di atas latar kartu yang buram, bukan di atas apa pun yang
// ada di belakang lencana: di halaman yang sedang dibuka tautannya berlatar abu-abu
// (bg-secondary), dan tinta peringatan di atas abu-abu itu turun ke 4,26 : 1.
const tones = {
  ok: {
    Icon: CircleCheck,
    className:
      "border-success/40 bg-card bg-linear-to-r from-success/10 to-success/10 text-success",
  },
  warning: {
    Icon: TriangleAlert,
    className:
      "border-warning/40 bg-card bg-linear-to-r from-warning/10 to-warning/10 text-warning",
  },
  critical: {
    Icon: OctagonAlert,
    className:
      "border-destructive/40 bg-card bg-linear-to-r from-destructive/10 to-destructive/10 text-destructive",
  },
} as const;

// Dibaca dari store alert yang diisi hub (alert-sync.ts), sama dengan halaman
// Alert dan lencana di dasbor: berubah sendiri dalam hitungan detik, tanpa memuat
// ulang dan tanpa menarik data sendiri. Yang berlangganan hanya komponen di bawah
// ini, jadi menu tidak digambar ulang oleh pesan yang tidak mengubah angkanya.
function useAlertBadge(): AlertBadgeModel | null {
  const active = useAlertStore((state) => state.active);
  const disconnected = useDashboardStore(
    (state) => state.connection === "disconnected",
  );
  return useMemo(
    () =>
      active ? alertBadge(summarizeAlertSeverity(active), disconnected) : null,
    [active, disconnected],
  );
}

// Lencana di dalam tautan menu "Alert". Hiasan bagi pembaca layar (aria-hidden):
// nama tautannya tetap "Alert" dan jumlahnya dibaca lewat AlertCountAnnouncement,
// karena nama yang berubah-ubah mengacaukan menu dan pencarian tautan.
export function AlertCountBadge({ className }: { className?: string }) {
  const model = useAlertBadge();
  if (model === null) return null;
  const { Icon, className: tone } = tones[model.tone];
  return (
    <span
      aria-hidden="true"
      title={model.description}
      data-testid="alert-count-badge"
      data-tone={model.tone}
      data-count={model.total}
      data-critical={model.critical}
      data-stale={model.stale}
      className={cn(
        "inline-flex min-w-5 items-center justify-center gap-0.5 rounded-full border px-1.5 text-[11px] leading-4 font-semibold whitespace-nowrap tabular-nums",
        tone,
        // Data terakhir sebelum sambungan terputus: garis putus-putus, bukan
        // pudar, supaya tulisannya tetap terbaca.
        model.stale && "border-dashed",
        className,
      )}
    >
      <Icon className="size-3 shrink-0" />
      {model.text}
    </span>
  );
}

// Kalimat lengkapnya untuk pembaca layar: menjadi keterangan tautan "Alert"
// (aria-describedby) dan, sebagai region status, diumumkan setiap kali berubah.
// Ada di luar tautan supaya tidak masuk ke namanya. Region-nya selalu ada, juga
// sebelum data diterima, supaya isi pertamanya ikut diumumkan.
export function AlertCountAnnouncement({ id }: { id: string }) {
  const model = useAlertBadge();
  return (
    <span
      id={id}
      role="status"
      data-testid="alert-count-status"
      className="sr-only"
    >
      {model?.description}
    </span>
  );
}
