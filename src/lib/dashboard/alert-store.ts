"use client";

import { create } from "zustand";
import { alertActions, type AlertActions, type HandleAlertResult } from "./alert-actions";
import {
  emptyAlertState,
  handledState,
  messageState,
  pruneResolved,
  snapshotState,
  type AlertState,
  type AlertsMessage,
} from "./alert-sync";
import type { AlertLists } from "./alerts";

// Store alert: satu sumber untuk semua halaman (daftar dan riwayat di halaman
// Alert, lencana di dasbor). Diisi oleh DashboardFeed dari pesan hub (tiruan
// sekarang, WebSocket nanti), bukan oleh tiap halaman. Alert yang isinya tidak
// berubah tetap objek yang sama (lihat alert-sync.ts), jadi komponen yang
// membaca satu daftar tidak digambar ulang oleh pesan yang tidak menyentuhnya.
interface AlertStore extends AlertState {
  // Daftar lengkap menggantikan yang lama: saat tersambung dan setelah sinkron ulang.
  applySnapshot: (lists: AlertLists, nowSec: number) => void;
  // Pesan "alerts" dari hub: daftar aktif lengkap dan alert yang baru selesai.
  applyMessage: (message: AlertsMessage, nowSec: number) => void;
  // Membuang riwayat yang sudah lewat jendela; tidak berbuat apa-apa bila tidak ada.
  prune: (nowSec: number) => void;
  // Menandai alert aktif sudah ditangani (alert-actions.ts). Bila server
  // menerimanya, alert langsung pindah dari daftar aktif ke puncak riwayat dalam
  // satu pembaruan; bila ditolak, daftar tidak berubah dan alasannya dikembalikan.
  markHandled: (
    alertId: string,
    operator: string,
  ) => Promise<HandleAlertResult>;
  // Kembali ke "belum ada data", saat sumber data diputus.
  reset: () => void;
}

// Mode demo memakai server tiruan; mode live memasang tindakan nyata
// (alert-actions-live.ts) lewat configureAlertActions.
let actions: AlertActions = alertActions;
export function configureAlertActions(next: AlertActions) {
  actions = next;
}

export const useAlertStore = create<AlertStore>()((set) => ({
  ...emptyAlertState,

  applySnapshot: (lists, nowSec) =>
    set((state) => snapshotState(state, lists, nowSec)),

  applyMessage: (message, nowSec) =>
    set((state) => messageState(state, message, nowSec)),

  prune: (nowSec) =>
    set((state) => {
      if (state.resolved === null) return state;
      const resolved = pruneResolved(state.resolved, nowSec);
      return resolved === state.resolved ? state : { resolved };
    }),

  markHandled: async (alertId, operator) => {
    const result = await actions.handle(alertId, operator);
    if (result.ok) {
      const nowSec = Math.floor(Date.now() / 1000);
      set((state) => handledState(state, result.alert, nowSec));
    }
    return result;
  },

  reset: () => set({ ...emptyAlertState }),
}));
