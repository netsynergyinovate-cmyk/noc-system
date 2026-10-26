import { expect, test } from "@playwright/test";
import {
  capabilities,
  capabilityPermissions,
  isCapability,
  selectCanDo,
  type Capability,
} from "../src/lib/access";
import { statement, type Permissions } from "../src/lib/permissions";
import { roleCan } from "../src/lib/roles";
import { createSessionStore, type SessionUser } from "../src/lib/session-store";

// Kontrol akses per peran untuk tampilan (src/lib/access.ts), tanpa browser:
// setiap kemampuan memetakan ke izin yang sah, kebijakan yang berlaku sekarang
// dikunci supaya perubahan di masa depan disengaja, dan selectCanDo mengikuti
// peran tiruan "Lihat sebagai". Semua ini hanya soal apa yang DITAMPILKAN;
// server tetap memeriksa peran asli (lihat e2e/roles.spec.ts dan
// e2e/access-ui.spec.ts untuk bukti di halaman sungguhan).

// Daftar kunci yang diharapkan. Menambah atau menghapus kemampuan memaksa tes
// ini (dan tabel kebijakan di bawah) diperbarui.
const expectedCapabilities: Capability[] = [
  "adminArea",
  "manageCpe",
  "manageThresholds",
  "viewAuditLog",
  "manageBilling",
  "manageUsers",
];

// Kebijakan SAAT INI per peran dasar. Record<Capability, ...> membuat kemampuan
// baru tanpa baris di sini gagal saat typecheck.
const policy: Record<Capability, { admin: boolean; user: boolean }> = {
  adminArea: { admin: true, user: false },
  manageCpe: { admin: true, user: false },
  manageThresholds: { admin: true, user: false },
  viewAuditLog: { admin: true, user: true },
  manageBilling: { admin: true, user: false },
  manageUsers: { admin: false, user: false },
};

const allCapabilities = Object.keys(capabilities) as Capability[];

const person = (role: string | null): SessionUser => ({
  id: "akun-1",
  name: "Petugas Uji",
  email: "uji@example.com",
  role,
});

function storeFor(role: string | null, previewEnabled = true) {
  return createSessionStore({ user: person(role), previewEnabled });
}

// ---------------------------------------------------------------------------
// Pemetaan kemampuan ke izin
// ---------------------------------------------------------------------------

