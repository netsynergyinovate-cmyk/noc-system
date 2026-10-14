import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";
import { adminClient } from "better-auth/client/plugins";
import { ac, roles, statement, type Permissions } from "../src/lib/permissions";
import {
  issueRealtimeTicket,
  REALTIME_PERMS,
  REALTIME_TICKET_TTL_SECONDS,
} from "../src/lib/realtime-ticket";
import { roleCan } from "../src/lib/roles";

// Izin untuk MENGUBAH data dan tiket realtime yang membawanya, tanpa server dan
// tanpa browser. Perilaku di server sungguhan (route router, route tiket)
// diperiksa e2e/write-authorization.spec.ts; sisi Go ada di
// backend/internal/auth dan backend/internal/httpapi.

const checkRolePermission = adminClient({ ac, roles }).getActions().admin
  .checkRolePermission;

type Pair = { resource: string; action: string };

const allPairs: Pair[] = (
  Object.entries(statement) as Array<[string, readonly string[]]>
).flatMap(([resource, actions]) =>
  actions.map((action) => ({ resource, action })),
);

const one = ({ resource, action }: Pair) =>
  ({ [resource]: [action] }) as Permissions;

// ---------------------------------------------------------------------------
// Izin dan peran
// ---------------------------------------------------------------------------

