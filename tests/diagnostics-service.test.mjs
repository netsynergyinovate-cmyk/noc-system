import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { register } from "tsx/esm/api";

// Butuh database uji sekali pakai dari `npm test`; dilewati bila dijalankan
// langsung dengan node --test.
const skip =
  !process.env.STARTER_TEST_RUN?.startsWith("starter-pg-test-") &&
  "jalankan lewat npm test";

const require = createRequire(import.meta.url);
const so = require.resolve("server-only");
require.cache[so] = { id: so, filename: so, loaded: true, exports: {} };
register();

const load = async () => ({
  ...(await import("../src/services/diagnostics.service.ts")),
  ...(await import("../src/db/index.ts")),
  schema: await import("../src/db/schema/index.ts"),
  enc: await import("../src/lib/encryption.ts"),
  orm: await import("drizzle-orm"),
});

let m;
const tag = randomBytes(4).toString("hex");
const ids = {};

async function waitDone(runId) {
  for (let i = 0; i < 100; i++) {
    const run = await m.getDiagnosticRun(runId);
    if (run.status === "done" || run.status === "failed") return run;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("diagnosa tidak selesai dalam 10 detik");
}

const policy = (over = {}) => ({
  triggerAlert: true,
  triggerTicket: true,
  triggerBilling: true,
  dedupeMinutes: 15,
  massThreshold: 1000,
  massWindowMinutes: 5,
  ...over,
});

test("siapkan data", { skip }, async () => {
  m = await load();
  const { db, schema, enc } = m;
  // Port tertutup: pembacaan router gagal cepat (connection refused).
  const [router] = await db
    .insert(schema.routers)
    .values({
      name: `diag-${tag}`,
      host: `127.0.0.1:${20000 + Math.floor(Math.random() * 30000)}`,
      username: "x",
      passwordEnc: enc.encryptDeviceCredential("x"),
    })
    .returning();
  const [a, b] = await db
    .insert(schema.customers)
    .values([
      { name: `A ${tag}`, pppoeUsername: `a-${tag}`, routerId: router.id },
      { name: `B ${tag}`, pppoeUsername: `b-${tag}`, routerId: router.id },
    ])
    .returning();
  const [olt] = await db
    .insert(schema.olts)
    .values({
      name: `olt-${tag}`,
      host: `olt-${tag}.invalid`,
      brand: "hsgq",
      driver: "hsgq-telnet",
      username: "x",
      passwordEnc: enc.encryptDeviceCredential("x"),
    })
    .returning();
  await db.insert(schema.oltOnus).values({
    oltId: olt.id,
    ponIndex: 1,
    onuIndex: 1,
    customerId: a.id,
    status: "online",
    rxPower: -20,
  });
  await db
    .insert(schema.billingStatus)
    .values({ customerId: a.id, status: "isolir" });
  Object.assign(ids, { router: router.id, a: a.id, b: b.id });
  await m.updateDiagnosticPolicy(policy(), "test");
});

test(
  "manual: semua lapisan tercatat, router gagal = tidak dapat diperiksa, billing isolir jadi kesimpulan",
  { skip },
  async () => {
    const started = await m.startManualDiagnostic(ids.a, {
      id: "u1",
      name: "Operator Uji",
    });
    assert.equal(started.reused, false);
    assert.equal(started.run.triggerMode, "manual");
    const run = await waitDone(started.run.id);
    assert.equal(run.status, "done");
    assert.equal(run.verdictLayer, "billing");
    const layers = new Set(run.findings.map((f) => f.layer));
    for (const l of [
      "hulu",
      "mikrotik",
      "log",
      "firewall",
      "optik",
      "ont",
      "trafik",
      "billing",
    ]) {
      assert.ok(layers.has(l), `lapisan ${l} tidak tercatat`);
    }
    const ppp = run.findings.find((f) => f.metric === "pppoe_active");
    assert.equal(ppp.status, "unchecked");
    assert.equal(run.findings.find((f) => f.metric === "onu_rx").status, "ok");
    assert.equal(
      run.findings.find((f) => f.metric === "billing_status").status,
      "fail",
    );
    assert.equal(run.triggeredBy, "Operator Uji");
  },
);

test(
  "manual: tekan lagi saat masih berjalan = diarahkan ke run yang sama",
  { skip },
  async () => {
    const { db, schema } = m;
    const [pending] = await db
      .insert(schema.diagnosticRuns)
      .values({
        customerId: ids.b,
        routerId: ids.router,
        triggerMode: "manual",
        triggerReason: "manual",
        priority: 0,
      })
      .returning();
    const again = await m.startManualDiagnostic(ids.b, {
      id: "u1",
      name: "Operator Uji",
    });
    assert.equal(again.reused, true);
    assert.equal(again.run.id, pending.id);
    await db
      .update(schema.diagnosticRuns)
      .set({ status: "failed" })
      .where(m.orm.eq(schema.diagnosticRuns.id, pending.id));
  },
);

test(
  "otomatis: kejadian kedua dalam jendela digabung; kebijakan mati = tidak jalan",
  { skip },
  async () => {
    const first = await m.requestAutoDiagnostic({
      customerId: ids.b,
      reason: "alert_offline",
      sourceRef: "alert:x",
    });
    assert.equal(first, "queued");
    assert.equal(
      await m.requestAutoDiagnostic({
        customerId: ids.b,
        reason: "ticket",
        sourceRef: "alert:y",
      }),
      "merged",
    );
    const [run] = await m.listDiagnosticRuns({ customerId: ids.b, limit: 1 });
    assert.equal(run.triggerMode, "auto");
    assert.equal(run.mergedCount, 1);
    await waitDone(run.id);

    await m.updateDiagnosticPolicy(policy({ triggerAlert: false }), "test");
    assert.equal(
      await m.requestAutoDiagnostic({
        customerId: ids.a,
        reason: "alert_optical",
        sourceRef: null,
      }),
      "disabled",
    );
  },
);

test(
  "billing RunsNet: status aktif, tunggakan, lapisan router & ONT tidak dapat diperiksa",
  { skip },
  async () => {
    const { db, schema } = m;
    await db
      .insert(schema.runsnetCustomers)
      .values({
        custId: `b-${tag}`,
        name: `B ${tag}`,
        status: "Active",
        connectivity: "Terhubung",
      });
    await db.insert(schema.runsnetInvoices).values({
      invoiceCode: `INV-${tag}`,
      custId: `b-${tag}`,
      custName: `B ${tag}`,
      dueDate: "2020-01-20",
      amount: 150000,
      remainingAmount: 150000,
      status: "unpaid",
    });
    const started = await m.startManualDiagnostic(ids.b, {
      id: "u1",
      name: "Operator Uji",
    });
    const run = await waitDone(started.run.id);
    const by = Object.fromEntries(run.findings.map((f) => [f.metric, f]));
    assert.equal(by.billing_status.status, "ok");
    assert.equal(by.billing_status.value, "Active");
    assert.equal(by.arrears.status, "warn");
    assert.equal(by.billing_network.status, "unchecked");
    assert.equal(by.billing_mismatch.status, "unchecked");
    assert.equal(by.ont_found.status, "unchecked");
    assert.equal(by.ringkasan.status, "unchecked");
    // Router tak terbaca dan tidak ada yang gagal: hanya peringatan tunggakan.
    assert.equal(run.verdictLayer, "billing");
  },
);

test(
  "log: syslog tersimpan dipakai, putus berulang = fail, garis waktu relatif keluhan",
  { skip },
  async () => {
    const { db, schema } = m;
    const now = Date.now();
    const at = (minAgo, sec = 0) =>
      new Date(now - minAgo * 60_000 + sec * 1000);
    const user = `a-${tag}`;
    const rows = [];
    // Cakupan 3 jam ke belakang, lalu 4 siklus putus-nyambung sekitar keluhan.
    rows.push({
      routerId: ids.router,
      receivedAt: at(180),
      topics: "system,info",
      message: "router mulai mengirim log",
    });
    for (const minAgo of [40, 30, 20, 5]) {
      rows.push({
        routerId: ids.router,
        receivedAt: at(minAgo),
        topics: "pppoe,ppp,info,account",
        message: `${user} logged in, 0.0.0.0 from AA:BB:CC:DD:EE:FF`,
      });
      rows.push({
        routerId: ids.router,
        receivedAt: at(minAgo, 1),
        topics: "pppoe,ppp,info",
        message: `<pppoe-${user}>: could not determine remote address, using 0.0.0.0`,
      });
      rows.push({
        routerId: ids.router,
        receivedAt: at(minAgo, 2),
        topics: "interface,info",
        message: `<pppoe-${user}> detect UNKNOWN`,
      });
      rows.push({
        routerId: ids.router,
        receivedAt: at(minAgo, 3),
        topics: "pppoe,ppp,info,account",
        message: `${user} logged out, 3 0 0 0 0 from AA:BB:CC:DD:EE:FF`,
      });
    }
    rows.push({
      routerId: ids.router,
      receivedAt: at(1),
      topics: "pppoe,ppp,info,account",
      message: "pelanggan-lain logged out, 9 0 0 0 0 from 11:22",
    });
    await db.insert(schema.syslogEvents).values(rows);

    const complaintAt = at(25);
    const started = await m.startManualDiagnostic(
      ids.a,
      { id: "u1", name: "Operator Uji" },
      complaintAt,
    );
    const run = await waitDone(started.run.id);
    assert.equal(new Date(run.complaintAt).getTime(), complaintAt.getTime());
    const by = Object.fromEntries(run.findings.map((f) => [f.metric, f]));
    assert.equal(by.log_coverage.status, "ok");
    assert.match(by.log_coverage.sourceRef, /syslog_events/);
    assert.equal(by.ppp_flap.status, "fail");
    assert.match(by.ppp_flap.value, /4 kali \(2 sebelum, 2 sesudah keluhan\)/);
    assert.equal(by.ppp_no_address.status, "fail");
    assert.equal(by.log_noise.value, "4 baris");
    assert.ok(run.timeline.length >= 12);
    assert.ok(run.timeline.every((e) => !e.detail.includes("pelanggan-lain")));
  },
);

test(
  "otomatis: gangguan massal menahan diagnosa per pelanggan",
  { skip },
  async () => {
    const { db, schema } = m;
    await m.updateDiagnosticPolicy(policy({ massThreshold: 2 }), "test");
    await db.insert(schema.alerts).values([
      {
        routerId: ids.router,
        customerId: ids.a,
        type: "offline",
        severity: "critical",
      },
      {
        routerId: ids.router,
        customerId: ids.b,
        type: "offline",
        severity: "critical",
      },
    ]);
    assert.equal(
      await m.requestAutoDiagnostic({
        customerId: ids.a,
        reason: "alert_offline",
        sourceRef: null,
      }),
      "held",
    );
    assert.equal(
      await m.requestAutoDiagnostic({
        customerId: ids.b,
        reason: "alert_offline",
        sourceRef: null,
      }),
      "held",
    );
    const shared = (await m.listDiagnosticRuns({ limit: 50 })).find(
      (r) => r.isSharedFault,
    );
    assert.ok(shared, "catatan gangguan bersama tidak dibuat");
    assert.ok(shared.mergedCount >= 1);
    const detail = await m.getDiagnosticRun(shared.id);
    assert.equal(detail.findings[0].status, "fail");
  },
);

after(async () => {
  if (m) {
    await m.updateDiagnosticPolicy(policy({ massThreshold: 10 }), "test");
    await m.getRawPool().end();
  }
});
