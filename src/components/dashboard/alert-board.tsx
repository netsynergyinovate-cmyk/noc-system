"use client";

import { useAlertStore } from "@/lib/dashboard/alert-store";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useNowMinute } from "@/lib/dashboard/use-now";
import { ActiveAlertList } from "./active-alert-list";
import { AlertAutoRefreshControl } from "./alert-auto-refresh-control";
import { AlertMetricSummary } from "./alert-metric-summary";
import { ResolvedAlertList } from "./resolved-alert-list";

// Halaman Alert: daftar aktif dan riwayat selesai dibaca dari satu store yang
// diisi hub (lihat alert-sync.ts), bukan ditarik sendiri. Keduanya berubah dalam
// satu pembaruan store, jadi alert yang baru selesai berpindah dari satu daftar
// ke yang lain sekaligus, bukan hilang dulu atau tampil di keduanya. Berpindah
// halaman tidak memuat ulang apa pun: store sudah terisi.
// `operator` adalah nama petugas yang masuk, untuk "tandai ditangani".
export function AlertBoard({ operator }: { operator: string }) {
  const active = useAlertStore((state) => state.active);
  const resolved = useAlertStore((state) => state.resolved);
  const connection = useDashboardStore((state) => state.connection);
  // Hanya untuk menentukan "hari ini atau bukan" pada jam yang ditulis; berubah
  // sekali semenit.
  const now = useNowMinute();
  const disconnected = connection === "disconnected";

  return (
    <div className="flex flex-col gap-6">
      {disconnected && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          Koneksi data terputus.
          {active
            ? " Yang tampil adalah alert terakhir yang diterima."
            : " Alert belum bisa dimuat."}
        </div>
      )}
      <AlertAutoRefreshControl />
      {(active !== null || !disconnected) && (
        <>
          <AlertMetricSummary active={active} resolved={resolved} />
          <ActiveAlertList alerts={active} now={now} operator={operator} />
          <ResolvedAlertList alerts={resolved} now={now} />
        </>
      )}
    </div>
  );
}
