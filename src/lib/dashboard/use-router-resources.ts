"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MockRouterDetail } from "./routers.ts";

// Detail router NYATA dari server (GET /api/routers/resources: CPU, memori,
// uptime, versi, jumlah queue, suhu, dibaca langsung dari tiap router lewat REST).
// Dipakai tabel router dan panel ringkasan; satu pemanggilan dipakai bersama
// supaya router tidak ditanya dua kali tiap putaran.

const REFRESH_MS = 2_500;
const SHARE_WINDOW_MS = 1_000;

let shared: { at: number; promise: Promise<MockRouterDetail[]> } | null = null;

function fetchResources(force: boolean): Promise<MockRouterDetail[]> {
  const now = Date.now();
  if (!force && shared && now - shared.at < SHARE_WINDOW_MS) return shared.promise;
  const promise = fetch("/api/routers/resources")
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((json: { data?: { items?: MockRouterDetail[] } }) => json.data?.items ?? []);
  shared = { at: now, promise };
  // Gagal tidak boleh dibagikan ke pemanggil berikutnya.
  promise.catch(() => {
    if (shared?.promise === promise) shared = null;
  });
  return promise;
}

export function useRouterResources(enabled: boolean, intervalMs = REFRESH_MS) {
  const [items, setItems] = useState<MockRouterDetail[] | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const load = useCallback(
    async (force: boolean): Promise<boolean> => {
      if (!enabled) return true;
      try {
        const next = await fetchResources(force);
        if (alive.current) {
          setItems(next);
          setFailed(false);
        }
        return true;
      } catch {
        if (alive.current) setFailed(true);
        return false;
      }
    },
    [enabled],
  );

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    // Pemuatan pertama dijadwalkan, bukan dipanggil langsung di badan efek.
    const first = setTimeout(() => void load(false), 0);
    const timer = setInterval(() => void load(false), intervalMs);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled, intervalMs, load]);

  return { items, failed, refresh: () => load(true) };
}
