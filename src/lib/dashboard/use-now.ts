"use client";

import { useSyncExternalStore } from "react";
import { createClock } from "./clock";

const clock = createClock({
  now: () => Math.floor(Date.now() / 1000),
  setTimer: (callback, ms) => setInterval(callback, ms),
  clearTimer: (id) => clearInterval(id as ReturnType<typeof setInterval>),
});

const minuteClock = createClock({
  now: () => Math.floor(Date.now() / 60_000) * 60,
  setTimer: (callback, ms) => setInterval(callback, ms),
  clearTimer: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  intervalMs: 5_000,
});

// Awal menit sekarang (detik epoch), berubah sekali semenit. Untuk tampilan yang
// hanya perlu tahu "hari ini atau bukan", tanpa digambar ulang tiap detik.
export function useNowMinute() {
  return useSyncExternalStore(
    minuteClock.subscribe,
    minuteClock.getSnapshot,
    () => 0,
  );
}

// Detik epoch sekarang, diperbarui tiap detik. Hanya komponen yang memanggilnya
// yang digambar ulang, dan timer-nya mati bila tidak ada yang memakai.
export function useNowSeconds() {
  return useSyncExternalStore(clock.subscribe, clock.getSnapshot, () => 0);
}
