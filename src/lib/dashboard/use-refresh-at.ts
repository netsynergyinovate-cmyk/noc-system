"use client";

import { useEffect, useRef } from "react";

// Menjalankan `refresh` sekali saat detik epoch `dueAt` tiba, ditambah jeda
// pendek supaya server sempat mencatat kejadiannya. Dipakai untuk data yang
// berubah pada saat yang diketahui (sinkron billing yang mulai tepat pada
// jamnya) sehingga halaman tidak menunggu penyegaran berkala berikutnya.
//
// Jadwal dibuat ulang hanya bila `dueAt` berganti. Data baru yang memuat waktu
// jatuh tempo yang sama (jam server dan jam browser tidak persis sama) tidak
// menjadwalkan ulang, jadi tidak mungkin berputar tanpa henti; penyegaran
// berkala tetap berjalan seperti biasa. `refresh` boleh berganti tiap render.
export function useRefreshAt(
  dueAt: number | null,
  refresh: () => void,
  graceMs = 1_000,
) {
  const latest = useRef(refresh);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (dueAt === null) return;
    const delay = Math.max(0, dueAt * 1000 - Date.now()) + graceMs;
    const timer = setTimeout(() => latest.current(), delay);
    return () => clearTimeout(timer);
  }, [dueAt, graceMs]);
}
