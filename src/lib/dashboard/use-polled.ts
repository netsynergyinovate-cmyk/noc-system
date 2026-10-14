"use client";

import { useEffect, useState } from "react";

export interface Polled<T> {
  data: T;
  // Detik epoch saat data ini diminta; dipakai untuk menghitung "sudah berapa lama".
  now: number;
}

// Memuat data lewat `load` lalu menyegarkannya tiap `intervalMs`. Gagal memuat
// tidak menghapus data terakhir yang berhasil; `failed` hanya memberi tahu. Waktu
// ditampilkan di zona waktu browser, jadi pemakainya baru menggambar daftar
// setelah dimuat di browser. `load` harus tetap (fungsi modul), bukan fungsi
// yang dibuat ulang tiap render.
export function usePolled<T>(
  load: (nowSec: number) => Promise<T>,
  intervalMs: number,
) {
  const [state, setState] = useState<Polled<T> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      const now = Math.floor(Date.now() / 1000);
      load(now).then(
        (data) => {
          if (cancelled) return;
          setState({ data, now });
          setFailed(false);
        },
        () => {
          if (!cancelled) setFailed(true);
        },
      );
    };
    refresh();
    const timer = setInterval(refresh, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [load, intervalMs, attempt]);

  return { state, failed, retry: () => setAttempt((value) => value + 1) };
}
