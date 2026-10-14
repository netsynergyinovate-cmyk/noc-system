import {
  DEFAULT_ROLE,
  roles,
  type AppRole,
  type Permissions,
} from "./permissions";

// Membaca peran di sisi tampilan. Murni: tanpa React dan tanpa kode server,
// jadi aman di browser dan bisa diuji langsung dari Node.
//
// Semua yang ada di sini hanya menentukan apa yang DITAMPILKAN. Server tetap
// memeriksa peran asli di setiap batas data (requirePermission, withApiPermission).
// Hasil roleCan tidak boleh dipakai sebagai pemeriksaan akses.

// Nama-nama peran di kolom user.role, persis seperti Better Auth membacanya
// (plugins/admin/has-permission): kosong atau null berarti peran bawaan, dan
// daftar dipisah koma TANPA memangkas spasi, jadi " admin" bukan "admin".
export function roleNames(role: string | null | undefined): string[] {
  return (role || DEFAULT_ROLE).split(",");
}

// Hanya nama yang benar-benar menjadi kunci milik `roles`. Memeriksa lewat
// roles[nama] saja salah untuk nama seperti "constructor" atau "toString":
// objek biasa mewarisinya dari prototipe, sehingga hasilnya bukan undefined.
function isDeclaredRole(name: string): name is AppRole {
  return Object.hasOwn(roles, name);
}

// Apakah peran ini memberi izin yang diminta. Sama dengan
// authClient.admin.checkRolePermission: salah satu peran dalam daftar cukup.
// Nama yang tak dikenal tidak memberi hak apa pun (dan tidak melempar galat);
// selebihnya diserahkan ke authorize milik Better Auth, termasuk untuk {}.
export function roleCan(
  role: string | null | undefined,
  permissions: Permissions,
): boolean {
  return roleNames(role).some(
    (name) =>
      isDeclaredRole(name) && roles[name].authorize(permissions).success,
  );
}

// Nama yang dilihat petugas untuk peran yang dikenal. Peran lain ditulis apa
// adanya. Sengaja Partial: peran baru di permissions.ts tetap tampil dengan
// namanya sendiri sampai ada yang memberinya nama bagus.
const labels: Partial<Record<AppRole, string>> = {
  admin: "Admin",
  user: "Petugas",
};

// Dipakai bila daftar peran tidak memuat satu nama pun (mis. "," atau " ").
const NO_ROLE_LABEL = "Tanpa peran";

// "Admin", "Petugas", atau nama lain apa adanya; daftar koma digabung dengan
// ", " (mis. "Admin, Petugas"). Kosong atau null berarti peran bawaan, jadi
// "Petugas". Potongan kosong di daftar ("admin,") dilewati karena bukan nama.
export function roleLabel(role: string | null | undefined): string {
  const names = roleNames(role).filter((name) => name.trim() !== "");
  if (names.length === 0) return NO_ROLE_LABEL;
  return names
    .map((name) => (isDeclaredRole(name) ? (labels[name] ?? name) : name))
    .join(", ");
}

// Peran yang boleh dipilih sebagai peran tiruan: tepat yang dideklarasikan di
// `roles`. Urutannya tetap, dari hak terbanyak ke paling sedikit (admin lebih
// dulu, lalu user); peran lain yang kelak ditambahkan menyusul sesuai urutan
// deklarasinya di permissions.ts.
const previewOrder: readonly string[] = ["admin", "user"];

export const previewableRoles: readonly AppRole[] = Object.freeze([
  ...previewOrder.filter(isDeclaredRole),
  ...(Object.keys(roles) as AppRole[]).filter(
    (name) => !previewOrder.includes(name),
  ),
]);

// Hanya satu nama peran yang dideklarasikan. Daftar koma ("admin,user"), nama
// yang tak dikenal, dan nama prototipe ("constructor") ditolak.
export function isPreviewableRole(name: unknown): name is AppRole {
  return typeof name === "string" && isDeclaredRole(name);
}
