"use client";

import { useEffect, useRef, useState } from "react";
import { fetchLiveCpe, type LiveCpeResult } from "./cpe-live.ts";

const REFRESH_MS = 30_000;

// Modem nyata dari GenieACS, disegarkan berkala. `loaded` false sampai pemuatan
// pertama selesai; `failed` true bila pemuatan terakhir gagal (data lama dipertahankan).
export function useLiveCpe(enabled: boolean) {
  const [result, setResult] = useState<LiveCpeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    const run = async () => {
      try {
        const next = await fetchLiveCpe();
        if (alive.current) {
          setResult(next);
          setError(null);
        }
      } catch (e) {
        if (alive.current)
          setError(e instanceof Error ? e.message : "Gagal memuat modem.");
      }
    };
    const first = setTimeout(() => void run(), 0);
    const timer = setInterval(() => void run(), REFRESH_MS);
    return () => {
      alive.current = false;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [enabled]);

  return {
    devices: result?.devices ?? null,
    total: result?.total ?? 0,
    truncated: result?.truncated ?? false,
    loaded: result !== null,
    error,
  };
}
