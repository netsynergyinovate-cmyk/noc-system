import { expect, test } from "@playwright/test";
import { adminClient } from "better-auth/client/plugins";
import { ac, roles, statement, type Permissions } from "../src/lib/permissions";
import {
  isPreviewableRole,
  previewableRoles,
  roleCan,
  roleLabel,
  roleNames,
} from "../src/lib/roles";
import * as sessionStoreModule from "../src/lib/session-store";
import {
  createSessionStore,
  selectCan,
  selectDisplayName,
  selectIsPreview,
  selectPreviewEnabled,
  selectPreviewRole,
  selectRealRole,
  selectRole,
  selectUser,
  type SessionState,
  type SessionUser,
} from "../src/lib/session-store";

// Peran dan store sesi untuk tampilan, tanpa browser: roleCan harus sama dengan
// pemeriksaan Better Auth yang dipakai server, nama prototipe tidak boleh memberi
// hak atau melempar galat, store tidak boleh memberi tahu pelanggan bila tidak
// ada yang berubah, peran tiruan tidak terbawa ke akun lain, dan urutan acak
// langkah dibandingkan dengan model acuan yang ditulis terpisah.

// Pembanding: pemeriksaan klien Better Auth, dengan akses dan peran yang sama
// dengan yang dipasang di src/lib/auth-client.ts.
const checkRolePermission = adminClient({ ac, roles }).getActions().admin
  .checkRolePermission;
const betterAuthCan = (
  role: string | null | undefined,
  permissions: Permissions,
) => checkRolePermission({ role: role as "user", permissions });

// Setiap pasangan sumber:aksi dari statement, satu per satu...
const singlePermissions: Permissions[] = (
  Object.entries(statement) as Array<[string, readonly string[]]>
).flatMap(([resource, actions]) =>
  actions.map((action) => ({ [resource]: [action] }) as Permissions),
);
// ...ditambah gabungan, termasuk yang kosong dan yang sebagian ditolak admin.
const mixedPermissions: Permissions[] = [
  {},
  { notes: [] },
  { notes: ["read-any", "delete-any"] },
  { notes: ["read-any"], cpe: ["manage"] },
  { notes: ["read-any"], user: ["impersonate-admins"] },
  { user: ["list", "ban"], session: ["list", "revoke"] },
  { cpe: ["manage"], user: ["list"], notes: ["delete-any"] },
];
const allPermissions = [...singlePermissions, ...mixedPermissions];

const compared: Array<string | null | undefined> = [
  undefined,
  null,
  "",
  "user",
  "admin",
  "admin,user",
  "user,admin",
  "nope",
  "admin,nope",
  "ADMIN",
  " admin",
  "admin,",
  ",",
];

// Nama yang kebetulan properti prototipe objek biasa.
const prototypeNames = [
  "constructor",
  "toString",
  "__proto__",
  "hasOwnProperty",
  "valueOf",
  "isPrototypeOf",
  "toLocaleString",
  "propertyIsEnumerable",
];

const manage: Permissions = { cpe: ["manage"] };
const readAny: Permissions = { notes: ["read-any"] };
const deleteAny: Permissions = { notes: ["delete-any"] };

// ---------------------------------------------------------------------------
// roleCan
// ---------------------------------------------------------------------------

test.describe("roleCan sama dengan pemeriksaan Better Auth", () => {
  test("daftar pembanding memuat jawaban ya dan tidak (bukan semuanya sama)", () => {
    expect(singlePermissions.length).toBe(
      Object.values(statement).reduce(
        (sum, actions) => sum + actions.length,
        0,
      ),
    );
    const answers = new Set(
      compared.flatMap((role) =>
        allPermissions.map((permissions) => betterAuthCan(role, permissions)),
      ),
    );
    expect(answers).toEqual(new Set([true, false]));
  });

  for (const role of compared) {
    test(`peran ${JSON.stringify(role)}: sama untuk semua ${allPermissions.length} izin`, () => {
      for (const permissions of allPermissions) {
        expect(
          roleCan(role, permissions),
          `${JSON.stringify(role)} dengan ${JSON.stringify(permissions)}`,
        ).toBe(betterAuthCan(role, permissions));
      }
    });
  }
});

