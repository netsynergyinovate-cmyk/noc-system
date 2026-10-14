// Jam detik yang dipakai bersama: satu timer untuk semua komponen yang
// membutuhkannya, berhenti saat tidak ada yang berlangganan. Dipisah dari React
// supaya bisa diuji dengan timer palsu.

export interface ClockOptions {
  // Detik epoch sekarang.
  now: () => number;
  setTimer: (callback: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
  // Seberapa sering memeriksa pergantian detik. Lebih rapat dari 1 detik supaya
  // detik yang terlewat karena timer terlambat tetap tertangkap.
  intervalMs?: number;
}

export function createClock({
  now,
  setTimer,
  clearTimer,
  intervalMs = 250,
}: ClockOptions) {
  const listeners = new Set<() => void>();
  let current = now();
  let timer: unknown;

  function tick() {
    const next = now();
    if (next === current) return;
    current = next;
    for (const listener of [...listeners]) listener();
  }

  return {
    // Nilai yang sama dikembalikan sampai detiknya berganti (syarat
    // useSyncExternalStore). Tanpa pelanggan, dibaca ulang tiap dipanggil agar
    // tidak basi.
    getSnapshot() {
      if (listeners.size === 0) current = now();
      return current;
    },
    subscribe(listener: () => void) {
      if (listeners.size === 0) {
        current = now();
        timer = setTimer(tick, intervalMs);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearTimer(timer);
          timer = undefined;
        }
      };
    },
    // Hanya untuk test.
    get listenerCount() {
      return listeners.size;
    },
  };
}
