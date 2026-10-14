"use client";

import { useEffect } from "react";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import { useSession } from "@/components/session-provider";
import { useDashboardStore } from "@/lib/dashboard/store";
import { useRealtimeFeed } from "@/lib/dashboard/use-realtime-feed";
import { selectPreviewEnabled } from "@/lib/session-store";

// Menyambungkan sumber data ke store lewat `useRealtimeFeed`: WebSocket backend
// (mode live, atau NEXT_PUBLIC_REALTIME_WS=true) dengan data tiruan sebagai
// cadangan, atau data tiruan saja (mode demo). Dipasang sekali di layout
// aplikasi, jadi satu "koneksi" dipakai semua halaman. Tidak menampilkan apa pun.
export function DashboardFeed() {
  const isDemo = useSession(selectPreviewEnabled);
  const useWs = process.env.NEXT_PUBLIC_REALTIME_WS === "true" || !isDemo;
  const feed = useRealtimeFeed({ forceMock: !useWs, allowFallback: isDemo });
  const { connectionStatus, isMockFallback, latencyMs, reconnect } = feed;

  // Sinkronisasi mode operasi Live vs Demo pada store
  useEffect(() => {
    if (!isDemo) {
      // Live Mode: Bersihkan data dummy dan ambil router riil dari database
      fetch("/api/routers")
        .then((res) => res.json())
        .then((json) => {
          const list = Array.isArray(json?.data) ? json.data : [];
          const liveRouters = list.map((r: any) => ({
            id: String(r.id),
            name: String(r.name),
            host: String(r.host),
            active: r.status === "aktif",
          }));
          useDashboardStore.getState().setLiveMode(true, liveRouters);
        })
        .catch(() => {
          useDashboardStore.getState().setLiveMode(true, []);
        });

      // Kosongkan alert tiruan
      useAlertStore.getState().reset();
    } else {
      useDashboardStore.getState().setLiveMode(false);
    }
  }, [isDemo]);

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

  return null;
}
