"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createMockAlertHub } from "./alert-sync";
import { useAlertStore } from "./alert-store";
import { planCatchUp } from "./catch-up";
import { TRAFFIC_WINDOW } from "./constants";
import { createMockIncidentHub } from "./incident-sync";
import { connectRealtimeWs } from "./realtime-ws";
import { useDashboardStore } from "./store";
import type { ConnectionStatus, DashboardCustomer, DashboardDelta, DashboardSnapshot } from "./types";
import type { IncidentCard } from "./incident-cards";
import type { Telemetry } from "./telemetry";

// Putus (atau belum tersambung) selama ini, data tiruan dipakai supaya layar
// tidak kosong. Begitu WebSocket hidup lagi, data tiruan dihentikan.
export const FALLBACK_AFTER_MS = 5000;

export interface RealtimeFeedState {
  connectionStatus: ConnectionStatus;
  isMockFallback: boolean;
  latencyMs: number | null;
  lastUpdateAt: number | null;
  isPaused: boolean;
}

export const initialFeedState: RealtimeFeedState = {
  connectionStatus: "connecting",
  isMockFallback: false,
  latencyMs: null,
  lastUpdateAt: null,
  isPaused: false,
};

// Semua yang disentuh engine masuk lewat sini, jadi bisa diuji tanpa React,
// tanpa store sungguhan, dan tanpa jam sungguhan.
export interface FeedDeps {
  nowMs: () => number;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  connect: typeof connectRealtimeWs;
  createIncidentHub: typeof createMockIncidentHub;
  createAlertHub: typeof createMockAlertHub;
  dash: () => {
    customers: DashboardCustomer[];
    applySnapshot: (s: DashboardSnapshot, t: number) => void;
    applyDelta: (d: DashboardDelta, t: number) => void;
    applyIncidents: (i: IncidentCard[], t: number) => void;
    setConnection: (c: ConnectionStatus) => void;
    applyTelemetry?: (t: Telemetry) => void;
  };
  alerts: () => {
    applySnapshot: (s: any, t: number) => void;
    applyMessage: (m: any, t: number) => void;
    prune: (t: number) => void;
    reset: () => void;
  };
}

export const defaultFeedDeps = (): FeedDeps => ({
  nowMs: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
  connect: connectRealtimeWs,
  createIncidentHub: createMockIncidentHub,
  createAlertHub: createMockAlertHub,
  dash: () => useDashboardStore.getState(),
  alerts: () => useAlertStore.getState(),
});

export interface FeedEngineOptions {
  // true: tanpa WebSocket, hanya data tiruan (mode demo).
  forceMock: boolean;
  // false: dilarang jatuh ke data tiruan saat mode live
  allowFallback?: boolean;
  onState: (state: RealtimeFeedState) => void;
  deps?: FeedDeps;
}