test.describe("nama prototipe", () => {
  test("tidak memberi hak apa pun dan tidak melempar galat", () => {
    for (const name of prototypeNames) {
      for (const permissions of allPermissions) {
        expect(
          () => roleCan(name, permissions),
          `${name} dengan ${JSON.stringify(permissions)}`,
        ).not.toThrow();
        expect(roleCan(name, permissions), name).toBe(false);
      }
    }
  });

  test("di daftar koma hanya nama yang dikenal yang menentukan", () => {
    for (const name of prototypeNames) {
      for (const permissions of allPermissions) {
        const label = `${name} dengan ${JSON.stringify(permissions)}`;
        expect(roleCan(`admin,${name}`, permissions), label).toBe(
          roleCan("admin", permissions),
        );
        expect(roleCan(`${name},admin`, permissions), label).toBe(
          roleCan("admin", permissions),
        );
        expect(roleCan(`constructor,${name},user`, permissions), label).toBe(
          roleCan("user", permissions),
        );
        expect(roleCan(`${name},user`, permissions), label).toBe(
          roleCan("user", permissions),
        );
      }
    }
    // Hak admin memang ada di sana, jadi kesamaan di atas bukan "semuanya false".
    expect(roleCan("admin,constructor", readAny)).toBe(true);
    expect(roleCan("constructor,user", readAny)).toBe(false);
  });

  test("nama prototipe tidak dikenali sebagai peran yang bisa dipilih atau diberi nama bagus", () => {
    for (const name of prototypeNames) {
      expect(isPreviewableRole(name), name).toBe(false);
      expect(roleLabel(name), name).toBe(name);
    }
    expect(roleLabel("toString,admin")).toBe("toString, Admin");
  });
});