test.describe("pemetaan kemampuan ke izin", () => {
  test("daftar kunci sama dengan yang diharapkan (kunci baru memaksa tes diperbarui)", () => {
    expect(Object.keys(capabilities).sort()).toEqual(
      [...expectedCapabilities].sort(),
    );
    expect(Object.keys(policy).sort()).toEqual(
      [...expectedCapabilities].sort(),
    );
  });

  test("setiap kemampuan memakai resource dan aksi yang ada di statement, dan tidak kosong", () => {
    const declared = statement as Record<string, readonly string[]>;
    for (const name of allCapabilities) {
      const permissions: Permissions = capabilityPermissions(name);
      const resources = Object.keys(permissions);
      expect(resources.length, `${name}: tanpa resource`).toBeGreaterThan(0);
      for (const resource of resources) {
        expect(
          Object.hasOwn(declared, resource),
          `${name}: resource ${resource} tidak ada di statement`,
        ).toBe(true);
        const actions = (permissions as Record<string, string[]>)[resource];
        expect(Array.isArray(actions), `${name}.${resource}`).toBe(true);
        expect(
          actions.length,
          `${name}.${resource}: tanpa aksi`,
        ).toBeGreaterThan(0);
        expect(new Set(actions).size, `${name}.${resource}: aksi ganda`).toBe(
          actions.length,
        );
        for (const action of actions) {
          expect(
            declared[resource].includes(action),
            `${name}: aksi ${resource}:${action} tidak ada di statement`,
          ).toBe(true);
        }
      }
    }
  });

  test("izin yang dipetakan sekarang: adminArea = notes:read-any, manageCpe = cpe:manage", () => {
    expect(capabilityPermissions("adminArea")).toEqual({
      notes: ["read-any"],
    });
    expect(capabilityPermissions("manageCpe")).toEqual({ cpe: ["manage"] });
  });

  test("capabilityPermissions mengembalikan salinan: mengubahnya tidak mengubah tabel", () => {
    for (const name of allCapabilities) {
      const before = JSON.stringify(capabilities[name]);
      const copy = capabilityPermissions(name);
      expect(copy).toEqual(capabilities[name]);
      expect(copy).not.toBe(capabilities[name]);

      const resource = Object.keys(copy)[0] as keyof Permissions;
      (copy[resource] as string[]).push("delete-any");
      (copy as Record<string, string[]>).tambahan = ["x"];
      delete copy[resource];

      expect(JSON.stringify(capabilities[name]), name).toBe(before);
      expect(JSON.stringify(capabilityPermissions(name)), name).toBe(before);
    }
    // Setiap panggilan memberi salinan baru.
    expect(capabilityPermissions("adminArea")).not.toBe(
      capabilityPermissions("adminArea"),
    );
  });

  test("tabel itu sendiri dibekukan sampai ke daftar aksi: tidak bisa diubah dari luar", () => {
    expect(Object.isFrozen(capabilities)).toBe(true);
    for (const name of allCapabilities) {
      const permissions = capabilities[name] as Record<string, string[]>;
      expect(Object.isFrozen(permissions), name).toBe(true);
      for (const actions of Object.values(permissions)) {
        expect(Object.isFrozen(actions), name).toBe(true);
        expect(() => actions.push("delete-any"), name).toThrow();
      }
      expect(() => {
        permissions.tambahan = ["x"];
      }, name).toThrow();
    }
    expect(() => {
      (capabilities as Record<string, unknown>).baru = { notes: ["read-any"] };
    }).toThrow();
    expect(Object.keys(capabilities).sort()).toEqual(
      [...expectedCapabilities].sort(),
    );
  });

  test("isCapability hanya menerima kunci milik tabel (bukan nama prototipe atau nilai lain)", () => {
    for (const name of expectedCapabilities) {
      expect(isCapability(name), name).toBe(true);
    }
    for (const name of [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
      "valueOf",
      "AdminArea",
      " adminArea",
      "",
      "unknown",
    ]) {
      expect(isCapability(name), name).toBe(false);
    }
    for (const value of [null, undefined, 0, 1, {}, [], ["adminArea"]]) {
      expect(isCapability(value)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Kebijakan yang berlaku sekarang
// ---------------------------------------------------------------------------

test.describe("kebijakan tampilan saat ini", () => {
  test("tabel kebijakan memuat ya dan tidak (bukan semuanya sama)", () => {
    const answers = new Set(
      allCapabilities.flatMap((name) => [
        policy[name].admin,
        policy[name].user,
      ]),
    );
    expect(answers).toEqual(new Set([true, false]));
  });

  test("admin bisa semua kemampuan; user tidak bisa satu pun", () => {
    for (const name of allCapabilities) {
      expect(policy[name], name).toEqual({ admin: true, user: false });
      expect(selectCanDo(storeFor("admin").getState(), name), name).toBe(
        policy[name].admin,
      );
      expect(selectCanDo(storeFor("user").getState(), name), name).toBe(
        policy[name].user,
      );
      // Sama dengan roleCan atas izin yang dipetakan.
      expect(roleCan("admin", capabilityPermissions(name)), name).toBe(true);
      expect(roleCan("user", capabilityPermissions(name)), name).toBe(false);
    }
  });

  // [peran di kolom user.role, apa yang diberikannya]
  const cases: Array<
    [string | null | undefined, "admin" | "user" | "nothing"]
  > = [
    ["admin", "admin"],
    ["user", "user"],
    // Daftar koma adalah gabungan; urutan tidak berpengaruh.
    ["admin,user", "admin"],
    ["user,admin", "admin"],
    ["user,user,admin", "admin"],
    ["user,user", "user"],
    // Kosong atau null berarti peran bawaan (user).
    [null, "user"],
    [undefined, "user"],
    ["", "user"],
    // Nama yang tak dikenal tidak memberi hak; dibaca persis (tanpa pangkas).
    ["nope", "nothing"],
    ["ADMIN", "nothing"],
    [" admin", "nothing"],
    ["admin ", "nothing"],
    [",", "nothing"],
    ["nope,admin", "admin"],
    ["admin,nope", "admin"],
    // Nama prototipe tidak memberi hak dan tidak melempar galat.
    ["constructor", "nothing"],
    ["toString", "nothing"],
    ["__proto__", "nothing"],
    ["hasOwnProperty", "nothing"],
    ["constructor,admin", "admin"],
    ["admin,constructor", "admin"],
    ["constructor,user", "user"],
    ["toString,__proto__", "nothing"],
  ];

  for (const [role, grants] of cases) {
    test(`peran ${JSON.stringify(role)} memberi ${grants}`, () => {
      const store = storeFor(role ?? null);
      // undefined dari pemanggil JS sama dengan null untuk store.
      for (const name of allCapabilities) {
        const expected = grants === "nothing" ? false : policy[name][grants];
        expect(() => selectCanDo(store.getState(), name), name).not.toThrow();
        expect(selectCanDo(store.getState(), name), name).toBe(expected);
        expect(
          roleCan(role, capabilityPermissions(name)),
          `roleCan ${name}`,
        ).toBe(expected);
      }
    });
  }

  test("nama yang bukan kemampuan ditolak, juga untuk admin, tanpa galat", () => {
    const admin = storeFor("admin").getState();
    for (const name of ["constructor", "toString", "__proto__", "", "nope"]) {
      expect(() => selectCanDo(admin, name as Capability), name).not.toThrow();
      expect(selectCanDo(admin, name as Capability), name).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// selectCanDo dan peran tiruan
// ---------------------------------------------------------------------------

function canDoAll(store: ReturnType<typeof storeFor>) {
  return allCapabilities.map((name) => selectCanDo(store.getState(), name));
}

test.describe("selectCanDo mengikuti peran yang dipakai tampilan", () => {
  test("mode demo: peran tiruan menggantikan peran asli, null mengembalikannya", () => {
    const regular = storeFor("user", true);
    expect(canDoAll(regular)).toEqual([false, false]);
    regular.getState().previewAs("admin");
    expect(canDoAll(regular)).toEqual([true, true]);
    regular.getState().previewAs("user");
    expect(canDoAll(regular)).toEqual([false, false]);
    regular.getState().previewAs("admin");
    regular.getState().previewAs(null);
    expect(canDoAll(regular)).toEqual([false, false]);

    const admin = storeFor("admin", true);
    expect(canDoAll(admin)).toEqual([true, true]);
    admin.getState().previewAs("user");
    expect(canDoAll(admin)).toEqual([false, false]);
    admin.getState().previewAs(null);
    expect(canDoAll(admin)).toEqual([true, true]);
  });

  test("peran tiruan menggantikan seluruh daftar peran asli, tidak digabung", () => {
    const store = storeFor("admin,user", true);
    expect(canDoAll(store)).toEqual([true, true]);
    store.getState().previewAs("user");
    expect(canDoAll(store)).toEqual([false, false]);
  });

  test("peran tiruan yang tidak sah (daftar koma, nama prototipe, nama asing) diabaikan", () => {
    const store = storeFor("user", true);
    for (const bad of ["admin,user", "constructor", "toString", "nope", ""]) {
      store.getState().previewAs(bad);
      expect(store.getState().previewRole, bad).toBeNull();
      expect(canDoAll(store), bad).toEqual([false, false]);
    }
  });

  test("mode live: peran tiruan tidak berlaku, hanya peran asli", () => {
    const regular = storeFor("user", false);
    regular.getState().previewAs("admin");
    expect(regular.getState().previewRole).toBeNull();
    expect(canDoAll(regular)).toEqual([false, false]);

    const admin = storeFor("admin", false);
    admin.getState().previewAs("user");
    expect(canDoAll(admin)).toEqual([true, true]);
  });

  test("tanpa pengguna selalu false, juga setelah keluar dan dengan peran tiruan", () => {
    const empty = createSessionStore({ user: null, previewEnabled: true });
    expect(canDoAll(empty)).toEqual([false, false]);
    empty.getState().previewAs("admin");
    expect(empty.getState().previewRole).toBeNull();
    expect(canDoAll(empty)).toEqual([false, false]);

    const store = storeFor("admin", true);
    expect(canDoAll(store)).toEqual([true, true]);
    store.getState().setUser(null);
    expect(canDoAll(store)).toEqual([false, false]);
  });

  test("berganti akun membuang peran tiruan; akun yang sama menyimpannya", () => {
    const store = storeFor("user", true);
    store.getState().previewAs("admin");
    expect(canDoAll(store)).toEqual([true, true]);

    // Akun yang sama dengan peran asli yang berubah: peran tiruan tetap.
    store.getState().setUser({ ...person("user"), role: "admin" });
    store.getState().previewAs("user");
    store.getState().setUser({ ...person("admin") });
    expect(store.getState().previewRole).toBe("user");
    expect(canDoAll(store)).toEqual([false, false]);

    // Akun lain: kembali ke peran asli akun itu.
    store.getState().setUser({ ...person("user"), id: "akun-2" });
    expect(store.getState().previewRole).toBeNull();
    expect(canDoAll(store)).toEqual([false, false]);
  });

  test("peran asli yang berubah di server langsung terbaca (tanpa peran tiruan)", () => {
    const store = storeFor("user", true);
    expect(canDoAll(store)).toEqual([false, false]);
    store.getState().setUser(person("admin"));
    expect(canDoAll(store)).toEqual([true, true]);
    store.getState().setUser(person(null));
    expect(canDoAll(store)).toEqual([false, false]);
  });

  test("hasilnya boolean sungguhan dan sama untuk panggilan berulang (aman sebagai selektor)", () => {
    const store = storeFor("admin", true);
    for (const name of allCapabilities) {
      const first = selectCanDo(store.getState(), name);
      expect(typeof first, name).toBe("boolean");
      expect(selectCanDo(store.getState(), name), name).toBe(first);
    }
  });

  test("dua store tidak saling memengaruhi", () => {
    const a = storeFor("user", true);
    const b = storeFor("admin", true);
    a.getState().previewAs("admin");
    expect(canDoAll(a)).toEqual([true, true]);
    b.getState().previewAs("user");
    expect(canDoAll(b)).toEqual([false, false]);
    expect(canDoAll(a)).toEqual([true, true]);
  });
});
