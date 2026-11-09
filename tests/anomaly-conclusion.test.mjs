import test from "node:test";
import assert from "node:assert/strict";
import { diagnosticLayers } from "../src/lib/diagnostics.ts";
import {
  aggregateConclusions,
  clipDetail,
  formatAge,
  getRecommendation,
  RECOMMENDED_ACTIONS,
  scopeBadgeLabels,
} from "../src/lib/dashboard/anomaly-conclusion.ts";

const now = new Date("2026-10-25T12:00:00.000Z");

function makeRun(over = {}) {
  return {
    id: "run-" + Math.random().toString(36).slice(2, 8),
    customerId: "cust-1",
    customerName: "Pelanggan 1",
    pppoeUsername: "user1@isp",
    triggerMode: "manual",
    triggeredBy: "NOC Admin",
    triggerReason: "manual_check",
    triggerSourceRef: null,
    mergedCount: 0,
    lastMergedAt: null,
    status: "done",
    error: null,
    createdAt: "2026-10-25T11:00:00.000Z",
    startedAt: "2026-10-25T11:00:01.000Z",
    finishedAt: "2026-10-25T11:00:10.000Z",
    verdictLayer: "optik",
    verdictDetail: "Redaman optik melebihi ambang batas (-28.5 dBm)",
    isSharedFault: false,
    verdictScope: "own",
    verdictRoot: null,
    verdictSecondary: [],
    verdictHeld: false,
    complaintAt: null,
    timeline: [],
    ...over,
  };
}

test("empty: array kosong menghasilkan ringkasan kosong aman", () => {
  const res = aggregateConclusions([], now);
  assert.equal(res.totalDiagnosed, 0);
  assert.equal(res.sharedCount, 0);
  assert.equal(res.ownCount, 0);
  assert.equal(res.unknownCount, 0);
  assert.equal(res.failedCount, 0);
  assert.equal(
    res.headline,
    "0 pelanggan didiagnosa: 0 gangguan bersama, 0 gangguan pelanggan sendiri, 0 belum dapat dipastikan",
  );
  assert.deepEqual(res.layerDistribution, []);
  assert.deepEqual(res.topCards, []);
});

