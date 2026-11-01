import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

// Every resource an action can target. `defaultStatements` covers Better Auth's
// own user and session management; add a key per resource your app owns.
// Name actions for what they let someone do to *other people's* rows: owners
// already reach their own data through the session, so a role only has to grant
// the extra reach. Add a resource here first, then give roles a subset below.
export const statement = {
  ...defaultStatements,
  notes: ["read-any", "delete-any"],
  cpe: ["manage"],
  // Mengubah data jaringan. Peran hanya-lihat (`user`) tidak boleh satu pun:
  // - router:manage  menambah router dan mencoba koneksinya (POST /api/routers
  //   dan /api/routers/test; yang kedua membuat server menghubungi host yang
  //   disebut pemanggil, jadi tidak boleh terbuka bagi akun biasa).
  // - alert:handle   menandai alert ditangani. Izin ini ikut dalam tiket
  //   realtime (`perms`) supaya backend Go bisa menolak POST dari peran
  //   hanya-lihat tanpa menanyakan sesi Better Auth.
  router: ["manage"],
  alert: ["handle"],
  // Mengubah ambang alert (PUT/DELETE /api/thresholds). Membaca terbuka bagi
  // semua sesi login.
  threshold: ["manage"],
  // Membaca jejak aktivitas (GET /api/audit).
  audit: ["read"],
  // Mengatur kredensial scraper billing (URL portal, akun, kata sandi).
  billing: ["manage"],
  // Membuat dan mencabut API key untuk aplikasi luar (/api/api-keys).
  apiKey: ["manage"],
  // Mengubah peta jaringan /app/peta (perangkat, jalur kabel, anotasi, koreksi lokasi).
  map: ["manage"],
  // Operasi server: ganti mode demo/live (menulis .env.local), transfer data
  // antar-database, seed, cadangan/rollback/health deploy, dan benchmark.
  system: ["manage"],
} as const;

export const ac = createAccessControl(statement);

// A role is a subset of the statement. Keep `user` deliberately empty: the
// signed-in default should be able to do nothing beyond its own records, and
// everything that changes data is a separate action it does not hold.
export const roles = {
  user: ac.newRole({
    notes: [],
    cpe: [],
    router: [],
    alert: [],
    threshold: [],
    billing: [],
    apiKey: [],
    map: [],
    system: [],
    audit: ["read"],
    user: [],
    session: [],
  }),
  developer: ac.newRole({
    ...adminAc.statements,
    notes: ["read-any", "delete-any"],
    cpe: ["manage"],
    router: ["manage"],
    alert: ["handle"],
    threshold: ["manage"],
    billing: ["manage"],
    apiKey: ["manage"],
    map: ["manage"],
    system: ["manage"],
    audit: ["read"],
  }),
  admin: ac.newRole({
    notes: ["read-any", "delete-any"],
    cpe: ["manage"],
    router: ["manage"],
    alert: ["handle"],
    threshold: ["manage"],
    billing: ["manage"],
    apiKey: ["manage"],
    map: ["manage"],
    system: ["manage"],
    audit: ["read"],
    user: [],
    session: [],
  }),
  superadmin: ac.newRole({
    ...adminAc.statements,
    notes: ["read-any", "delete-any"],
    cpe: ["manage"],
    router: ["manage"],
    alert: ["handle"],
    threshold: ["manage"],
    billing: ["manage"],
    apiKey: ["manage"],
    map: ["manage"],
    system: ["manage"],
    audit: ["read"],
  }),
} as const;

export type AppRole = keyof typeof roles;

// Roles live in the `user.role` column as a string. Better Auth reads a
// comma-separated list, so "admin,support" grants the union of both.
export const DEFAULT_ROLE = "user" satisfies AppRole;
export const ADMIN_ROLES = ["superadmin", "developer"] satisfies AppRole[];
// The shape accepted by permission checks, e.g. { notes: ["read-any"] }.
export type Permissions = Partial<{
  [Resource in keyof typeof statement]: (typeof statement)[Resource][number][];
}>;
