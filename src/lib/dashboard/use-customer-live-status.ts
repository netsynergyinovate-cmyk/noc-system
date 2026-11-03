"use client";

import { useEffect, useState } from "react";
import type { CustomerLiveStatus } from "./customer-live.ts";

const REFRESH_MS = 60_000;

/** Data langsung per pelanggan (IP, uptime, Wi-Fi, redaman), kunci = id pelanggan. undefined = belum dimuat / gagal. */
export function useCustomerLiveStatus(enabled: boolean): Record<string, CustomerLiveStatus> | undefined {
  const [data, setData] = useState<Record<string, CustomerLiveStatus>>();

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/customers/live-status", { cache: "no-store" });
        if (!res.ok) return;
        const body: { data?: Record<string, CustomerLiveStatus> } | null = await res.json().catch(() => null);
        if (alive && body?.data) setData(body.data);
      } catch {
        // jaringan putus: pertahankan data terakhir
      }
    };
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled]);

  return data;
}
