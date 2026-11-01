"use client";

import { create } from "zustand";
import { TRAFFIC_WINDOW } from "./constants";
import { getCustomerHealth } from "./health";
import type { IncidentCard } from "./incident-cards";
import { mergeIncidentCards } from "./incident-sync";
import { createMockCustomers, mockRouters } from "./mock-data";
import type {
  BillingStatus,
  ConnectionStatus,
  DashboardCustomer,
  DashboardDelta,
  DashboardRouter,
  DashboardSnapshot,
  MapFocusRequest,
  TrafficSeries,
} from "./types";
import { ALERT_EVENTS_SIGNAL } from "./realtime-ws";
import { alertSignature, type Telemetry } from "./telemetry";

interface DashboardState {
  // Diganti hanya saat status pelanggan berubah, bukan tiap detik.
  customers: DashboardCustomer[];
  routers: DashboardRouter[];
  // Angka turunan disimpan terpisah supaya kartu cukup membaca satu angka.
  onlineCount: number;
  offlineCount: number;
  weakSignalCount: number;
  activeRouterCount: number;
  traffic: TrafficSeries;
  connection: ConnectionStatus;
  // Selisih ms jam server dengan data terakhir; null bila belum ada ukuran.
  latencyMs: number | null;
  // true saat layar dijalankan data tiruan, bukan WebSocket.
  isMockFallback: boolean;
  // Menyambung ulang aliran; dipasang oleh DashboardFeed, null bila tidak ada.
  reconnectFeed: (() => void) | null;
  // Detik epoch pesan terakhir yang diterima.
  lastUpdateAt: number | null;
  // Permintaan terakhir agar peta menyorot satu pelanggan; null bila tidak ada
  // (belum diminta, atau pengguna sudah menutup sorotan).
  mapFocus: MapFocusRequest | null;
  // Kartu insiden aktif dari pesan "incidents" hub; null sebelum pesan pertama.
  // Kartu yang isinya tidak berubah tetap objek yang sama (lihat incident-sync.ts).
  incidentCards: IncidentCard[] | null;
  // Detik epoch pesan "incidents" terakhir.
  incidentsAt: number | null;
  // Telemetri backend Go (resource router, OLT, VLAN PON, latensi, optik, alert); null
  // sebelum pesan pertama. Didorong backend saat berubah, tidak pernah diambil berkala.
  telemetry: Telemetry | null;
  // Pesan realtime dari sumber data (tiruan sekarang, WebSocket nanti).
  applySnapshot: (snapshot: DashboardSnapshot, nowSec: number) => void;
  applyDelta: (delta: DashboardDelta, nowSec: number) => void;
  setConnection: (
    status: ConnectionStatus,
    isMockFallback?: boolean,
    latencyMs?: number | null,
  ) => void;
  setReconnectHandler: (handler: (() => void) | null) => void;
  applyIncidents: (cards: IncidentCard[], nowSec: number) => void;
  focusMap: (customerId: string) => void;
  clearMapFocus: () => void;
  setLiveMode: (isLive: boolean, liveRouters?: DashboardRouter[]) => void;
  setLiveRouters: (routers: DashboardRouter[]) => void;
  applyTelemetry: (telemetry: Telemetry) => void;
}

function countCustomers(customers: DashboardCustomer[]) {
  let onlineCount = 0;
  let weakSignalCount = 0;
  for (const customer of customers) {
    if (customer.isOnline) onlineCount += 1;
    if (getCustomerHealth(customer) === "warning") weakSignalCount += 1;
  }
  return {
    onlineCount,
    offlineCount: customers.length - onlineCount,
    weakSignalCount,
  };
}

// Satu salinan array per seri, bukan dua, karena dipanggil tiap detik.
function appendCapped(values: number[], next: number) {
  const copy =
    values.length >= TRAFFIC_WINDOW ? values.slice(1) : values.slice();
  copy.push(next);
  return copy;
}

const countActiveRouters = (routers: DashboardRouter[]) =>
  routers.filter((router) => router.active).length;

// Status tagihan terkini tiap pelanggan (id -> status), untuk halaman yang
// mendapat daftar tagihannya dari tempat lain tetapi harus berubah bersamaan
// dengan lencana di tabel dan di peta. Dipakai dengan useShallow supaya
// komponennya hanya digambar ulang saat ada status yang berganti.
export function selectBillingStatuses(state: {
  customers: DashboardCustomer[];
}): Record<string, BillingStatus> {
  return Object.fromEntries(
    state.customers.map((customer) => [customer.id, customer.billingStatus]),
  );
}

// Data awal yang sama di server dan browser; snapshot asli menggantikannya
// begitu sumber data tersambung.
export const initialCustomers = createMockCustomers();

