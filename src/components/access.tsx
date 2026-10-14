"use client";

import type { ReactNode } from "react";
import type { Permissions } from "@/lib/permissions";
import { selectCanDo, type Capability } from "@/lib/access";
import { selectCan } from "@/lib/session-store";
import { useSession } from "./session-provider";

// Kontrol akses per peran untuk TAMPILAN. Menyembunyikan atau menampilkan
// bagian layar menurut peran yang dipakai tampilan (peran tiruan bila "Lihat
// sebagai" dipakai di mode demo). Ini BUKAN pemeriksaan akses: server tetap
// memeriksa peran asli di setiap halaman dan API (requirePermission,
// withApiPermission), dan peran tiruan tidak pernah sampai ke server.
//
// Karena store sesi sudah berisi peran pada render server, bagian yang boleh
// dilihat peran asli sudah ada di HTML dari server, tanpa kedip.

// Selektornya mengembalikan boolean, jadi komponen hanya digambar ulang bila
// jawabannya berubah.
export function useCanDo(capability: Capability): boolean {
  return useSession((state) => selectCanDo(state, capability));
}

// Tepat salah satu dari `to` (nama kemampuan di lib/access.ts, cara yang
// dianjurkan) atau `permissions` (izin sekali pakai); tipenya melarang
// keduanya sekaligus dan tak satu pun.
export type CanProps = {
  children?: ReactNode;
  // Ditampilkan bila tidak boleh. Bawaannya tidak menampilkan apa pun.
  fallback?: ReactNode;
} & (
  | { to: Capability; permissions?: never }
  | { permissions: Permissions; to?: never }
);

// Menampilkan `children` bila peran yang dipakai tampilan punya kemampuan atau
// izin itu, selain itu `fallback`. Tanpa pengguna tidak menampilkan `children`.
export function Can({ to, permissions, children, fallback }: CanProps) {
  const allowed = useSession((state) => {
    if (to !== undefined) return selectCanDo(state, to);
    return permissions !== undefined && selectCan(state, permissions);
  });
  return allowed ? children : (fallback ?? null);
}
