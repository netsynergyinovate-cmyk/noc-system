"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CpeLite } from "./onu-inventory.ts";

const REFRESH_MS = 60_000;
const PAGE = 100; // batas GET /api/cpe
const MAX_PAGES = 10;

async function fetchAll(signal?: AbortSignal): Promise<CpeLite[]> {
  const out: CpeLite[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`/api/cpe?limit=${PAGE}&page=${page}`, {
      signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as {
      data?: {
        deviceId: string;
        pppoeUsername: string;
        macAddress: string;
        isOnline: boolean;
      }[];
      total?: number;
    };
    const rows = Array.isArray(json.data) ? json.data : [];
    for (const d of rows) {
      out.push({
        deviceId: d.deviceId,
        pppoeUsername: d.pppoeUsername ?? "",
        macAddress: d.macAddress ?? "",
        isOnline: !!d.isOnline,
      });
    }
    if (rows.length < PAGE || out.length >= (json.total ?? 0)) break;
  }
  return out;
}

// Modem yang sudah terdaftar di GenieACS (untuk status "Terdaftar / Belum" per ONU), disegarkan
// berkala. null = belum dimuat. failed = GenieACS tidak bisa dibaca: status tidak ditebak.
export function useGenieacsRegistry(enabled: boolean) {
  const [devices, setDevices] = useState<CpeLite[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const next = await fetchAll();
      if (alive.current) {
        setDevices(next);
        setFailed(false);
      }
    } catch {
      if (alive.current) setFailed(true);
    }
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    const first = setTimeout(() => void reload(), 0);
    const timer = setInterval(() => void reload(), REFRESH_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, reload]);

  return { devices, failed, reload };
}