// Nomor permintaan sorot tidak pernah mundur, bahkan setelah sorotan ditutup.
let focusSeq = 0;

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  customers: initialCustomers,
  routers: mockRouters,
  ...countCustomers(initialCustomers),
  activeRouterCount: countActiveRouters(mockRouters),
  traffic: { times: [], rx: [], tx: [] },
  connection: "connecting",
  latencyMs: null,
  isMockFallback: false,
  reconnectFeed: null,
  lastUpdateAt: null,
  mapFocus: null,
  incidentCards: null,
  incidentsAt: null,
  telemetry: null,

  applySnapshot: (snapshot, nowSec) =>
    set({
      customers: snapshot.customers,
      routers: snapshot.routers,
      ...countCustomers(snapshot.customers),
      activeRouterCount: countActiveRouters(snapshot.routers),
      traffic: snapshot.traffic,
      connection: "live",
      lastUpdateAt: nowSec,
    }),

  applyDelta: (delta, nowSec) =>
    set((state) => {
      let customers = state.customers;
      const billingChanges = delta.billingChanges ?? [];
      if (delta.statusChanges.length > 0 || billingChanges.length > 0) {
        const online = new Map(
          delta.statusChanges.map((change) => [
            change.customerId,
            change.isOnline,
          ]),
        );
        const billing = new Map(
          billingChanges.map((change) => [change.customerId, change.status]),
        );
        // Hanya pelanggan yang benar-benar berubah yang menjadi objek baru, jadi
        // baris tabel dan titik peta lain tidak digambar ulang, dan pesan yang
        // sama diterapkan dua kali tidak mengubah apa pun.
        let changed = false;
        const next = state.customers.map((customer) => {
          const isOnline = online.get(customer.id);
          const billingStatus = billing.get(customer.id);
          const onlineDiffers =
            isOnline !== undefined && isOnline !== customer.isOnline;
          const billingDiffers =
            billingStatus !== undefined &&
            billingStatus !== customer.billingStatus;
          if (!onlineDiffers && !billingDiffers) return customer;
          changed = true;
          return {
            ...customer,
            ...(onlineDiffers ? { isOnline } : {}),
            ...(billingDiffers ? { billingStatus } : {}),
          };
        });
        if (changed) customers = next;
      }
      return {
        // Hitung ulang angka hanya jika ada pelanggan yang berubah.
        ...(customers !== state.customers
          ? { customers, ...countCustomers(customers) }
          : {}),
        // Tanpa titik traffic (tidak ada router melapor) grafik tidak berubah.
        ...(delta.traffic
          ? {
              traffic: {
                times: appendCapped(state.traffic.times, delta.traffic.time),
                rx: appendCapped(state.traffic.rx, delta.traffic.rx),
                tx: appendCapped(state.traffic.tx, delta.traffic.tx),
              },
            }
          : {}),
        connection: "live",
        lastUpdateAt: nowSec,
      };
    }),

  // Argumen yang tidak diberikan mengosongkan nilainya: engine memanggil
  // `setConnection(status)` saja saat WebSocket berganti status, dan sisa
  // data tiruan/latensi lama tidak boleh tertinggal.
  setConnection: (connection, isMockFallback = false, latencyMs = null) =>
    set({ connection, isMockFallback, latencyMs }),

  setReconnectHandler: (reconnectFeed) => set({ reconnectFeed }),

  // Daftar lengkap menggantikan yang lama. Bila isinya sama, daftar lama tetap
  // dipakai (objek yang sama), jadi pelanggan store tidak digambar ulang.
  applyIncidents: (cards, nowSec) =>
    set((state) => ({
      incidentCards: mergeIncidentCards(state.incidentCards, cards),
      incidentsAt: nowSec,
    })),

  applyTelemetry: (telemetry) => {
    const before = get().telemetry;
    // Alert aktif berganti: penyinkron alert memuat daftarnya sekarang juga.
    if (
      before &&
      alertSignature(before) !== alertSignature(telemetry) &&
      typeof window !== "undefined"
    )
      window.dispatchEvent(new Event(ALERT_EVENTS_SIGNAL));
    set({ telemetry });
  },

  focusMap: (customerId) => set({ mapFocus: { seq: ++focusSeq, customerId } }),

  clearMapFocus: () => set({ mapFocus: null }),

  setLiveMode: (isLive, liveRouters = []) =>
    set({
      customers: isLive ? [] : initialCustomers,
      routers: isLive ? liveRouters : mockRouters,
      onlineCount: 0,
      offlineCount: 0,
      weakSignalCount: 0,
      activeRouterCount: isLive
        ? liveRouters.filter((r) => r.active).length
        : countActiveRouters(mockRouters),
      traffic: { times: [], rx: [], tx: [] },
      connection: isLive
        ? liveRouters.length > 0
          ? "live"
          : "disconnected"
        : "connecting",
      isMockFallback: false,
      incidentCards: isLive ? [] : null,
      incidentsAt: null,
      telemetry: null,
    }),

  setLiveRouters: (liveRouters) =>
    set({
      routers: liveRouters,
      activeRouterCount: liveRouters.filter((r) => r.active).length,
    }),
}));
