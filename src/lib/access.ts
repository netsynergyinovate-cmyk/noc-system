import type { Permissions } from "./permissions";
import { selectCan, type SessionState } from "./session-store";

// Kontrol akses per peran untuk TAMPILAN: satu tempat yang memberi nama pada
// kemampuan yang menentukan apakah sebuah bagian layar ditunjukkan, lalu
// memetakannya ke izin di permissions.ts. Murni (tanpa React dan tanpa kode
// server); komponennya ada di components/access.tsx.
//
// Semua yang ada di sini hanya menentukan apa yang DITAMPILKAN. Server tetap
// memeriksa peran asli di setiap halaman dan API (requirePermission,
// withApiPermission). Menyembunyikan tombol atau tautan bukan pemeriksaan
// akses; ia hanya menghemat petugas dari tombol yang pasti ditolak server.
//
// Kemampuan baru (menandai alert, mengelola router, dan seterusnya) ditambahkan
// di sini SESUDAH resource dan aksinya ada di permissions.ts (dan dijaga di
// server). Komponen merujuk NAMA kemampuan, bukan objek izin mentah, supaya
// kebijakan tampilan berubah di satu tempat dan tesnya (e2e/access.spec.ts)
// memaksa perubahan itu disengaja.
const table = {
  // Tautan "Buka admin". Sama dengan izin yang dijaga halaman /admin dan
  // GET /api/admin/notes.
  adminArea: { notes: ["read-any"] },
  // Mengubah data CPE pelanggan.
  manageCpe: { cpe: ["manage"] },
  // Mengubah ambang alert (tab "Ambang Batas").
  manageThresholds: { threshold: ["manage"] },
  // Membuka halaman Jejak Aktivitas.
  viewAuditLog: { audit: ["read"] },
  // Mengatur kredensial scraper billing.
  manageBilling: { billing: ["manage"] },
  // Mengelola pengguna dan peran akun (khusus Super Admin).
  manageUsers: { user: ["set-role"] },
  // Mengakses menu deploy server (Khusus peran Developer saja).
  manageDeploy: { deploy: ["manage"] },
} as const satisfies Record<string, Permissions>;

// Dibekukan sampai ke dalam daftar aksinya: kode lain yang mengimpor tabel ini
// tidak bisa mengubah kebijakan tampilan diam-diam.
for (const permissions of Object.values(table)) {
  for (const actions of Object.values(permissions)) Object.freeze(actions);
  Object.freeze(permissions);
}
export const capabilities = Object.freeze(table);

export type Capability = keyof typeof capabilities;

export function isCapability(name: unknown): name is Capability {
  return typeof name === "string" && Object.hasOwn(capabilities, name);
}

// Izin di balik sebuah kemampuan, sebagai salinan yang boleh diubah pemanggil
// tanpa memengaruhi tabel di atas.
export function capabilityPermissions(capability: Capability): Permissions {
  return Object.fromEntries(
    Object.entries(capabilities[capability]).map(([resource, actions]) => [
      resource,
      [...actions],
    ]),
  ) as Permissions;
}

// Apakah tampilan boleh menunjukkan sesuatu yang butuh kemampuan ini, menurut
// peran yang dipakai tampilan (peran tiruan bila ada). Nama yang bukan
// kemampuan (pemanggil JS) ditolak, bukan dilempar.
export const selectCanDo = (
  state: SessionState,
  capability: Capability,
): boolean =>
  isCapability(capability) && selectCan(state, capabilities[capability]);
