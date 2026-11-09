import test from "node:test";
import assert from "node:assert/strict";
import { ontWebTr069Schema } from "../src/validators/devices.ts";

test("ontWebTr069Schema menerima IPv4 dan kredensial opsional", () => {
  assert.deepEqual(ontWebTr069Schema.parse({ host: " 172.16.15.248 " }), {
    host: "172.16.15.248",
  });
  const onu = "7362598d-f593-45b3-bd4a-0f4bb7480865";
  assert.deepEqual(ontWebTr069Schema.parse({ onuId: onu }), { onuId: onu });
  assert.equal(
    ontWebTr069Schema.parse({ onuId: onu, ensureWan: true }).ensureWan,
    true,
  );
  assert.equal(
    ontWebTr069Schema.safeParse({ onuId: onu, ensureWan: "true" }).success,
    false,
  );
  const full = ontWebTr069Schema.parse({
    host: "10.0.0.1",
    username: " admin ",
    password: "x y",
  });
  assert.equal(full.username, "admin");
  assert.equal(
    full.password,
    "x y",
    "kata sandi tidak boleh dipotong spasinya",
  );
});

test("ontWebTr069Schema menolak bukan-IPv4, field asing dan nilai terlalu panjang", () => {
  for (const bad of [
    {},
    { host: "" },
    { onuId: "bukan-uuid" },
    { username: "admin", password: "x" },
    { host: "modem.local" },
    { host: "172.16.15.248:80" },
    { host: "http://172.16.15.248" },
    { host: "::1" },
    { host: "1.2.3" },
    { host: "172.16.15.248", port: 8080 },
    { host: "172.16.15.248", password: "x".repeat(101) },
  ]) {
    assert.equal(
      ontWebTr069Schema.safeParse(bad).success,
      false,
      JSON.stringify(bad),
    );
  }
});

import { ontWebSettingsSchema } from "../src/validators/devices.ts";

const okSettings = { acsUrl: "http://172.16.0.1:7547", informInterval: 300 };

test("ontWebSettingsSchema: kata sandi tak dikirim = undefined (biarkan), kosong = hapus", () => {
  const keep = ontWebSettingsSchema.parse(okSettings);
  assert.equal(keep.acsPassword, undefined);
  assert.equal(keep.webPassword, undefined);
  const clear = ontWebSettingsSchema.parse({ ...okSettings, webPassword: "" });
  assert.equal(clear.webPassword, "");
});

test("ontWebSettingsSchema menolak URL dan interval yang tidak sah", () => {
  for (const bad of [
    {},
    { ...okSettings, acsUrl: "" },
    { ...okSettings, acsUrl: "ftp://x:7547" },
    { ...okSettings, acsUrl: "javascript:alert(1)" },
    { ...okSettings, acsUrl: "http://user:pw@x:7547" },
    { ...okSettings, acsUrl: "http://x/" + "a".repeat(300) },
    { ...okSettings, informInterval: 29 },
    { ...okSettings, informInterval: 86401 },
    { ...okSettings, informInterval: 300.5 },
    { ...okSettings, informInterval: "300" },
    { ...okSettings, extra: 1 },
    { ...okSettings, webPassword: "x".repeat(101) },
  ]) {
    assert.equal(
      ontWebSettingsSchema.safeParse(bad).success,
      false,
      JSON.stringify(bad).slice(0, 80),
    );
  }
});

test("ontWebSettingsSchema: kredensial ZIMLINK opsional dengan aturan sandi yang sama", () => {
  const ok = ontWebSettingsSchema.parse({
    ...okSettings,
    zimlinkUsername: " superadmin ",
    zimlinkPassword: "superoem",
  });
  assert.equal(ok.zimlinkUsername, "superadmin");
  assert.equal(ok.zimlinkPassword, "superoem");
  assert.equal(
    ontWebSettingsSchema.parse(okSettings).zimlinkPassword,
    undefined,
    "tidak dikirim = biarkan yang tersimpan",
  );
  assert.equal(
    ontWebSettingsSchema.parse({ ...okSettings, zimlinkPassword: "" })
      .zimlinkPassword,
    "",
    "kosong = hapus",
  );
  assert.equal(
    ontWebSettingsSchema.safeParse({
      ...okSettings,
      zimlinkPassword: "x".repeat(101),
    }).success,
    false,
  );
  assert.equal(
    ontWebSettingsSchema.safeParse({
      ...okSettings,
      zimlinkUsername: "x".repeat(101),
    }).success,
    false,
  );
});

test("ontWebSettingsSchema: kredensial GGCLink opsional dengan aturan sandi yang sama", () => {
  const ok = ontWebSettingsSchema.parse({
    ...okSettings,
    ggclinkUsername: " admin ",
    ggclinkPassword: "gg-rahasia",
  });
  assert.equal(ok.ggclinkUsername, "admin");
  assert.equal(ok.ggclinkPassword, "gg-rahasia");
  assert.equal(
    ontWebSettingsSchema.parse(okSettings).ggclinkPassword,
    undefined,
    "tidak dikirim = biarkan yang tersimpan",
  );
  assert.equal(
    ontWebSettingsSchema.parse({ ...okSettings, ggclinkPassword: "" })
      .ggclinkPassword,
    "",
    "kosong = hapus",
  );
  assert.equal(
    ontWebSettingsSchema.safeParse({
      ...okSettings,
      ggclinkPassword: "x".repeat(101),
    }).success,
    false,
  );
  assert.equal(
    ontWebSettingsSchema.safeParse({
      ...okSettings,
      ggclinkUsername: "x".repeat(101),
    }).success,
    false,
  );
});

test("ontWebSettingsSchema: kredensial F609 opsional dengan aturan sandi yang sama", () => {
  const ok = ontWebSettingsSchema.parse({
    ...okSettings,
    f609Username: " admin ",
    f609Password: "f6-rahasia",
  });
  assert.equal(ok.f609Username, "admin");
  assert.equal(ok.f609Password, "f6-rahasia");
  assert.equal(
    ontWebSettingsSchema.parse(okSettings).f609Password,
    undefined,
    "tidak dikirim = biarkan yang tersimpan",
  );
  assert.equal(
    ontWebSettingsSchema.parse({ ...okSettings, f609Password: "" })
      .f609Password,
    "",
    "kosong = hapus",
  );
  assert.equal(
    ontWebSettingsSchema.safeParse({
      ...okSettings,
      f609Password: "x".repeat(101),
    }).success,
    false,
  );
  assert.equal(
    ontWebSettingsSchema.safeParse({
      ...okSettings,
      f609Username: "x".repeat(101),
    }).success,
    false,
  );
});