test.describe("makna izin", () => {
  test("user tidak punya cpe: manage dan notes: read-any; admin punya", () => {
    for (const permissions of [manage, readAny, deleteAny]) {
      expect(roleCan("user", permissions)).toBe(false);
      expect(roleCan("admin", permissions)).toBe(true);
    }
    expect(roleCan("admin", { notes: ["read-any"], cpe: ["manage"] })).toBe(
      true,
    );
    expect(roleCan("user", { notes: ["read-any"], cpe: ["manage"] })).toBe(
      false,
    );
  });

  test("daftar koma adalah gabungan peran, urutan tidak berpengaruh", () => {
    for (const role of ["admin,user", "user,admin", "user,user,admin"]) {
      expect(roleCan(role, manage), role).toBe(true);
      expect(roleCan(role, readAny), role).toBe(true);
    }
    expect(roleCan("user,user", manage)).toBe(false);
  });

  test("peran kosong atau null memakai peran bawaan (user)", () => {
    for (const role of [undefined, null, ""]) {
      expect(roleNames(role)).toEqual(["user"]);
      expect(roleCan(role, manage)).toBe(false);
      expect(roleCan(role, readAny)).toBe(false);
    }
  });

  test("peran tak dikenal tidak memberi hak; nama dibaca persis seperti Better Auth (tanpa pangkas, beda huruf besar)", () => {
    for (const role of ["nope", "ADMIN", "Admin", " admin", "admin ", ","]) {
      expect(roleCan(role, manage), JSON.stringify(role)).toBe(false);
    }
    expect(roleNames("admin, user")).toEqual(["admin", " user"]);
    expect(roleCan("admin, user", manage)).toBe(true); // admin menang
    expect(roleCan("support, user", manage)).toBe(false);
    expect(roleCan("support,admin", manage)).toBe(true);
  });

  test("izin {} dan aksi kosong tidak pernah diberikan, bahkan untuk admin", () => {
    for (const role of ["admin", "user", "admin,user", null]) {
      expect(roleCan(role, {})).toBe(false);
      expect(roleCan(role, { notes: [] })).toBe(false);
    }
  });

  test("admin tidak mendapat impersonate-admins; gabungan dengan satu yang ditolak ditolak seluruhnya", () => {
    expect(roleCan("admin", { user: ["impersonate"] })).toBe(true);
    expect(roleCan("admin", { user: ["impersonate-admins"] })).toBe(false);
    expect(
      roleCan("admin", {
        notes: ["read-any"],
        user: ["impersonate-admins"],
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Nama peran
// ---------------------------------------------------------------------------

test.describe("nama peran", () => {
  test("roleLabel: Admin, Petugas, nama lain apa adanya, daftar digabung dengan koma", () => {
    expect(roleLabel("admin")).toBe("Admin");
    expect(roleLabel("user")).toBe("Petugas");
    expect(roleLabel("support")).toBe("support");
    expect(roleLabel("admin,user")).toBe("Admin, Petugas");
    expect(roleLabel("user,admin")).toBe("Petugas, Admin");
    expect(roleLabel("admin,support")).toBe("Admin, support");
    expect(roleLabel("support,billing")).toBe("support, billing");
  });

  test("roleLabel: kosong atau null berarti peran bawaan, Petugas", () => {
    expect(roleLabel(null)).toBe("Petugas");
    expect(roleLabel(undefined)).toBe("Petugas");
    expect(roleLabel("")).toBe("Petugas");
  });

  test("roleLabel: nama yang tidak persis sama tidak diberi nama bagus", () => {
    expect(roleLabel("ADMIN")).toBe("ADMIN");
    expect(roleLabel("Admin")).toBe("Admin"); // apa adanya (kebetulan sama)
    expect(roleLabel(" admin")).toBe(" admin");
  });

  test("roleLabel: potongan kosong dilewati; tanpa satu nama pun jadi Tanpa peran", () => {
    expect(roleLabel("admin,")).toBe("Admin");
    expect(roleLabel(",user")).toBe("Petugas");
    expect(roleLabel("admin,,user")).toBe("Admin, Petugas");
    expect(roleLabel(",")).toBe("Tanpa peran");
    expect(roleLabel(" ")).toBe("Tanpa peran");
  });

  test("previewableRoles: tepat peran yang dideklarasikan, superadmin dulu, lalu admin, lalu user, tidak bisa diubah", () => {
    expect([...previewableRoles]).toEqual(["superadmin", "admin", "user"]);
    expect([...previewableRoles].sort()).toEqual(Object.keys(roles).sort());
    expect(Object.isFrozen(previewableRoles)).toBe(true);
    expect(new Set(previewableRoles).size).toBe(previewableRoles.length);
  });

  test("isPreviewableRole: hanya satu nama yang dideklarasikan", () => {
    expect(isPreviewableRole("superadmin")).toBe(true);
    expect(isPreviewableRole("admin")).toBe(true);
    expect(isPreviewableRole("user")).toBe(true);
    for (const name of [
      "admin,user",
      "user,admin",
      "admin,",
      "",
      " ",
      "nope",
      "ADMIN",
      "Admin",
      " admin",
      "admin ",
      "support",
    ]) {
      expect(isPreviewableRole(name), JSON.stringify(name)).toBe(false);
    }
    for (const value of [
      null,
      undefined,
      1,
      true,
      {},
      ["admin"],
      Symbol("x"),
    ]) {
      expect(isPreviewableRole(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const ana: SessionUser = {
  id: "user-ana",
  name: "Ana",
  email: "ana@example.com",
  role: null,
};
const budi: SessionUser = {
  id: "user-budi",
  name: "Budi",
  email: "budi@example.com",
  role: "admin",
};

// Menghitung berapa kali pelanggan dikabari.
function watch(store: ReturnType<typeof createSessionStore>) {
  const seen: Array<{ state: SessionState; previous: SessionState }> = [];
  store.subscribe((state, previous) => seen.push({ state, previous }));
  return seen;
}

test.describe("store sesi", () => {
  test("awalnya dari pengguna dan mode yang diberikan, tanpa peran tiruan", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    const state = store.getState();
    expect(state.user).toBe(ana);
    expect(state.previewEnabled).toBe(true);
    expect(state.previewRole).toBeNull();
    const live = createSessionStore({ user: budi, previewEnabled: false });
    expect(live.getState().previewEnabled).toBe(false);
    expect(live.getState().user).toEqual(budi);
    const empty = createSessionStore({ user: null, previewEnabled: true });
    expect(empty.getState().user).toBeNull();
  });

  test("dua store tidak berbagi apa pun", () => {
    const first = createSessionStore({ user: ana, previewEnabled: true });
    const second = createSessionStore({ user: ana, previewEnabled: true });
    first.getState().previewAs("admin");
    expect(first.getState().previewRole).toBe("admin");
    expect(second.getState().previewRole).toBeNull();
    second.getState().setUser(budi);
    expect(first.getState().user).toBe(ana);
  });

  test("modul tidak mengekspor store: hanya pabrik dan fungsi", () => {
    // Store tingkat modul akan dipakai bersama semua permintaan di server dan
    // membocorkan data satu pengguna ke pengguna lain.
    const exported = Object.entries(sessionStoreModule);
    expect(exported.length).toBeGreaterThan(5);
    for (const [name, value] of exported) {
      expect(typeof value, `ekspor ${name}`).toBe("function");
    }
    expect(typeof sessionStoreModule.createSessionStore).toBe("function");
  });

  test("setUser dengan nilai yang sama tidak mengabari pelanggan dan tidak mengganti state", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    store.getState().previewAs("admin");
    const seen = watch(store);
    const before = store.getState();
    store.getState().setUser({ ...ana });
    expect(seen).toHaveLength(0);
    expect(store.getState()).toBe(before);
    // role undefined (dari pemanggil JS) sama dengan null.
    store.getState().setUser({ ...ana, role: undefined as unknown as null });
    expect(seen).toHaveLength(0);
    expect(store.getState()).toBe(before);
    // Begitu pula tanpa pengguna di kedua sisi.
    const empty = createSessionStore({ user: null, previewEnabled: true });
    const emptySeen = watch(empty);
    const emptyBefore = empty.getState();
    empty.getState().setUser(null);
    expect(emptySeen).toHaveLength(0);
    expect(empty.getState()).toBe(emptyBefore);
  });

  test("setUser dengan nilai berbeda mengabari sekali; akun yang sama mempertahankan peran tiruan", () => {
    const changes: Array<Partial<SessionUser>> = [
      { name: "Ana Baru" },
      { email: "ana.baru@example.com" },
      { role: "admin" },
      { role: "" },
    ];
    for (const change of changes) {
      const store = createSessionStore({ user: ana, previewEnabled: true });
      store.getState().previewAs("admin");
      const seen = watch(store);
      store.getState().setUser({ ...ana, ...change });
      expect(seen, JSON.stringify(change)).toHaveLength(1);
      expect(store.getState().user).toEqual({ ...ana, ...change });
      expect(store.getState().previewRole, JSON.stringify(change)).toBe(
        "admin",
      );
    }
  });

  test("setUser dengan id berbeda membuang peran tiruan", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    store.getState().previewAs("admin");
    expect(store.getState().previewRole).toBe("admin");
    const seen = watch(store);
    store.getState().setUser(budi);
    expect(seen).toHaveLength(1);
    expect(store.getState().user).toBe(budi);
    expect(store.getState().previewRole).toBeNull();
    // Perubahan itu satu pembaruan: tidak pernah ada akun baru dengan peran lama.
    expect(seen[0].state.previewRole).toBeNull();
    expect(seen[0].state.user).toBe(budi);
    expect(selectIsPreview(store.getState())).toBe(false);
  });

  test("setUser(null) membuang peran tiruan, dan pengguna berikutnya tidak mewarisinya", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    store.getState().previewAs("admin");
    store.getState().setUser(null);
    expect(store.getState().user).toBeNull();
    expect(store.getState().previewRole).toBeNull();
    store.getState().setUser(ana);
    expect(store.getState().user).toBe(ana);
    expect(store.getState().previewRole).toBeNull();
    // Akun yang sama kembali setelah keluar pun mulai dari peran asli.
    expect(selectRole(store.getState())).toBe("user");
  });

  test("previewAs diabaikan bila mode demo mati", () => {
    const store = createSessionStore({ user: ana, previewEnabled: false });
    const seen = watch(store);
    const before = store.getState();
    for (const role of ["admin", "user", null, "nope"]) {
      store.getState().previewAs(role);
    }
    expect(seen).toHaveLength(0);
    expect(store.getState()).toBe(before);
    expect(store.getState().previewRole).toBeNull();
    expect(selectRole(store.getState())).toBe("user");
    expect(selectCan(store.getState(), manage)).toBe(false);
  });

  test("previewAs diabaikan tanpa pengguna", () => {
    const store = createSessionStore({ user: null, previewEnabled: true });
    const seen = watch(store);
    const before = store.getState();
    store.getState().previewAs("admin");
    expect(seen).toHaveLength(0);
    expect(store.getState()).toBe(before);
    // Setelah pengguna ada, barulah bisa.
    store.getState().setUser(ana);
    store.getState().previewAs("admin");
    expect(store.getState().previewRole).toBe("admin");
  });

  test("previewAs menolak peran tak dikenal, daftar koma, dan nama prototipe, tanpa mengubah pilihan yang sedang aktif", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    store.getState().previewAs("admin");
    const seen = watch(store);
    const before = store.getState();
    const invalid = [
      "nope",
      "ADMIN",
      " admin",
      "admin ",
      "admin,user",
      "user,admin",
      "",
      " ",
      ",",
      ...prototypeNames,
      undefined as unknown as string,
      42 as unknown as string,
    ];
    for (const role of invalid) {
      store.getState().previewAs(role);
      expect(store.getState().previewRole, JSON.stringify(role)).toBe("admin");
    }
    expect(seen).toHaveLength(0);
    expect(store.getState()).toBe(before);
    // Dari keadaan tanpa peran tiruan pun tetap tanpa.
    const fresh = createSessionStore({ user: ana, previewEnabled: true });
    for (const role of invalid) fresh.getState().previewAs(role);
    expect(fresh.getState().previewRole).toBeNull();
  });

  test("previewAs memilih, mengganti, dan menghapus; pilihan yang sama tidak mengabari", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    const seen = watch(store);
    store.getState().previewAs("admin");
    expect(store.getState().previewRole).toBe("admin");
    expect(seen).toHaveLength(1);
    store.getState().previewAs("admin");
    expect(seen).toHaveLength(1);
    store.getState().previewAs("user");
    expect(store.getState().previewRole).toBe("user");
    expect(seen).toHaveLength(2);
    store.getState().previewAs(null);
    expect(store.getState().previewRole).toBeNull();
    expect(seen).toHaveLength(3);
    store.getState().previewAs(null);
    expect(seen).toHaveLength(3);
  });

  test("fungsi aksi tidak berganti saat state berubah (aman disimpan di komponen)", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    const { previewAs, setUser } = store.getState();
    previewAs("admin");
    setUser(budi);
    expect(store.getState().previewAs).toBe(previewAs);
    expect(store.getState().setUser).toBe(setUser);
    // Dipanggil lepas dari store pun tetap bekerja pada store-nya.
    previewAs("user");
    expect(store.getState().previewRole).toBe("user");
  });

  test("selektor: peran asli, peran tiruan, dan hak yang ditampilkan", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    const state = () => store.getState();

    // Tanpa peran di akun: peran bawaan.
    expect(selectRealRole(state())).toBe("user");
    expect(selectRole(state())).toBe("user");
    expect(selectIsPreview(state())).toBe(false);
    expect(selectCan(state(), manage)).toBe(false);

    // Tiruan admin: tampilan memakai admin, peran asli tidak berubah.
    state().previewAs("admin");
    expect(selectRealRole(state())).toBe("user");
    expect(selectRole(state())).toBe("admin");
    expect(selectIsPreview(state())).toBe(true);
    expect(selectPreviewRole(state())).toBe("admin");
    expect(selectCan(state(), manage)).toBe(true);
    expect(selectCan(state(), readAny)).toBe(true);
    expect(selectCan(state(), {})).toBe(false);

    // Admin sungguhan yang meniru user kehilangan hak di tampilan saja.
    state().setUser(budi);
    expect(selectRole(state())).toBe("admin");
    expect(selectCan(state(), manage)).toBe(true);
    state().previewAs("user");
    expect(selectRealRole(state())).toBe("admin");
    expect(selectRole(state())).toBe("user");
    expect(selectCan(state(), manage)).toBe(false);
    state().previewAs(null);
    expect(selectRole(state())).toBe("admin");
    expect(selectCan(state(), manage)).toBe(true);
  });

  test("selektor: peran kosong atau daftar koma di akun", () => {
    const blank = createSessionStore({
      user: { ...ana, role: "" },
      previewEnabled: false,
    });
    expect(selectRole(blank.getState())).toBe("user");
    expect(selectRealRole(blank.getState())).toBe("user");
    const list = createSessionStore({
      user: { ...ana, role: "support,admin" },
      previewEnabled: false,
    });
    expect(selectRole(list.getState())).toBe("support,admin");
    expect(selectCan(list.getState(), manage)).toBe(true);
    const unknown = createSessionStore({
      user: { ...ana, role: "constructor" },
      previewEnabled: false,
    });
    expect(selectRole(unknown.getState())).toBe("constructor");
    expect(selectCan(unknown.getState(), manage)).toBe(false);
  });

  test("selektor tanpa pengguna: tidak ada peran, tidak ada hak, tidak ada nama", () => {
    const store = createSessionStore({ user: null, previewEnabled: true });
    const state = store.getState();
    expect(selectUser(state)).toBeNull();
    expect(selectRole(state)).toBeNull();
    expect(selectRealRole(state)).toBeNull();
    expect(selectIsPreview(state)).toBe(false);
    expect(selectCan(state, manage)).toBe(false);
    expect(selectCan(state, {})).toBe(false);
    expect(selectDisplayName(state)).toBeNull();
    expect(selectPreviewEnabled(state)).toBe(true);
  });

  test("selectDisplayName: nama, atau email bila nama kosong", () => {
    const named = createSessionStore({ user: ana, previewEnabled: false });
    expect(selectDisplayName(named.getState())).toBe("Ana");
    const unnamed = createSessionStore({
      user: { ...ana, name: "" },
      previewEnabled: false,
    });
    expect(selectDisplayName(unnamed.getState())).toBe("ana@example.com");
  });

  test("selektor mengembalikan nilai yang stabil untuk state yang sama", () => {
    const store = createSessionStore({ user: ana, previewEnabled: true });
    store.getState().previewAs("admin");
    const state = store.getState();
    expect(selectUser(state)).toBe(selectUser(state));
    expect(selectCan(state, manage)).toBe(selectCan(state, manage));
    // Pembuat state baru (pilihan yang sama) tidak mengganti objek user.
    const user = state.user;
    store.getState().previewAs("user");
    expect(store.getState().user).toBe(user);
  });
});

// ---------------------------------------------------------------------------
// Urutan acak terhadap model acuan
// ---------------------------------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Step =
  | { kind: "setUser"; user: SessionUser | null }
  | { kind: "previewAs"; role: string | null };

// Model acuan: ditulis terpisah dari kode store, tanpa memakai fungsi
// pembantunya. Hanya nilai (pengguna dan peran tiruan), tanpa pelanggan.
interface Model {
  user: SessionUser | null;
  previewRole: string | null;
}

const declaredNames = Object.keys(roles);

function stepModel(model: Model, enabled: boolean, step: Step): Model {
  if (step.kind === "setUser") {
    const previous = model.user;
    const next = step.user;
    if (previous === null && next === null) return model;
    if (
      previous !== null &&
      next !== null &&
      previous.id === next.id &&
      previous.name === next.name &&
      previous.email === next.email &&
      previous.role === next.role
    ) {
      return model;
    }
    const sameAccount =
      previous !== null && next !== null && previous.id === next.id;
    return { user: next, previewRole: sameAccount ? model.previewRole : null };
  }
  if (!enabled || model.user === null) return model;
  if (step.role !== null && !declaredNames.includes(step.role)) return model;
  return { user: model.user, previewRole: step.role };
}

function modelRole(model: Model): string | null {
  if (model.user === null) return null;
  if (model.previewRole !== null) return model.previewRole;
  return model.user.role ? model.user.role : "user";
}

function modelCan(model: Model, permissions: Permissions): boolean {
  const role = modelRole(model);
  if (role === null) return false;
  for (const name of role.split(",")) {
    if (!Object.prototype.hasOwnProperty.call(roles, name)) continue;
    if (roles[name as keyof typeof roles].authorize(permissions).success) {
      return true;
    }
  }
  return false;
}

const randomUsers: SessionUser[] = [
  ...["u1", "u2", "u3"].flatMap((id) =>
    [null, "", "user", "admin", "admin,user", "support", "constructor"].map(
      (role) => ({
        id,
        name: id === "u2" ? "" : `Nama ${id}`,
        email: `${id}@example.com`,
        role,
      }),
    ),
  ),
  { id: "u1", name: "Nama diganti", email: "u1@example.com", role: "user" },
  { id: "u2", name: "", email: "u2.baru@example.com", role: "admin" },
];

const randomRoles: Array<string | null> = [
  null,
  "admin",
  "admin",
  "user",
  "user",
  "admin,user",
  "nope",
  "ADMIN",
  " admin",
  "",
  ...prototypeNames,
];

const checks: Permissions[] = [
  manage,
  readAny,
  deleteAny,
  { user: ["list"] },
  { notes: ["read-any"], cpe: ["manage"] },
  {},
];

for (const previewEnabled of [true, false]) {
  for (const seed of [1, 2, 3, 20260508]) {
    test(`urutan acak ${previewEnabled ? "mode demo" : "mode live"}, benih ${seed}: store sama dengan model di setiap langkah`, () => {
      const random = mulberry32(seed);
      const pick = <T>(items: readonly T[]) =>
        items[Math.floor(random() * items.length)];
      let model: Model = { user: null, previewRole: null };
      const store = createSessionStore({ user: null, previewEnabled });
      const seen = watch(store);
      let expectedNotifications = 0;
      let previewSet = 0;
      let reset = 0;
      let unchanged = 0;

      for (let index = 0; index < 600; index += 1) {
        const dice = random();
        const step: Step =
          dice < 0.35
            ? {
                kind: "setUser",
                user: random() < 0.1 ? null : pick(randomUsers),
              }
            : dice < 0.4
              ? // Pengguna yang sama lagi (nilai sama, objek baru).
                {
                  kind: "setUser",
                  user: model.user === null ? null : { ...model.user },
                }
              : { kind: "previewAs", role: pick(randomRoles) };

        const next = stepModel(model, previewEnabled, step);
        const changed =
          next.user !== model.user || next.previewRole !== model.previewRole;
        const hadPreview = model.previewRole !== null;

        if (step.kind === "setUser") store.getState().setUser(step.user);
        else store.getState().previewAs(step.role);

        if (changed) expectedNotifications += 1;
        else unchanged += 1;
        if (step.kind === "previewAs" && next.previewRole !== null && changed) {
          previewSet += 1;
        }
        if (hadPreview && next.previewRole === null) reset += 1;
        model = next;

        const label = `langkah ${index} ${JSON.stringify(step)}`;
        const state = store.getState();
        expect(state.previewEnabled, label).toBe(previewEnabled);
        expect(state.user, label).toEqual(model.user);
        expect(state.previewRole, label).toBe(model.previewRole);
        expect(seen.length, label).toBe(expectedNotifications);
        expect(selectRole(state), label).toBe(modelRole(model));
        expect(selectIsPreview(state), label).toBe(model.previewRole !== null);
        for (const permissions of checks) {
          expect(
            selectCan(state, permissions),
            `${label} dengan ${JSON.stringify(permissions)}`,
          ).toBe(modelCan(model, permissions));
        }
        // Tanpa mode demo tidak pernah ada peran tiruan.
        if (!previewEnabled) expect(state.previewRole, label).toBeNull();
      }

      // Uji ini hanya berarti bila urutannya memang menjangkau semua jalur.
      expect(unchanged).toBeGreaterThan(30);
      expect(expectedNotifications).toBeGreaterThan(100);
      if (previewEnabled) {
        expect(previewSet).toBeGreaterThan(10);
        expect(reset).toBeGreaterThan(5);
      }
    });
  }
}