export function createRealtimeFeedEngine(options: FeedEngineOptions) {
  const d = options.deps ?? defaultFeedDeps();
  let state: RealtimeFeedState = { ...initialFeedState };
  const set = (patch: Partial<RealtimeFeedState>) => {
    state = { ...state, ...patch };
    options.onState(state);
  };
  const sec = () => Math.floor(d.nowMs() / 1000);

  let running = false;
  let ws: { close: () => void } | null = null;
  let timer: unknown = null;
  let fallbackTimer: unknown = null;
  const feed = null;
  let last = 0;
  let incidents: ReturnType<typeof createMockIncidentHub>;
  let alertHub: ReturnType<typeof createMockAlertHub>;

  // Data yang masuk dicatat: waktu terakhir dan selisih dengan jam server.
  const touch = (latencyMs: number) =>
    set({
      lastUpdateAt: d.nowMs(),
      latencyMs: Math.max(0, Math.round(latencyMs)),
    });

  const measure = (time: number) => touch(d.nowMs() - time * 1000);

  const startMock = () => {};
  const stopMock = () => {};

  const cancelFallback = () => {
    if (fallbackTimer !== null) d.clearTimeout(fallbackTimer);
    fallbackTimer = null;
  };
  const armFallback = () => {
    if (options.allowFallback === false) return;
    if (feed || fallbackTimer !== null || !running) return;
    fallbackTimer = d.setTimeout(() => {
      fallbackTimer = null;
      startMock();
    }, FALLBACK_AFTER_MS);
  };

  let gen = 0;
  const openWs = () => {
    armFallback();
    const id = ++gen;
    const conn = d.connect({
      onSnapshot: (snapshot, time) => {
        if (id !== gen) return;
        cancelFallback();
        stopMock();
        d.dash().applySnapshot(snapshot, time);
        set({ isMockFallback: false });
        measure(time);
      },
      onDelta: (delta, time) => {
        if (id !== gen || state.isPaused) return;
        d.dash().applyDelta(delta, time);
        measure(time);
      },
      onAlerts: (alertsMsg, time) => {
        if (id !== gen || state.isPaused) return;
        d.alerts().applyMessage(alertsMsg, time);
        measure(time);
      },
      onIncidents: (cards, time) => {
        if (id !== gen || state.isPaused) return;
        d.dash().applyIncidents(cards, time);
        measure(time);
      },
      onTelemetry: (telemetry) => {
        if (id !== gen || state.isPaused) return;
        d.dash().applyTelemetry?.(telemetry);
      },
      onStatusChange: (status) => {
        if (id !== gen) return;
        if (status === "live") cancelFallback();
        else armFallback();
        // Saat data tiruan berjalan, layar tetap "live" olehnya.
        if (!feed) {
          d.dash().setConnection(status);
          set({ connectionStatus: status });
        }
      },
      fallbackToMock: armFallback,
    });
    ws = conn;
  };

  const tick = () => {
    const now = sec();
    const dash = d.dash();
    const alerts = d.alerts();
    // Jeda: tidak ada yang didorong ke store. `lastFeed`/`last` dibiarkan,
    // jadi saat lanjut, celah diisi atau disinkronkan ulang.
    if (state.isPaused) return;

    if (options.allowFallback ?? true) {
      if (planCatchUp(last, now, TRAFFIC_WINDOW).kind === "resync") {
        dash.applyIncidents(incidents.snapshot(now), now);
        alerts.applySnapshot(alertHub.snapshot(now), now);
      }
      // Hanya bila isinya berubah; kebanyakan detik tidak mengirim apa-apa.
      const changed = incidents.changes(now);
      if (changed) dash.applyIncidents(changed, now);
      const alertMessage = alertHub.changes(now);
      if (alertMessage) alerts.applyMessage(alertMessage, now);
      // Riwayat yang sudah lewat jendelanya dibuang walau tidak ada pesan.
      alerts.prune(now);
    }
    last = now;
  };

  const connectSources = () => {
    if (options.forceMock) startMock();
    else openWs();
  };

  return {
    getState: () => state,
    tick,
    start() {
      if (running) return;
      running = true;
      last = sec();
      if (options.allowFallback ?? true) {
        incidents = d.createIncidentHub();
        alertHub = d.createAlertHub();
        d.dash().applyIncidents(incidents.snapshot(last), last);
        d.alerts().applySnapshot(alertHub.snapshot(last), last);
      } else {
        d.dash().applyIncidents([], last);
        d.alerts().applySnapshot({ active: [], resolved: [] }, last);
      }
      connectSources();
      timer = d.setInterval(tick, 1000);
    },
    stop() {
      if (!running) return;
      running = false;
      if (timer !== null) d.clearInterval(timer);
      timer = null;
      cancelFallback();
      gen++;
      ws?.close();
      ws = null;
      stopMock();
      d.dash().setConnection("disconnected");
      d.alerts().reset();
    },
    pause() {
      if (!state.isPaused) set({ isPaused: true });
    },
    resume() {
      if (state.isPaused) set({ isPaused: false });
    },
    // Putus sumber lama lalu sambung lagi; tiket WebSocket diambil ulang.
    reconnect() {
      if (!running) return;
      cancelFallback();
      gen++;
      ws?.close();
      ws = null;
      stopMock();
      set({ connectionStatus: "connecting", isMockFallback: false });
      d.dash().setConnection("connecting");
      connectSources();
    },
  };
}

export function useRealtimeFeed(options?: {
  enabled?: boolean;
  forceMock?: boolean;
  allowFallback?: boolean;
}) {
  const enabled = options?.enabled ?? true;
  const forceMock = options?.forceMock ?? false;
  const allowFallback = options?.allowFallback ?? true;
  const [state, setState] = useState<RealtimeFeedState>(initialFeedState);
  const engineRef = useRef<ReturnType<typeof createRealtimeFeedEngine> | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return;
    const engine = createRealtimeFeedEngine({
      forceMock,
      allowFallback,
      onState: setState,
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [enabled, forceMock, allowFallback]);

  const pause = useCallback(() => engineRef.current?.pause(), []);
  const resume = useCallback(() => engineRef.current?.resume(), []);
  const reconnect = useCallback(() => engineRef.current?.reconnect(), []);

  return { ...state, pause, resume, reconnect };
}