test.describe("izin mengubah data di statement dan peran", () => {
  test("router:manage dan alert:handle ada di statement, persis satu aksi masing-masing", () => {
    expect(statement.router).toEqual(["manage"]);
    expect(statement.alert).toEqual(["handle"]);
  });

  test("admin punya izin mengubah data yang ada", () => {
    for (const permissions of [
      { router: ["manage"] },
      { alert: ["handle"] },
      { cpe: ["manage"] },
      { notes: ["delete-any"] },
      { router: ["manage"], alert: ["handle"], cpe: ["manage"] },
    ] as Permissions[]) {
      expect(roleCan("admin", permissions), JSON.stringify(permissions)).toBe(
        true,
      );
      expect(roles.admin.authorize(permissions).success).toBe(true);
    }
  });

  test("user (hanya lihat) tidak punya satu pun izin: tidak satu pasangan sumber:aksi pun", () => {
    // Bukan daftar aksi yang diketahui hari ini, melainkan SEMUA pasangan di
    // statement: aksi baru yang kelak ditambahkan dan lupa dikecualikan dari
    // user langsung membuat tes ini gagal.
    expect(allPairs.length).toBeGreaterThan(0);
    for (const pair of allPairs) {
      expect(
        roleCan("user", one(pair)),
        `user tidak boleh ${pair.resource}:${pair.action}`,
      ).toBe(false);
      expect(roles.user.authorize(one(pair)).success).toBe(false);
    }
    // Dan daftar yang dinyatakan peran itu sendiri kosong di setiap sumber daya.
    for (const [resource, actions] of Object.entries(
      roles.user.statements as Record<string, readonly string[]>,
    )) {
      expect(actions, `roles.user.${resource}`).toEqual([]);
    }
    // Menggabungkan beberapa izin yang user tidak punya tetap ditolak.
    expect(
      roleCan("user", { router: ["manage"], alert: ["handle"] } as Permissions),
    ).toBe(false);
  });

  test("izin baru tidak bocor lewat peran yang kosong, tak dikenal, atau salah tulis", () => {
    const writes = [
      { router: ["manage"] },
      { alert: ["handle"] },
    ] as Permissions[];
    for (const role of [
      null,
      undefined,
      "",
      "user",
      "user,user",
      "nope",
      "ADMIN",
      " admin",
      "admin ",
      ",",
      "constructor",
      "toString",
      "__proto__",
    ]) {
      for (const permissions of writes) {
        expect(
          roleCan(role, permissions),
          `${JSON.stringify(role)} ${JSON.stringify(permissions)}`,
        ).toBe(false);
      }
    }
    // Daftar peran adalah gabungan: satu peran yang berhak cukup.
    for (const role of ["admin", "admin,user", "user,admin", "nope,admin"]) {
      for (const permissions of writes) {
        expect(roleCan(role, permissions), role).toBe(true);
      }
    }
  });

  test("roleCan sama dengan pemeriksaan Better Auth untuk izin baru", () => {
    for (const role of [null, "", "user", "admin", "admin,user", "nope"]) {
      for (const permissions of [
        { router: ["manage"] },
        { alert: ["handle"] },
        { router: ["manage"], alert: ["handle"] },
        { router: [] },
        { alert: [] },
      ] as Permissions[]) {
        expect(
          roleCan(role, permissions),
          `${JSON.stringify(role)} ${JSON.stringify(permissions)}`,
        ).toBe(
          checkRolePermission({
            role: role as "user",
            permissions,
          }),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// REALTIME_PERMS: izin yang dibawa tiket
// ---------------------------------------------------------------------------

test.describe("izin yang boleh dibawa tiket realtime", () => {
  test("hanya alert:handle untuk sekarang", () => {
    expect(Object.keys(REALTIME_PERMS)).toEqual(["alert:handle"]);
  });

  test("tiap izin tiket menunjuk satu pasangan sumber:aksi yang sama dengan namanya dan ada di statement", () => {
    for (const [perm, permissions] of Object.entries(REALTIME_PERMS)) {
      const resources = Object.keys(permissions);
      expect(resources, perm).toHaveLength(1);
      const [resource] = resources;
      const actions = (permissions as Record<string, string[]>)[resource];
      expect(actions, perm).toHaveLength(1);
      expect(`${resource}:${actions[0]}`).toBe(perm);
      expect(
        (statement as Record<string, readonly string[]>)[resource],
        perm,
      ).toContain(actions[0]);
      // Admin boleh, user tidak: tiket akun biasa tidak akan memuatnya.
      expect(roleCan("admin", permissions), perm).toBe(true);
      expect(roleCan("user", permissions), perm).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// issueRealtimeTicket
// ---------------------------------------------------------------------------

const secret = "0123456789abcdef0123456789abcdef";
const now = 1_700_000_000_000; // exp = 1700000060 dengan umur 60 detik

// Vektor silang dengan Go (backend/internal/auth/token_test.go): byte yang sama
// untuk masukan yang sama. Ditulis di sini sebagai teks tetap, bukan dihitung
// ulang dengan kode yang diuji, jadi perubahan format di satu sisi saja gagal.
const goTicketWithoutPerms =
  "eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwNjB9.jMkVWtPotDtVCgI3ANolKu7G5aKr0qTpD77cf7kig5c";
const goTicketWithAlertHandle =
  "eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwNjAsInBlcm1zIjpbImFsZXJ0OmhhbmRsZSJdfQ.2NkYiFVPpm4m5kNile72qG6GGZe0EO6YzO5ij0PLtQE";
const goTicketWithTwoPerms =
  "eyJzdWIiOiJ1c2VyLTEiLCJleHAiOjE3MDAwMDAwNjAsInBlcm1zIjpbImFsZXJ0OmhhbmRsZSIsInJvdXRlcjptYW5hZ2UiXX0.4yOo1jyQtX5iUiAUvE-1KsRhTFaG2O5cLrWaX67c1ds";

const issue = (perms?: readonly string[]) =>
  issueRealtimeTicket({
    userId: "user-1",
    secret,
    now,
    ...(perms === undefined ? {} : { perms }),
  });

const decodePayload = (token: string) =>
  Buffer.from(token.split(".")[0], "base64url").toString();

test.describe("issueRealtimeTicket", () => {
  test("umur tiket 60 detik, dan batas pemakaian tidak berubah", () => {
    expect(REALTIME_TICKET_TTL_SECONDS).toBe(60);
    const { expiresAt } = issue(["alert:handle"]);
    expect(expiresAt).toBe(1_700_000_060);
    const custom = issueRealtimeTicket({
      userId: "u",
      secret,
      now,
      ttlSeconds: 5,
      perms: ["alert:handle"],
    });
    expect(custom.expiresAt).toBe(1_700_000_005);
    expect(JSON.parse(decodePayload(custom.token)).exp).toBe(1_700_000_005);
  });

  test("vektor silang dengan Go: tanpa izin persis tiket lama (tanpa kunci perms)", () => {
    for (const perms of [undefined, []] as const) {
      const { token } = issue(perms);
      expect(token).toBe(goTicketWithoutPerms);
      expect(decodePayload(token)).toBe('{"sub":"user-1","exp":1700000060}');
      expect(decodePayload(token)).not.toContain("perms");
    }
  });

  test("vektor silang dengan Go: alert:handle menghasilkan byte yang sama", () => {
    const { token } = issue(["alert:handle"]);
    expect(token).toBe(goTicketWithAlertHandle);
    expect(decodePayload(token)).toBe(
      '{"sub":"user-1","exp":1700000060,"perms":["alert:handle"]}',
    );
  });

  test("vektor silang dengan Go: dua izin, apa pun urutan dan kembarannya", () => {
    for (const perms of [
      ["alert:handle", "router:manage"],
      ["router:manage", "alert:handle"],
      ["router:manage", "alert:handle", "router:manage", "alert:handle"],
    ]) {
      expect(issue(perms).token, JSON.stringify(perms)).toBe(
        goTicketWithTwoPerms,
      );
    }
  });

  test("urutan stabil: setiap permutasi himpunan yang sama memberi tiket yang sama, terurut menurut abjad", () => {
    const set = ["router:manage", "alert:handle", "alert:read"];
    const permutations = (items: string[]): string[][] =>
      items.length <= 1
        ? [items]
        : items.flatMap((item, index) =>
            permutations([
              ...items.slice(0, index),
              ...items.slice(index + 1),
            ]).map((rest) => [item, ...rest]),
          );
    const tokens = new Set(
      permutations(set).map((perms) => issue(perms).token),
    );
    expect(tokens.size).toBe(1);
    const [token] = [...tokens];
    expect(JSON.parse(decodePayload(token)).perms).toEqual([
      "alert:handle",
      "alert:read",
      "router:manage",
    ]);
    // Himpunan berbeda memberi tiket berbeda.
    expect(issue(["alert:handle"]).token).not.toBe(issue(set).token);
  });

  test("daftar dari pemanggil tidak diubah (tidak diurutkan di tempat)", () => {
    const perms = ["router:manage", "alert:handle", "alert:handle"];
    const copy = [...perms];
    issue(perms);
    expect(perms).toEqual(copy);
    const frozen = Object.freeze([...perms]);
    expect(() => issue(frozen)).not.toThrow();
  });

  test("tanda tangan HMAC-SHA256 atas payload yang sama persis, base64url tanpa padding", () => {
    for (const perms of [[], ["alert:handle"], ["alert:handle", "x:y"]]) {
      const { token } = issue(perms);
      const [payload, signature, ...rest] = token.split(".");
      expect(rest).toHaveLength(0);
      expect(token).not.toMatch(/[=+/]/);
      const expected = createHmac("sha256", secret)
        .update(Buffer.from(payload, "base64url"))
        .digest();
      expect(Buffer.from(signature, "base64url").equals(expected)).toBe(true);
      // Rahasia lain menghasilkan tanda tangan lain.
      const other = createHmac("sha256", "f".repeat(32))
        .update(Buffer.from(payload, "base64url"))
        .digest();
      expect(Buffer.from(signature, "base64url").equals(other)).toBe(false);
    }
  });

  test("izin ikut ditandatangani: izin yang berbeda memberi tanda tangan yang berbeda", () => {
    const signatureOf = (token: string) => token.split(".")[1];
    expect(signatureOf(issue([]).token)).not.toBe(
      signatureOf(issue(["alert:handle"]).token),
    );
    expect(signatureOf(issue(["alert:handle"]).token)).not.toBe(
      signatureOf(issue(["router:manage"]).token),
    );
  });

  test("bentuk izin yang tidak sah ditolak sebelum tiket dibuat", () => {
    for (const bad of [
      "",
      "alert",
      "alert:",
      ":handle",
      "Alert:handle",
      "alert:Handle",
      "alert: handle",
      "alert:handle ",
      " alert:handle",
      "alert:handle\n",
      "alert:handle,router:manage",
      "alert:handle:extra",
      "1alert:handle",
      'alert:"handle"',
      "alert:han dle",
    ]) {
      expect(() => issue([bad]), JSON.stringify(bad)).toThrow(/izin/i);
      // Satu izin buruk menggagalkan seluruhnya, juga di tengah izin yang sah.
      expect(() => issue(["alert:handle", bad]), JSON.stringify(bad)).toThrow();
    }
  });

  test("subjek tetap id pengguna apa adanya, izin tidak mengubahnya", () => {
    const { token } = issueRealtimeTicket({
      userId: 'id-"aneh"\\',
      secret,
      now,
      perms: ["alert:handle"],
    });
    expect(JSON.parse(decodePayload(token))).toEqual({
      sub: 'id-"aneh"\\',
      exp: 1_700_000_060,
      perms: ["alert:handle"],
    });
  });
});
