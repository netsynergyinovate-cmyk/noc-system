"use client";

import { useEffect } from "react";
import { listenForSignedOut, SIGNED_OUT_PATH } from "@/lib/signed-out";

// Dipasang di layout terlindungi, jadi aktif di semua halaman terlindungi
// (aplikasi, setup, admin). Bila petugas keluar di tab lain, tab ini ikut
// dipindahkan ke halaman masuk dengan MUAT ULANG PENUH, bukan navigasi di dalam
// aplikasi: seluruh memori klien (store modul, cache router, peran tiruan)
// dibuang bersama dokumennya. Tab yang menekan "Keluar" sendiri tidak menerima
// pesannya; tombolnya berpindah sendiri (lihat sign-out-button.tsx).
export function SessionSync() {
  useEffect(
    () =>
      listenForSignedOut(() => {
        window.location.assign(SIGNED_OUT_PATH);
      }),
    [],
  );
  return null;
}
