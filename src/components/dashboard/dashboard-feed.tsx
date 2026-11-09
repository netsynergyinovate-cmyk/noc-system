"use client";

import { useEffect } from "react";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { useSession } from "@/components/session-provider";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useRealtimeFeed } from "@/lib/dashboard/use-realtime-feed";
import { selectPreviewEnabled } from "@/lib/session-store";
import { LiveAlertSync } from "@/components/dashboard/live-alert-sync";
import { ROUTERS_CHANGED_EVENT } from "@/lib/dashboard/routers";

// Menyambungkan sumber data ke store lewat `useRealtimeFeed`: WebSocket backend
// (mode live, atau NEXT_PUBLIC_REALTIME_WS=true) dengan data tiruan sebagai
// cadangan, atau data tiruan saja (mode demo). Dipasang sekali di layout
// aplikasi, jadi satu "koneksi" dipakai semua halaman. Tidak menampilkan apa pun.
export function DashboardFeed() {
  const isDemo = useSession(selectPreviewEnabled);
  const useWs = process.env.NEXT_PUBLIC_REALTIME_WS === "true" || !isDemo;

  // Sinkronisasi mode operasi Live vs Demo pada store. HARUS dideklarasikan
  // sebelum useRealtimeFeed: efek berjalan menurut urutan, dan setLiveMode
  // mengosongkan kartu insiden. Bila ia berjalan sesudah feed demo memberi
  // snapshot awal, kartu insiden terhapus dan halaman macet di "Memuat insiden".
  useEffect(() => {
    // Live: kosongkan data tiruan sekarang juga; router, pelanggan, dan telemetri
    // datang dari backend Go lewat WebSocket.
    useDashboardStore.getState().setLiveMode(!isDemo);
    if (!isDemo) useAlertStore.getState().reset();
  }, [isDemo]);

  const feed = useRealtimeFeed({ forceMock: !useWs, allowFallback: isDemo });
  const { connectionStatus, isMockFallback, latencyMs, reconnect } = feed;

  // Tombol "Coba lagi" di LiveStatus memanggil handler ini.
  useEffect(() => {
    const { setReconnectHandler } = useDashboardStore.getState();
    setReconnectHandler(reconnect);
    return () => setReconnectHandler(null);
  }, [reconnect]);

  // Status koneksi, penanda cadangan, dan latensi untuk indikator.
  useEffect(() => {
    useDashboardStore
      .getState()
      .setConnection(connectionStatus, isMockFallback, latencyMs);
  }, [connectionStatus, isMockFallback, latencyMs]);

  // Mode live: snapshot WebSocket hanya dikirim saat tersambung, jadi router yang baru ditambahkan tidak muncul
  // sampai sambung ulang. Daftar router aktif dimuat dari database tiap 10 detik dan seketika setelah ada perubahan.
  useEffect(() => {
    if (isDemo) return;
    let alive = true;
    async function load() {
      try {
        const res = await fetch("/api/routers", { cache: "no-store" });
        const json = await res.json().catch(() => null);
        if (!alive || !res.ok || !Array.isArray(json?.data)) return;
        const live = (
          json.data as Array<{
            id: string;
            name: string;
            host: string;
            status: string;
          }>
        )
          .filter((r) => r.status === "aktif")
          .map((r) => ({ id: r.id, name: r.name, host: r.host, active: true }));
        useDashboardStore.getState().setLiveRouters(live);
      } catch {
        // gagal memuat: pakai data dari WebSocket
      }
    }
    void load();
    const timer = setInterval(() => void load(), 10_000);
    window.addEventListener(ROUTERS_CHANGED_EVENT, load);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener(ROUTERS_CHANGED_EVENT, load);
    };
  }, [isDemo]);

  // Mode live: alert dari database (rule engine Go), bukan hub tiruan.
  return isDemo ? null : <LiveAlertSync />;
}
