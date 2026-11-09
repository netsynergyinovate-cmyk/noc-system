import test from "node:test";
import assert from "node:assert/strict";
import {
  addRecipient,
  defaultWhatsappConfig,
  getActiveRecipientPhones,
  removeRecipient,
  toggleRecipient,
  normalizePhone,
  renderWhatsappMessage,
  validateWhatsappConfig,
} from "../src/lib/dashboard/whatsapp.ts";
import {
  createWhatsappRegistry,
  WHATSAPP_STORAGE_KEY,
} from "../src/lib/dashboard/whatsapp-registry.ts";

test("normalizePhone", () => {
  assert.equal(normalizePhone("081234567890"), "6281234567890");
  assert.equal(normalizePhone("+6281234567890"), "6281234567890");
  assert.equal(normalizePhone("6281234567890"), "6281234567890");
  assert.equal(normalizePhone(" 0812-3456 7890 "), "6281234567890");
  for (const bad of [
    "",
    "abc",
    "0812",
    "123456789012",
    "628",
    "08a1234567890",
    "+",
  ])
    assert.equal(normalizePhone(bad), "", bad);
});

test("validateWhatsappConfig", () => {
  assert.equal(validateWhatsappConfig(defaultWhatsappConfig).valid, true);
  const ok = { ...defaultWhatsappConfig, enabled: true, apiKey: "k" };
  assert.equal(validateWhatsappConfig(ok).valid, true);
  assert.ok(
    validateWhatsappConfig({ ...ok, gatewayUrl: "" }).errors.gatewayUrl,
  );
  assert.ok(
    validateWhatsappConfig({ ...ok, gatewayUrl: "bukan url" }).errors
      .gatewayUrl,
  );
  assert.ok(
    validateWhatsappConfig({ ...ok, gatewayUrl: "ftp://x.id" }).errors
      .gatewayUrl,
  );
  assert.ok(validateWhatsappConfig({ ...ok, apiKey: " " }).errors.apiKey);
  assert.ok(
    validateWhatsappConfig({ ...ok, recipients: [] }).errors.recipients,
  );
  assert.ok(
    validateWhatsappConfig({
      ...ok,
      recipients: [
        { id: "a", name: "A", phone: "0812", type: "personal", active: true },
      ],
    }).errors.recipients,
  );
  assert.ok(
    validateWhatsappConfig({
      ...ok,
      recipients: ok.recipients.map((r) => ({ ...r, active: false })),
    }).errors.recipients,
  );
  assert.ok(validateWhatsappConfig({ ...ok, template: "  " }).errors.template);
  // nonaktif: token dan penerima boleh kosong
  assert.equal(
    validateWhatsappConfig({
      ...defaultWhatsappConfig,
      apiKey: "",
      recipients: [],
    }).valid,
    true,
  );
});

test("recipients: addRecipient", () => {
  const base = defaultWhatsappConfig.recipients;
  const r = addRecipient(base, {
    name: " Ahmad ",
    phone: "0812-9999 0000",
    type: "personal",
  });
  assert.equal(r.ok, true);
  assert.equal(r.recipient.phone, "6281299990000");
  assert.equal(r.recipient.name, "Ahmad");
  assert.equal(r.recipient.active, true);
  assert.equal(r.list.length, base.length + 1);
  assert.equal(base.length, 2); // input tidak diubah
  assert.equal(new Set(r.list.map((x) => x.id)).size, r.list.length);
  // id unik walau ada celah
  const gap = addRecipient(
    [
      {
        id: "rcp-2",
        name: "A",
        phone: "6281111111111",
        type: "personal",
        active: true,
      },
    ],
    {
      name: "B",
      phone: "6282222222222",
      type: "personal",
    },
  );
  assert.notEqual(gap.recipient.id, "rcp-2");
  // grup
  const g = addRecipient(base, {
    name: "G",
    phone: "120363012345678901@g.us",
    type: "group",
  });
  assert.equal(g.ok, true);
  assert.equal(g.recipient.phone, "120363012345678901@g.us");
  // ditolak
  assert.equal(
    addRecipient(base, { name: " ", phone: "081234567891", type: "personal" })
      .ok,
    false,
  );
  assert.equal(
    addRecipient(base, { name: "X", phone: "0812", type: "personal" }).ok,
    false,
  );
  assert.equal(
    addRecipient(base, { name: "X", phone: "abc", type: "group" }).ok,
    false,
  );
  assert.equal(
    addRecipient(base, { name: "X", phone: "081234567890", type: "personal" })
      .ok,
    false,
  ); // duplikat (dinormalisasi)
  assert.equal(
    addRecipient(base, { name: "X", phone: "+6281234567890", type: "personal" })
      .ok,
    false,
  );
});