test("failed runs excluded: status failed/queued/running tidak dihitung dalam kesimpulan", () => {
  const runs = [
    makeRun({ id: "r-done", customerId: "c1", status: "done" }),
    makeRun({
      id: "r-fail-1",
      customerId: "c2",
      status: "failed",
      error: "Timeout router",
    }),
    makeRun({
      id: "r-fail-2",
      customerId: "c3",
      status: "failed",
      error: "Gagal terhubung",
    }),
    makeRun({ id: "r-queued", customerId: "c4", status: "queued" }),
    makeRun({ id: "r-running", customerId: "c5", status: "running" }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.totalDiagnosed, 1);
  assert.equal(res.failedCount, 2);
  assert.equal(res.topCards.length, 1);
  assert.equal(res.topCards[0].runId, "r-done");
});

test("latest-per-customer: hanya run selesai terbaru per pelanggan yang dipertahankan", () => {
  const runs = [
    makeRun({
      id: "run-old",
      customerId: "c1",
      finishedAt: "2026-10-25T10:00:00.000Z",
      verdictLayer: "optik",
      verdictDetail: "Kondisi lama",
    }),
    makeRun({
      id: "run-new",
      customerId: "c1",
      finishedAt: "2026-10-25T11:45:00.000Z",
      verdictLayer: "ont",
      verdictDetail: "Kondisi baru",
    }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.totalDiagnosed, 1);
  assert.equal(res.topCards.length, 1);
  assert.equal(res.topCards[0].runId, "run-new");
  assert.equal(res.topCards[0].layer, "ont");
  assert.equal(res.topCards[0].detail, "Kondisi baru");
  // Hanya layer ont yang muncul di layerDistribution
  assert.equal(res.layerDistribution.length, 1);
  assert.equal(res.layerDistribution[0].layer, "ont");
  assert.equal(res.layerDistribution[0].count, 1);
});

test("shared-fault tanpa customer: deduplikasi per root name", () => {
  const runs = [
    makeRun({
      id: "shared-old",
      customerId: null,
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: {
        kind: "odp",
        name: "ODP-MAWAR-01",
        affected: 3,
        served: 8,
      },
      finishedAt: "2026-10-25T10:00:00.000Z",
      verdictLayer: "optik",
    }),
    makeRun({
      id: "shared-new",
      customerId: null,
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: {
        kind: "odp",
        name: "ODP-MAWAR-01",
        affected: 5,
        served: 8,
      },
      finishedAt: "2026-10-25T11:30:00.000Z",
      verdictLayer: "optik",
    }),
    makeRun({
      id: "shared-other",
      customerId: null,
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: {
        kind: "odp",
        name: "ODP-MELATI-02",
        affected: 2,
        served: 8,
      },
      finishedAt: "2026-10-25T11:15:00.000Z",
      verdictLayer: "optik",
    }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.totalDiagnosed, 2);
  assert.equal(res.sharedCount, 2);
  assert.equal(res.ownCount, 0);
  assert.equal(res.unknownCount, 0);

  // ODP-MAWAR-01 mengambil run-new (affected: 5)
  const mawarCard = res.topCards.find((c) => c.title === "ODP-MAWAR-01");
  assert.ok(mawarCard);
  assert.equal(mawarCard.runId, "shared-new");
  assert.equal(mawarCard.affectedCount, 5);
});

test("gangguan bersama yang sama didiagnosa dari banyak pelanggan: satu kartu per akar, hitungan tetap utuh", () => {
  const root = { kind: "odp", name: "ODP-MAWAR-01", affected: 3, served: 8 };
  const runs = [
    makeRun({
      id: "s1",
      customerId: "c1",
      customerName: "Budi",
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: root,
      finishedAt: "2026-10-25T11:00:00.000Z",
    }),
    makeRun({
      id: "s2",
      customerId: "c2",
      customerName: "Siti",
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: root,
      finishedAt: "2026-10-25T11:01:00.000Z",
    }),
    makeRun({
      id: "s3",
      customerId: "c3",
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: null,
      finishedAt: "2026-10-25T11:02:00.000Z",
    }),
    makeRun({
      id: "s4",
      customerId: "c4",
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: null,
      finishedAt: "2026-10-25T11:03:00.000Z",
    }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.totalDiagnosed, 4);
  assert.equal(res.sharedCount, 4);
  assert.equal(res.topCards.length, 2);
});

test("shared-first dan urutan kartu: gangguan bersama didahulukan (most affected), lalu gangguan sendiri terbaru", () => {
  const runs = [
    makeRun({
      id: "c-own-1",
      customerId: "c1",
      customerName: "Budi (Own 1)",
      verdictScope: "own",
      finishedAt: "2026-10-25T11:55:00.000Z", // 5 mnt lalu
    }),
    makeRun({
      id: "c-own-2",
      customerId: "c2",
      customerName: "Siti (Own 2)",
      verdictScope: "own",
      finishedAt: "2026-10-25T11:50:00.000Z", // 10 mnt lalu
    }),
    makeRun({
      id: "c-shared-minor",
      customerId: null,
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: { kind: "odp", name: "ODP-KECIL", affected: 3, served: 8 },
      finishedAt: "2026-10-25T11:00:00.000Z",
    }),
    makeRun({
      id: "c-shared-major",
      customerId: null,
      customerName: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: {
        kind: "router",
        name: "UPLINK-UTAMA",
        affected: 45,
        served: 100,
      },
      finishedAt: "2026-10-25T10:30:00.000Z",
      verdictLayer: "hulu",
    }),
    makeRun({
      id: "c-own-3",
      customerId: "c3",
      customerName: "Andi (Own 3)",
      verdictScope: "own",
      finishedAt: "2026-10-25T11:40:00.000Z", // 20 mnt lalu
    }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.totalDiagnosed, 5);
  // Maksimum 3 kartu teratas
  assert.equal(res.topCards.length, 3);

  // Kartu 1: Shared major (45 terdampak)
  assert.equal(res.topCards[0].runId, "c-shared-major");
  assert.equal(res.topCards[0].scope, "shared");

  // Kartu 2: Shared minor (3 terdampak)
  assert.equal(res.topCards[1].runId, "c-shared-minor");
  assert.equal(res.topCards[1].scope, "shared");

  // Kartu 3: Own terbaru (Budi - 11:55)
  assert.equal(res.topCards[2].runId, "c-own-1");
  assert.equal(res.topCards[2].scope, "own");
});

test("counts & headline: kalimat deterministik", () => {
  const runs = [
    makeRun({
      id: "r1",
      customerId: "c1",
      verdictScope: "shared",
      isSharedFault: true,
    }),
    makeRun({
      id: "r2",
      customerId: "c2",
      verdictScope: "shared",
      isSharedFault: true,
    }),
    makeRun({ id: "r3", customerId: "c3", verdictScope: "own" }),
    makeRun({ id: "r4", customerId: "c4", verdictScope: "unknown" }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.totalDiagnosed, 4);
  assert.equal(res.sharedCount, 2);
  assert.equal(res.ownCount, 1);
  assert.equal(res.unknownCount, 1);
  assert.equal(
    res.headline,
    "4 pelanggan didiagnosa: 2 gangguan bersama, 1 gangguan pelanggan sendiri, 1 belum dapat dipastikan",
  );
});

test("deterministic with shuffled input: hasil identik meskipun urutan input acak", () => {
  const runs = [
    makeRun({
      id: "r1",
      customerId: "c1",
      finishedAt: "2026-10-25T11:00:00.000Z",
      verdictLayer: "optik",
    }),
    makeRun({
      id: "r2",
      customerId: "c1",
      finishedAt: "2026-10-25T11:30:00.000Z",
      verdictLayer: "optik",
    }), // newer c1
    makeRun({
      id: "r3",
      customerId: "c2",
      finishedAt: "2026-10-25T11:10:00.000Z",
      verdictLayer: "ont",
      verdictScope: "own",
    }),
    makeRun({
      id: "r4",
      customerId: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: { kind: "odp", name: "ODP-A", affected: 10, served: 20 },
      finishedAt: "2026-10-25T10:00:00.000Z",
      verdictLayer: "optik",
    }),
    makeRun({
      id: "r5",
      customerId: null,
      isSharedFault: true,
      verdictScope: "shared",
      verdictRoot: {
        kind: "router",
        name: "R-CORE",
        affected: 50,
        served: 200,
      },
      finishedAt: "2026-10-25T09:00:00.000Z",
      verdictLayer: "hulu",
    }),
  ];

  const baseline = JSON.stringify(aggregateConclusions(runs, now));

  // Acak urutan berkali-kali
  for (let seed = 1; seed <= 10; seed++) {
    const shuffled = [...runs].sort(() => Math.sin(seed) - 0.5);
    const result = JSON.stringify(aggregateConclusions(shuffled, now));
    assert.equal(
      result,
      baseline,
      `Gagal deterministik pada iterasi ke-${seed}`,
    );
  }
});

test("recommendation exists for every layer in diagnosticLayers", () => {
  for (const layer of diagnosticLayers) {
    const action = RECOMMENDED_ACTIONS[layer.id];
    assert.ok(
      action,
      `Rekomendasi untuk lapisan '${layer.id}' harus terdefinisi`,
    );
    assert.equal(typeof action, "string");
    assert.ok(action.length > 10, `Rekomendasi '${layer.id}' terlalu pendek`);

    // getRecommendation harus mengembalikan aksi yang tepat
    assert.equal(getRecommendation(layer.id), action);
  }

  // Lapisan null atau tidak dikenal memberikan fallback aman
  assert.equal(
    getRecommendation(null),
    "Tinjau temuan diagnosa dan konfigurasi jaringan.",
  );
  assert.equal(
    getRecommendation("layer_fiktif"),
    "Tinjau temuan diagnosa dan konfigurasi jaringan.",
  );
});

test("clipDetail memotong teks panjang secara deterministik pada batas ~160 karakter", () => {
  assert.equal(clipDetail(null), "—");
  assert.equal(clipDetail(""), "—");

  const shortText = "Redaman Rx -28.2 dBm melebihi ambang batas -27 dBm.";
  assert.equal(clipDetail(shortText), shortText);

  const longText = "A".repeat(200);
  const clipped = clipDetail(longText, 160);
  assert.equal(clipped.length, 160);
  assert.ok(clipped.endsWith("…"));
});

test("formatAge memformat selisih waktu dalam bahasa Indonesia secara deterministik", () => {
  assert.equal(formatAge(null, now), "—");

  // 30 detik lalu -> baru saja
  assert.equal(formatAge("2026-10-25T11:59:30.000Z", now), "baru saja");

  // 15 menit lalu
  assert.equal(formatAge("2026-10-25T11:45:00.000Z", now), "15 menit lalu");

  // 2 jam lalu
  assert.equal(formatAge("2026-10-25T10:00:00.000Z", now), "2 jam lalu");

  // 3 hari lalu
  assert.equal(formatAge("2026-10-22T12:00:00.000Z", now), "3 hari lalu");
});

test("scopeBadgeLabels memetakan 3 status cakupan secara tepat", () => {
  assert.equal(scopeBadgeLabels.own, "Gangguan pelanggan ini");
  assert.equal(scopeBadgeLabels.shared, "Gangguan bersama");
  assert.equal(scopeBadgeLabels.unknown, "Cakupan belum dapat dipastikan");
});

test("AnomalyConclusion UI component: kontrak DOM, testid, aksesibilitas, dan tokens", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    "src/components/dashboard/anomaly-conclusion.tsx",
    "utf8",
  );

  // Ekspor fungsi komponen
  assert.match(source, /export function AnomalyConclusion/);

  // Kontrak testid yang disyaratkan
  assert.ok(source.includes('data-testid="anomaly-conclusion"'));
  assert.ok(source.includes('data-testid="conclusion-headline"'));
  assert.ok(source.includes('data-testid="conclusion-layer-dist"'));
  assert.ok(source.includes('data-testid="conclusion-card"'));
  assert.ok(source.includes('data-testid="conclusion-info"'));

  // Catatan fakta cara menghitung (50 terbaru)
  assert.ok(source.includes("Dihitung dari diagnosa terakhir tiap pelanggan"));
  assert.ok(source.includes("maks 50 data terbaru"));

  // Catatan aturan tetap berdasarkan lapisan
  assert.match(source, /aturan tetap berdasarkan lapisan, bukan probabilitas/i);
  // Tombol disclosure 'Apa ini?'
  assert.ok(source.includes("Apa ini?"));
  assert.ok(source.includes("aria-expanded"));

  // Aksesibilitas: section dengan aria-labelledby
  assert.match(source, /<section[^>]+aria-labelledby="conclusion-panel-title"/);
  assert.match(source, /id="conclusion-panel-title"/);

  // Saran tindak lanjut & Aturan tetap (bukan probabilitas/persentase buatan)
  assert.ok(source.includes("Saran tindak lanjut"));
  assert.ok(source.includes("aturan tetap"));
  assert.ok(!source.includes("Logic V5"));
  assert.ok(!source.includes("Engine V5"));

  // CustomEvent dispatcher
  assert.match(source, /new CustomEvent\("noc:open-diagnostic"/);

  // Tidak ada hex color keras (#123456)
  assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}/);

  // Tidak ada teks di bawah 11px
  assert.doesNotMatch(source, /text-\[(?:[0-9]|10)px\]/);
});

test("sources & explain terisi pada tiap kartu kesimpulan via layerInfo", () => {
  const runs = [
    makeRun({
      id: "run-mikrotik",
      customerId: "c-mikro",
      verdictLayer: "mikrotik",
    }),
    makeRun({
      id: "run-optik",
      customerId: "c-optik",
      verdictLayer: "optik",
    }),
  ];

  const res = aggregateConclusions(runs, now);
  assert.equal(res.topCards.length, 2);

  const mikroCard = res.topCards.find((c) => c.layer === "mikrotik");
  assert.ok(mikroCard);
  assert.ok(Array.isArray(mikroCard.sources));
  assert.ok(mikroCard.sources.length > 0);
  assert.ok(
    typeof mikroCard.explain === "string" && mikroCard.explain.length > 0,
  );

  // Sumber MikroTik harus memiliki format sistem MikroTik dan path RouterOS
  const pppActive = mikroCard.sources.find((s) => s.path === "/ppp/active");
  assert.ok(pppActive);
  assert.equal(pppActive.system, "MikroTik");
});
