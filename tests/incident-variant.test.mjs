import test from "node:test";
import assert from "node:assert/strict";

const { classifyIncident } =
  await import("../src/lib/dashboard/incident-variant.ts");

function card(kind, over = {}, alertOver = {}) {
  const alert = {
    id: "a1",
    kind,
    customerId: "c1",
    interfaceName: null,
    measured: null,
    ...alertOver,
  };
  return {
    cause: "single",
    alertCount: 1,
    kinds: [{ kind, count: 1 }],
    alerts: [alert],
    ...over,
  };
}

const customers = new Map([
  ["c1", { billingStatus: "lunas", opticalPowerDbm: -20 }],
  ["isolir", { billingStatus: "isolir", opticalPowerDbm: -20 }],
  ["dark", { billingStatus: "lunas", opticalPowerDbm: -45 }],
]);

test("optik: Rx <= -40 = tanpa sinyal; -26 = redaman naik; kosong atau 0 = tidak terbaca", () => {
  assert.equal(
    classifyIncident(card("optical", {}, { measured: -45 }), customers).id,
    "los",
  );
  assert.equal(
    classifyIncident(card("optical", {}, { measured: 0 }), customers).id,
    "noread",
  );
  assert.equal(
    classifyIncident(card("optical", {}, { measured: null }), customers).id,
    "noread",
  );
  const weak = classifyIncident(
    card("optical", {}, { measured: -26.2 }),
    customers,
  );
  assert.equal(weak.id, "redaman");
  assert.match(weak.metric, /-26,2 dBm/);
});

test("offline tanpa pelanggan = router tidak terjangkau, bukan PPPoE putus", () => {
  const router = classifyIncident(
    card("offline", {}, { customerId: null }),
    customers,
  );
  assert.equal(router.id, "router");
  assert.doesNotMatch(router.action, /modem/i);
});

test("offline: isolir billing, optik mati, atau PPPoE putus biasa", () => {
  assert.equal(
    classifyIncident(card("offline", {}, { customerId: "isolir" }), customers)
      .id,
    "isolir",
  );
  assert.equal(
    classifyIncident(card("offline", {}, { customerId: "dark" }), customers).id,
    "los",
  );
  const plain = classifyIncident(card("offline"), customers);
  assert.equal(plain.id, "offline");
  assert.equal(plain.metric, null);
});

test("jenis router memakai jenisnya sendiri; kartu gabungan memakai penjelasan penyebab", () => {
  assert.equal(
    classifyIncident(card("queue", {}, { measured: 97 }), customers).id,
    "queue",
  );
  const grouped = classifyIncident(
    card("offline", { cause: "odp", alertCount: 3 }),
    customers,
  );
  assert.match(grouped.conclusion, /satu ODP/);
});