test("recipients: toggle, remove, active phones", () => {
  const base = defaultWhatsappConfig.recipients;
  const t = toggleRecipient(base, "rcp-1");
  assert.equal(t.find((r) => r.id === "rcp-1").active, false);
  assert.equal(base.find((r) => r.id === "rcp-1").active, true);
  assert.deepEqual(getActiveRecipientPhones(t), ["6289876543210"]);
  assert.deepEqual(getActiveRecipientPhones(base), [
    "6281234567890",
    "6289876543210",
  ]);
  assert.equal(
    toggleRecipient(t, "rcp-1").find((r) => r.id === "rcp-1").active,
    true,
  );
  assert.equal(toggleRecipient(base, "nope").length, 2);
  assert.deepEqual(
    removeRecipient(base, "rcp-2").map((r) => r.id),
    ["rcp-1"],
  );
  assert.equal(removeRecipient(base, "nope").length, 2);
  assert.deepEqual(getActiveRecipientPhones([]), []);
});

test("renderWhatsappMessage", () => {
  const a = {
    severity: "KRITIS",
    kind: "offline",
    subject: "S",
    router: "R",
    time: "T",
    message: "M",
  };
  assert.equal(
    renderWhatsappMessage(
      "{severity}|{kind}|{subject}|{router}|{time}|{message}|{severity}",
      a,
    ),
    "KRITIS|offline|S|R|T|M|KRITIS",
  );
  assert.equal(
    renderWhatsappMessage("{tidak_ada} {kind}", { ...a, kind: "{severity}" }),
    "{tidak_ada} {severity}",
  );
  assert.ok(
    renderWhatsappMessage(defaultWhatsappConfig.template, a).includes(
      "Router: R",
    ),
  );
});

function fakeStorage() {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

test("registry: get, save, reset", () => {
  const s = fakeStorage();
  const r = createWhatsappRegistry(() => s);
  assert.deepEqual(r.get(), defaultWhatsappConfig);
  let n = 0;
  const off = r.subscribe(() => n++);
  const cfg = {
    ...defaultWhatsappConfig,
    enabled: true,
    apiKey: "abc",
    recipients: [
      {
        id: "rcp-1",
        name: "X",
        phone: "6281111111111",
        type: "personal",
        active: true,
      },
    ],
  };
  r.save(cfg);
  assert.deepEqual(r.get(), cfg);
  assert.equal(r.get(), r.get());
  assert.deepEqual(JSON.parse(s.m.get(WHATSAPP_STORAGE_KEY)), cfg);
  r.reset();
  assert.deepEqual(r.get(), defaultWhatsappConfig);
  assert.equal(s.m.has(WHATSAPP_STORAGE_KEY), false);
  assert.equal(n, 2);
  off();
});

test("registry: isi rusak dan storage terblokir", () => {
  const s = fakeStorage();
  s.m.set(WHATSAPP_STORAGE_KEY, "{rusak");
  assert.deepEqual(
    createWhatsappRegistry(() => s).get(),
    defaultWhatsappConfig,
  );
  s.m.set(
    WHATSAPP_STORAGE_KEY,
    JSON.stringify({
      enabled: 1,
      provider: "x",
      recipients: ["0812", "6281234567890"],
    }),
  );
  const g = createWhatsappRegistry(() => s).get();
  assert.equal(g.enabled, false);
  assert.equal(g.provider, "fonnte");
  // format lama (string) dimigrasi; yang tidak valid dibuang
  assert.equal(g.recipients.length, 1);
  assert.equal(g.recipients[0].phone, "6281234567890");
  assert.equal(g.recipients[0].active, true);

  const blocked = createWhatsappRegistry(() => {
    throw new Error("blocked");
  });
  const cfg = { ...defaultWhatsappConfig, apiKey: "mem" };
  blocked.save(cfg);
  assert.deepEqual(blocked.get(), cfg);
  blocked.reset();
  assert.deepEqual(blocked.get(), defaultWhatsappConfig);
});
