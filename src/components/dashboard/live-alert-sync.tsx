"use client";

import { useEffect } from "react";
import { configureAlertActions, useAlertStore } from "@/lib/dashboard/alert-store";
import { createLiveAlertActions } from "@/lib/dashboard/alert-actions-live";
import { ALERT_HISTORY_SECONDS, reconcileAlertLists } from "@/lib/dashboard/alerts";
import {
  buildLiveDirectory,
  toLiveActiveAlerts,
  toLiveResolvedAlerts,
  type LiveAlertItem,
} from "@/lib/dashboard/alerts-live";
import { buildIncidentCards } from "@/lib/dashboard/incident-cards";
import { ALERT_EVENTS_SIGNAL } from "@/lib/dashboard/realtime-ws";
import { useDashboardStore } from "@/lib/dashboard/store";

const POLL_MS = 10_000;
// Beberapa event datang beruntun saat satu router bermasalah; satu pemuatan cukup.
const DEBOUNCE_MS = 400;
const PAGE_LIMIT = 200;

async function getAlerts(query: string): Promise<LiveAlertItem[]> {
  const res = await fetch(`/api/alerts?${query}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: LiveAlertItem[] };
  return json.data ?? [];
}

// Mode live: alert dibaca dari tabel `alerts` (diisi rule engine Go) dan diisikan
// ke store yang sama dengan yang dibaca semua halaman, jadi lencana, halaman Alert,
// dan Deteksi Anomali selalu sepakat. Disegarkan tiap 10 detik dan segera saat
// hub mengirim event gangguan.
export function LiveAlertSync() {
  useEffect(() => {
    configureAlertActions(createLiveAlertActions());
    let alive = true;
    let inflight = false;
    let debounce: ReturnType<typeof setTimeout> | null = null;

    const load = async () => {
      if (inflight || !alive) return;
      inflight = true;
      try {
        const now = Math.floor(Date.now() / 1000);
        const [active, resolved] = await Promise.all([
          getAlerts(`status=active&limit=${PAGE_LIMIT}`),
          getAlerts(`status=resolved&from=${now - ALERT_HISTORY_SECONDS}&limit=${PAGE_LIMIT}`),
        ]);
        if (!alive) return;
        const { routers, customers } = useDashboardStore.getState();
        const directory = buildLiveDirectory(routers, customers);
        const activeAlerts = toLiveActiveAlerts(active, directory);
        const lists = reconcileAlertLists(activeAlerts, toLiveResolvedAlerts(resolved));
        useAlertStore.getState().applySnapshot(lists, now);
        useDashboardStore
          .getState()
          .applyIncidents(buildIncidentCards(lists.active, directory), now);
      } catch {
        // Gagal sesaat: daftar terakhir tetap tampil, dicoba lagi pada putaran berikutnya.
      } finally {
        inflight = false;
      }
    };

    const onEvents = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void load(), DEBOUNCE_MS);
    };

    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    window.addEventListener(ALERT_EVENTS_SIGNAL, onEvents);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
      window.removeEventListener(ALERT_EVENTS_SIGNAL, onEvents);
    };
  }, []);

  return null;
}
