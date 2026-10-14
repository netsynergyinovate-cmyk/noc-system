import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_ROLE, type Permissions } from "./permissions";
import { isPreviewableRole, roleCan } from "./roles";

// Store sesi untuk tampilan: siapa yang masuk, perannya, dan peran tiruan.
// Murni (tanpa React); komponennya ada di components/session-provider.tsx.
//
// Isinya data PER PENGGUNA, jadi tidak boleh ada store tingkat modul (create()
// global): modul di server dipakai bersama oleh semua permintaan, dan satu
// store di sana akan membuat pengguna yang satu melihat data pengguna lain.
// Karena itu hanya ada pabrik createSessionStore. Tiap SessionProvider membuat
// satu store untuk dirinya sendiri, sehingga render server tiap permintaan dan
// tiap tab browser punya store sendiri.
//
// Peran tiruan HANYA mengubah apa yang ditampilkan. Server tetap memeriksa
// peran asli (requirePermission, withApiPermission). Peran tiruan tidak pernah
// dikirim ke server, tidak disimpan (cookie, localStorage), dan tidak boleh
// dipakai untuk keputusan akses.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  // Isi kolom user.role apa adanya: bisa null, kosong, atau daftar dipisah koma.
  role: string | null;
}

export interface SessionState {
  user: SessionUser | null;
  // Mode demo: petugas boleh mencoba tampilan peran lain. Tetap sepanjang umur
  // store (ditentukan server saat halaman dibuat).
  previewEnabled: boolean;
  // Peran tiruan yang sedang dipilih, atau null untuk peran asli.
  previewRole: string | null;
  // Mengganti pengguna (mis. setelah router.refresh()). Bila nilainya sama,
  // state tidak berubah sama sekali dan pelanggan tidak dikabari.
  setUser: (user: SessionUser | null) => void;
  // Memilih peran tiruan; null kembali ke peran asli. Pilihan yang tidak sah
  // diabaikan.
  previewAs: (role: string | null) => void;
}

export type SessionStore = StoreApi<SessionState>;

// Sama menurut nilai. role undefined (dari pemanggil JS) dianggap sama dengan null.
function sameUser(a: SessionUser | null, b: SessionUser | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.email === b.email &&
    (a.role ?? null) === (b.role ?? null)
  );
}

export function createSessionStore(initial: {
  user: SessionUser | null;
  previewEnabled: boolean;
}): SessionStore {
  return createStore<SessionState>()((set) => ({
    user: initial.user,
    previewEnabled: initial.previewEnabled,
    previewRole: null,

    setUser: (next) =>
      set((state) => {
        // Mengembalikan objek state yang sama: zustand tidak memberi tahu siapa pun.
        if (sameUser(state.user, next)) return state;
        // Peran tiruan milik satu akun. Berganti akun (atau keluar) membuangnya,
        // supaya tidak terbawa ke orang lain; akun yang sama tetap memakainya.
        const sameAccount =
          next !== null && state.user !== null && next.id === state.user.id;
        return {
          user: next,
          previewRole: sameAccount ? state.previewRole : null,
        };
      }),

    previewAs: (role) =>
      set((state) => {
        if (!state.previewEnabled || state.user === null) return state;
        if (role !== null && !isPreviewableRole(role)) return state;
        if (role === state.previewRole) return state;
        return { previewRole: role };
      }),
  }));
}

// Selektor murni. Semuanya mengembalikan nilai yang stabil (string, boolean,
// atau objek yang tersimpan di state), jadi aman dipakai langsung dengan useStore.

export const selectUser = (state: SessionState): SessionUser | null =>
  state.user;

export const selectPreviewEnabled = (state: SessionState): boolean =>
  state.previewEnabled;

export const selectPreviewRole = (state: SessionState): string | null =>
  state.previewRole;

export const selectIsPreview = (state: SessionState): boolean =>
  state.previewRole !== null;

// Peran asli akun: isi kolom role, atau peran bawaan bila kosong. Tanpa pengguna: null.
export const selectRealRole = (state: SessionState): string | null =>
  state.user === null ? null : state.user.role || DEFAULT_ROLE;

// Peran yang dipakai untuk tampilan: peran tiruan bila ada, selain itu peran asli.
export const selectRole = (state: SessionState): string | null => {
  const real = selectRealRole(state);
  return real === null ? null : (state.previewRole ?? real);
};

// Apakah tampilan boleh menunjukkan sesuatu yang butuh izin ini. Hanya untuk
// menampilkan atau menyembunyikan UI, bukan pemeriksaan akses.
export const selectCan = (
  state: SessionState,
  permissions: Permissions,
): boolean => {
  const role = selectRole(state);
  return role !== null && roleCan(role, permissions);
};

export const selectDisplayName = (state: SessionState): string | null =>
  state.user === null ? null : state.user.name || state.user.email;
