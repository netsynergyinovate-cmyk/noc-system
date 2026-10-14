"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useStore } from "zustand";
import type { Permissions } from "@/lib/permissions";
import {
  createSessionStore,
  selectCan,
  selectIsPreview,
  selectRole,
  selectUser,
  type SessionState,
  type SessionStore,
  type SessionUser,
} from "@/lib/session-store";

// Satu store per provider, disebar lewat context. Bukan store tingkat modul:
// modul di server dipakai bersama oleh semua permintaan, dan store bersama di
// sana akan membocorkan data satu pengguna ke pengguna lain (lihat
// lib/session-store.ts). Di sini setiap render server dan setiap tab browser
// membuat storenya sendiri.
const SessionContext = createContext<SessionStore | null>(null);

// Dipasang sekali di layout terlindungi dengan pengguna dari sesi asli.
// `previewEnabled` hanya dibaca saat store dibuat.
export function SessionProvider({
  user,
  previewEnabled,
  children,
}: {
  user: SessionUser;
  previewEnabled: boolean;
  children: ReactNode;
}) {
  // useState, bukan useRef atau efek: store sudah ada pada render pertama (juga
  // di server), dan hanya dibuat sekali walau komponen digambar ulang.
  const [store] = useState(() => createSessionStore({ user, previewEnabled }));

  // Layout tidak dipasang ulang pada router.refresh(); hanya propnya yang baru.
  // Dependensi berupa nilai (bukan objek user) supaya efek hanya jalan bila
  // isinya berubah. Nilai yang sama tidak mengubah store (lihat setUser).
  const { id, name, email, role } = user;
  useEffect(() => {
    store.getState().setUser({ id, name, email, role });
  }, [store, id, name, email, role]);

  return <SessionContext value={store}>{children}</SessionContext>;
}

function useSessionStore(): SessionStore {
  const store = useContext(SessionContext);
  if (store === null) {
    throw new Error(
      "Hook sesi harus dipakai di dalam <SessionProvider> (layout terlindungi).",
    );
  }
  return store;
}

// Membaca sebagian state. Selektor harus mengembalikan nilai yang stabil
// (string, boolean, atau objek dari state), bukan objek baru tiap dipanggil.
export function useSession<T>(selector: (state: SessionState) => T): T {
  return useStore(useSessionStore(), selector);
}

export function useSessionUser(): SessionUser | null {
  return useSession(selectUser);
}

// Peran yang dipakai untuk tampilan (peran tiruan bila ada), atau null tanpa pengguna.
export function useRole(): string | null {
  return useSession(selectRole);
}

export function useIsPreview(): boolean {
  return useSession(selectIsPreview);
}

// Apakah tampilan boleh menunjukkan sesuatu yang butuh izin ini. Hanya untuk
// menyembunyikan atau menampilkan UI: server tetap memeriksa peran asli.
// Selektornya mengembalikan boolean, jadi tidak ada penggambaran ulang yang sia-sia.
export function useCan(permissions: Permissions): boolean {
  return useSession((state) => selectCan(state, permissions));
}

// Aksi store. Objeknya stabil antar-render.
export function useSessionActions() {
  const store = useSessionStore();
  return useMemo(() => ({ previewAs: store.getState().previewAs }), [store]);
}
