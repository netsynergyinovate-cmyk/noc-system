"use client";

import { useEffect, useState } from "react";
import type { CustomerLiveStatus } from "./customer-live.ts";
import { backendGet } from "./backend-api";
import { ALERT_EVENTS_SIGNAL } from "./realtime-ws";
const REFRESH_MS = 60_000;

/** Data langsung per pelanggan (MikroTik + GenieACS + OLT + LOS) diproses di Go backend. */
export function useCustomerLiveStatus(enabled: boolean): Record<string, CustomerLiveStatus> | undefined {
  const [data, setData] = useState<Record<string, CustomerLiveStatus>>();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        // Direct call ke Go backend dengan tiket autentikasi
        const liveData = await backendGet<Record<string, CustomerLiveStatus>>("/api/v1/customers/live-status");
        if (alive && liveData) {
          setData(liveData);
          return;
        }
      } catch {
        // Fallback jika direct ticket gagal: coba lewat route handler Next.js
        try {
          const res = await fetch("/api/customers/live-status", { cache: "no-store" });
          if (!res.ok) return;
          const body: { data?: Record<string, CustomerLiveStatus> } | null = await res.json().catch(() => null);
          if (alive && body?.data) setData(body.data);
        } catch {
          // jaringan putus: pertahankan data terakhir
        }
      }
    };
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), REFRESH_MS);

    // Pemicu seketika saat ada alarm OLT/LOS dari WebSocket hub
    let debounceTimer: number | undefined;
    const onSignal = () => {
      if (!alive) return;
      clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void load(), 200);
    };
    if (typeof window !== "undefined") {
      window.addEventListener(ALERT_EVENTS_SIGNAL, onSignal);
    }

    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
      clearTimeout(debounceTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener(ALERT_EVENTS_SIGNAL, onSignal);
      }
    };
  }, [enabled]);

  return data;
}
