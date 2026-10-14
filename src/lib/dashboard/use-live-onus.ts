"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLiveOnus, type LiveOnuResult } from "./olt-live.ts";

const REFRESH_MS = 30_000;
const SHARE_MS = 3_000;

let shared: { at: number; promise: Promise<LiveOnuResult> } | null = null;

function load(force: boolean): Promise<LiveOnuResult> {
  const now = Date.now();
  if (!force && shared && now - shared.at < SHARE_MS) return shared.promise;
  const promise = fetchLiveOnus();
  shared = { at: now, promise };
  promise.catch(() => {
    if (shared?.promise === promise) shared = null;
  });
  return promise;
}

// ONU nyata dari server, disegarkan berkala. Dipakai bersama oleh inventaris,
// panel pemetaan, dan tab ONT; satu pemuatan dibagi supaya tidak berlipat.
export function useLiveOnus(enabled: boolean) {
  const [result, setResult] = useState<LiveOnuResult | null>(null);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const reload = useCallback(async (): Promise<boolean> => {
    if (!enabled) return true;
    try {
      const next = await load(true);
      if (alive.current) {
        setResult(next);
        setFailed(false);
      }
      return true;
    } catch {
      if (alive.current) setFailed(true);
      return false;
    }
  }, [enabled]);

  useEffect(() => {
    alive.current = true;
    if (!enabled) return;
    const run = async () => {
      try {
        const next = await load(false);
        if (alive.current) {
          setResult(next);
          setFailed(false);
        }
      } catch {
        if (alive.current) setFailed(true);
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
    onus: result?.onus ?? null,
    truncated: result?.truncated ?? false,
    total: result?.total ?? 0,
    failed,
    reload,
  };
}
