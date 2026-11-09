import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { buildProvisionPlan } =
  await import("../src/lib/mikrotik/provision-plan.ts");

const base = {
  enableWww: true,
  enableWwwSsl: false,
  allowedAddress: "192.168.0.25/32",
  restUser: "noc-api",
  restPassword: "s3cretpass!",
  restGroup: "noc-rest",
};
const current = (over = {}) => ({
  services: [
    { id: "*1", name: "www", port: "80", address: "", disabled: true },
    { id: "*2", name: "www-ssl", port: "443", address: "", disabled: true },
  ],
  groups: [],
  users: [],
  certificates: [{ name: "le", trusted: true, invalid: false }],
  ...over,
});
const wwwStep = (plan) => plan.find((s) => s.label === "Aktifkan www").words;

test("address lama digabung tanpa duplikat; kosong: aktif tetap kosong, nonaktif dibatasi ke allowedAddress", () => {
  const withOld = current({
    services: [
      {
        id: "*1",
        name: "www",
        port: "80",
        address: "10.0.0.0/24",
        disabled: true,
      },
    ],
  });
  assert.ok(
    wwwStep(buildProvisionPlan(base, withOld)).includes(
      "=address=10.0.0.0/24,192.168.0.25/32",
    ),
  );
  const dup = current({
    services: [
      {
        id: "*1",
        name: "www",
        port: "80",
        address: "192.168.0.25/32",
        disabled: true,
      },
    ],
  });
  assert.ok(
    wwwStep(buildProvisionPlan(base, dup)).includes("=address=192.168.0.25/32"),
  );
  // www nonaktif + address kosong: jangan dibuka ke semua alamat.
  assert.ok(
    wwwStep(buildProvisionPlan(base, current())).includes(
      "=address=192.168.0.25/32",
    ),
  );
  const open = current({
    services: [
      { id: "*1", name: "www", port: "80", address: "", disabled: false },
    ],
  });
  assert.ok(wwwStep(buildProvisionPlan(base, open)).includes("=address="));
});

test("www-ssl tanpa sertifikat valid melempar", () => {
  assert.throws(
    () => buildProvisionPlan({ ...base, enableWwwSsl: true }, current()),
    /Sertifikat/,
  );
  assert.throws(
    () =>
      buildProvisionPlan(
        { ...base, enableWwwSsl: true, wwwSslCertificate: "nope" },
        current(),
      ),
    /Sertifikat/,
  );
  assert.doesNotThrow(() =>
    buildProvisionPlan(
      { ...base, enableWwwSsl: true, wwwSslCertificate: "le" },
      current(),
    ),
  );
});

test("grup/akun sudah ada -> set (grup tidak diubah); display menyembunyikan password", () => {
  const plan = buildProvisionPlan(
    base,
    current({
      groups: [{ id: "*g", name: "noc-rest", policy: "read" }],
      users: [{ id: "*u", name: "noc-api" }],
    }),
  );
  assert.equal(
    plan.some((s) => s.words[0] === "/user/group/add"),
    false,
  );
  assert.equal(plan[0].words[0], "/user/set");
  for (const s of buildProvisionPlan(base, current()))
    assert.ok(!s.display.includes("s3cretpass!"), s.display);
});

test("akun REST sama dengan akun bootstrap ditolak (mencegah lockout)", () => {
  assert.throws(
    () =>
      buildProvisionPlan({ ...base, restUser: "admin" }, current(), "admin"),
    /tidak boleh sama/,
  );
});

const { parseServices, pickSourceIp } =
  await import("../src/lib/mikrotik/provision-plan.ts");

test("parseServices mengabaikan baris dinamis/koneksi yang bernama sama, walau terdaftar lebih dulu", () => {
  const rows = [
    { ".id": "*D1", name: "www", dynamic: "true", connection: "true" },
    { ".id": "*6", name: "www", port: "80", address: "", disabled: "true" },
    { ".id": "*9", name: "www-ssl", port: "443", disabled: "true" },
    { ".id": "*A", name: "api", port: "8728" },
  ];
  const s = parseServices(rows);
  assert.deepEqual(
    s.map((x) => x.id),
    ["*6", "*9"],
  );
  assert.equal(s[0].disabled, true);
});

test("pickSourceIp memakai sesi API terbaru milik akun login, bukan sesi Winbox/akun lain", () => {
  const active = [
    { name: "netsi", address: "172.16.15.192", via: "winbox" },
    { name: "userapp", address: "10.0.0.9", via: "api" },
    { name: "userapp", address: "172.16.15.192", via: "api" },
    { name: "Monitor", address: "10.20.30.3", via: "rest-api" },
  ];
  assert.equal(pickSourceIp(active, "userapp"), "172.16.15.192");
  assert.equal(pickSourceIp(active, "nobody"), null);
});

const { toTerminal } = await import("../src/lib/mikrotik/provision-plan.ts");

test("toTerminal: kata API -> perintah terminal MikroTik; .id jadi argumen posisi, password dikutip", () => {
  assert.equal(
    toTerminal([
      "/user/group/add",
      "=name=noc-rest",
      "=policy=read,api,rest-api,test",
    ]),
    "/user group add name=noc-rest policy=read,api,rest-api,test",
  );
  assert.equal(
    toTerminal([
      "/ip/service/set",
      "=.id=*2",
      "=disabled=no",
      "=address=172.16.15.192/32",
    ]),
    "/ip service set *2 disabled=no address=172.16.15.192/32",
  );
  assert.equal(
    toTerminal([
      "/user/add",
      "=name=noc-api",
      "=group=noc-rest",
      "=password=<KATA-SANDI>",
    ]),
    '/user add name=noc-api group=noc-rest password="<KATA-SANDI>"',
  );
});

test("terminal: selektor berbasis nama (bukan .id) dan password tetap placeholder", () => {
  const plan = buildProvisionPlan(
    base,
    current({
      groups: [{ id: "*g", name: "noc-rest", policy: "x" }],
      users: [{ id: "*9", name: "noc-api" }],
    }),
  );
  const t = plan.map((s) => s.terminal);
  assert.equal(
    t[0],
    '/user set [find name=noc-api] group=noc-rest password="<KATA-SANDI>"',
  );
  assert.equal(plan[0].tolerateDenied, true);
  assert.equal(
    t[1],
    "/ip service set [find name=www dynamic=no] disabled=no address=192.168.0.25/32",
  );
  assert.ok(!t.join("\n").includes("*"), "tidak ada .id di perintah terminal");
});

test("grup REST baru berizin write; grup lama yang kurang write/rest-api diberi peringatan, yang cukup tidak", async () => {
  const { provisionWarnings } =
    await import("../src/lib/mikrotik/provision-plan.ts");
  assert.ok(
    buildProvisionPlan(base, current())[0].words.includes(
      "=policy=read,write,api,rest-api,test",
    ),
  );
  const weak = provisionWarnings(base, {
    groups: [
      { id: "*g", name: "noc-rest", policy: "read,api,test,!write,!rest-api" },
    ],
  });
  assert.match(weak[0], /belum memuat izin: write, rest-api/);
  const ok = provisionWarnings(base, {
    groups: [
      {
        id: "*g",
        name: "noc-rest",
        policy: "read,write,test,sniff,api,rest-api,!local",
      },
    ],
  });
  assert.doesNotMatch(ok[0], /belum memuat/);
});
