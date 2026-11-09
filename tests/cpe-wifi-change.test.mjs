import test from "node:test";
import assert from "node:assert/strict";
import {
  planWifiChange,
  verifyWifiChange,
  WifiChangeError,
} from "../src/lib/genieacs/device-detail.ts";
import {
  changeDeviceWifi,
  WifiChangeFailed,
} from "../src/services/cpe-detail.service.ts";
import { changeDeviceWifiSchema } from "../src/validators/cpe.ts";

// Struktur NBI bersarang dari path datar; { value, writable } per parameter.
function nbi(flat) {
  const root = { _id: "D05FAF-FD511GW-DF77%2D2511027460" };
  for (const [path, spec] of Object.entries(flat)) {
    const { value, writable = true } =
      typeof spec === "object" && spec !== null && "value" in spec
        ? spec
        : { value: spec };
    let node = root;
    const keys = path.split(".");
    keys.forEach((k, i) => {
      node[k] = node[k] ?? { _object: i < keys.length - 1 };
      node = node[k];
    });
    node._value = value;
    node._writable = writable;
    node._object = false;
  }
  return root;
}
const W = "InternetGatewayDevice.LANDevice.1.WLANConfiguration";
const base = () => ({
  [`${W}.1.SSID`]: "LAMA",
  [`${W}.1.KeyPassphrase`]: "",
  [`${W}.1.X_CMS_KeyPassphrase`]: "sandi-lama-1",
  [`${W}.1.PreSharedKey.1.KeyPassphrase`]: "",
  [`${W}.2.SSID`]: "HGW-1",
  [`${W}.2.KeyPassphrase`]: "",
});

test("rencana: SSID dan sandi ditulis ke SEMUA parameter sandi yang ada dan writable", () => {
  const plan = planWifiChange(nbi(base()), {
    index: 1,
    ssid: "BARU",
    password: "sandi-baru-9",
  });
  assert.deepEqual(
    plan.parameterValues.map(([p, v]) => [p.replace(`${W}.1.`, ""), v]),
    [
      ["SSID", "BARU"],
      ["X_CMS_KeyPassphrase", "sandi-baru-9"],
      ["KeyPassphrase", "sandi-baru-9"],
      ["PreSharedKey.1.KeyPassphrase", "sandi-baru-9"],
    ],
  );
  assert.ok(plan.parameterValues.every(([, , t]) => t === "xsd:string"));
  assert.equal(plan.readBack.length, 4);
});

test("rencana: hanya SSID, atau hanya sandi", () => {
  assert.equal(
    planWifiChange(nbi(base()), { index: 1, ssid: "X" }).parameterValues.length,
    1,
  );
  const only = planWifiChange(nbi(base()), { index: 1, password: "abcdefgh" });
  assert.equal(
    only.parameterValues.some(([p]) => p.endsWith(".SSID")),
    false,
  );
});

test("rencana: parameter tidak writable atau tidak ada tidak ditulis; tidak ada sama sekali = galat", () => {
  const flat = base();
  flat[`${W}.1.X_CMS_KeyPassphrase`] = { value: "x", writable: false };
  const plan = planWifiChange(nbi(flat), { index: 1, password: "abcdefgh" });
  assert.equal(
    plan.parameterValues.some(([p]) => p.endsWith("X_CMS_KeyPassphrase")),
    false,
  );

  const none = nbi({ [`${W}.1.SSID`]: "A" });
  assert.throws(
    () => planWifiChange(none, { index: 1, password: "abcdefgh" }),
    (e) => e instanceof WifiChangeError && e.code === "NO_PASSPHRASE_PARAM",
  );
});

test("rencana: SSID yang tidak ada dan perubahan kosong ditolak", () => {
  assert.throws(
    () => planWifiChange(nbi(base()), { index: 7, ssid: "A" }),
    (e) => e instanceof WifiChangeError && e.code === "WLAN_NOT_FOUND",
  );
  assert.throws(
    () => planWifiChange(nbi(base()), { index: 1 }),
    (e) => e instanceof WifiChangeError && e.code === "NOTHING_TO_CHANGE",
  );
  assert.throws(
    () => planWifiChange(null, { index: 1, ssid: "A" }),
    WifiChangeError,
  );
});

test("verifikasi: sama = true, beda = false, tidak terbukti = null", () => {
  const plan = planWifiChange(nbi(base()), {
    index: 1,
    ssid: "BARU",
    password: "sandi-baru-9",
  });
  const ok = nbi({
    ...base(),
    [`${W}.1.SSID`]: "BARU",
    [`${W}.1.X_CMS_KeyPassphrase`]: "sandi-baru-9",
  });
  assert.deepEqual(
    { ...verifyWifiChange(ok, plan) },
    { ssid: true, password: true },
  );
  assert.deepEqual(
    { ...verifyWifiChange(nbi(base()), plan) },
    { ssid: false, password: false },
  );
  const blankOnly = nbi({
    [`${W}.1.SSID`]: "BARU",
    [`${W}.1.KeyPassphrase`]: "",
    [`${W}.1.X_CMS_KeyPassphrase`]: "",
  });
  const p2 = planWifiChange(blankOnly, { index: 1, password: "abcdefgh" });
  assert.equal(
    verifyWifiChange(blankOnly, p2).password,
    null,
    "modem melaporkan kosong: tidak bisa dibuktikan",
  );
  assert.deepEqual(
    {
      ...verifyWifiChange(
        ok,
        planWifiChange(nbi(base()), { index: 1, ssid: "BARU" }),
      ),
    },
    { ssid: true, password: null },
  );
});

// Modem palsu: setParameterValues benar-benar mengubah data; opsi untuk menolak/antre/mengabaikan.
function fakeClient(opts = {}) {
  const state = nbi(base());
  const calls = [];
  const setPath = (path, value) => {
    let n = state;
    for (const k of path.split(".")) n = n[k];
    n._value = value;
  };
  return {
    calls,
    state,
    async getRawDevice(id) {
      calls.push(["get", id]);
      return id === state._id ? state : null;
    },
    async postTask(id, task, cr, waitMs) {
      calls.push([task.name, id, cr, waitMs]);
      if (task.name === "setParameterValues") {
        if (opts.reject)
          return {
            ok: false,
            error:
              "Perangkat tidak menjawab connection request, mungkin offline (HTTP 504)",
            status: 504,
          };
        if (opts.queue) return { ok: true, status: 202 };
        if (!opts.ignore)
          for (const [p, v] of task.parameterValues) setPath(p, v);
      }
      return { ok: true, status: 200 };
    },
  };
}

const ID = "D05FAF-FD511GW-DF77%2D2511027460";

test("layanan: ubah SSID+sandi, dibaca ulang dan terverifikasi; id dengan %2D diterima", async () => {
  const c = fakeClient();
  const r = await changeDeviceWifi(
    ID,
    { index: 1, ssid: "BARU", password: "sandi-baru-9" },
    c,
  );
  assert.equal(r.status, "applied");
  assert.deepEqual({ ...r.verified }, { ssid: true, password: true });
  assert.equal(
    JSON.stringify(r).includes("sandi-baru-9"),
    false,
    "hasil tidak boleh memuat sandi",
  );
  const set = c.calls.find((x) => x[0] === "setParameterValues");
  assert.equal(set[2], true, "lewat connection request");
  assert.ok(set[3] >= 15000, "NBI diberi waktu menunggu yang cukup");
  assert.ok(
    c.calls.some((x) => x[0] === "getParameterValues"),
    "dibaca ulang dari modem",
  );
});

test("layanan: perintah diantre (202) tidak diklaim berhasil", async () => {
  const r = await changeDeviceWifi(
    ID,
    { index: 1, ssid: "BARU" },
    fakeClient({ queue: true }),
  );
  assert.equal(r.status, "queued");
  assert.deepEqual({ ...r.verified }, { ssid: null, password: null });
});

test("layanan: modem menerima tetapi nilai tidak berubah = gagal, bukan sukses palsu", async () => {
  await assert.rejects(
    changeDeviceWifi(
      ID,
      { index: 1, ssid: "BARU" },
      fakeClient({ ignore: true }),
    ),
    WifiChangeFailed,
  );
});

test("layanan: GenieACS menolak (modem offline) dan perangkat tak ada", async () => {
  await assert.rejects(
    changeDeviceWifi(
      ID,
      { index: 1, ssid: "BARU" },
      fakeClient({ reject: true }),
    ),
    (e) => e instanceof WifiChangeFailed && e.httpStatus === 504,
  );
  assert.equal(
    await changeDeviceWifi("tidak-ada", { index: 1, ssid: "A" }, fakeClient()),
    null,
  );
});

test("validasi: SSID dihitung dalam BYTE UTF-8 dan tanpa karakter kontrol/spasi tepi", () => {
  const ok = (v) => changeDeviceWifiSchema.safeParse(v).success;
  assert.ok(ok({ index: 1, ssid: "Rumah Budi" }));
  assert.ok(ok({ index: 1, ssid: "a".repeat(32) }));
  assert.equal(ok({ index: 1, ssid: "a".repeat(33) }), false);
  assert.equal(
    ok({ index: 1, ssid: "é".repeat(17) }),
    false,
    "17 huruf 2-byte = 34 byte",
  );
  assert.ok(ok({ index: 1, ssid: "é".repeat(16) }));
  for (const bad of ["", " A", "A ", "A\nB", "A\u0000B", "A\u007fB"])
    assert.equal(ok({ index: 1, ssid: bad }), false, JSON.stringify(bad));
});

test("validasi: sandi WPA 8-63 ASCII atau 64 heksadesimal", () => {
  const ok = (password) =>
    changeDeviceWifiSchema.safeParse({ index: 1, password }).success;
  assert.ok(ok("12345678"));
  assert.ok(ok("a".repeat(63)));
  assert.ok(ok("sandi dengan spasi & simbol!"));
  assert.ok(
    ok("0123456789abcdefABCDEF0123456789abcdefABCDEF0123456789abcdefABCD"),
    "64 heksadesimal",
  );
  for (const bad of [
    "1234567",
    "g".repeat(64),
    "é".repeat(10),
    "pass\nword1",
    "x".repeat(65),
    "",
  ])
    assert.equal(ok(bad), false, JSON.stringify(bad));
});

test("validasi: wajib salah satu, nomor SSID 1-8, field asing ditolak", () => {
  const s = changeDeviceWifiSchema;
  assert.equal(s.safeParse({ index: 1 }).success, false);
  assert.equal(s.safeParse({ ssid: "A" }).success, false);
  assert.equal(s.safeParse({ index: 0, ssid: "A" }).success, false);
  assert.equal(s.safeParse({ index: 9, ssid: "A" }).success, false);
  assert.equal(s.safeParse({ index: 1.5, ssid: "A" }).success, false);
  assert.equal(s.safeParse({ index: 1, ssid: "A", extra: 1 }).success, false);
  assert.equal(
    s.safeParse({ index: 2, ssid: "A", password: "12345678" }).success,
    true,
  );
});
