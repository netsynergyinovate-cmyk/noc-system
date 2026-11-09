import test from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();

const {
  formatDurationCompact,
  getWindowTimeSpan,
  getWindowLabelWithSpan,
  formatWibDateTime,
  formatEvidenceSummary,
} = await import("../src/lib/customer-evidence-text.ts");

test("formatDurationCompact: format ringkas menit dan jam", () => {
  assert.equal(formatDurationCompact(0), "0 m");
  assert.equal(formatDurationCompact(30), "1 m"); // dibulatkan ke menit terdekat
  assert.equal(formatDurationCompact(300), "5 m");
  assert.equal(formatDurationCompact(3600), "1 j 0 m");
  assert.equal(formatDurationCompact(3660), "1 j 1 m");
  assert.equal(formatDurationCompact(7500), "2 j 5 m");
});

test("getWindowTimeSpan & getWindowLabelWithSpan: batas WIB jam sibuk dan di luar jam sibuk", () => {
  assert.equal(getWindowTimeSpan("siang"), "11:00–12:30");
  assert.equal(getWindowTimeSpan("pulang-sekolah"), "12:30–15:30");
  assert.equal(getWindowTimeSpan("pulang-kerja"), "15:30–17:30");
  assert.equal(getWindowTimeSpan("magrib-malam"), "17:30–23:00");
  assert.equal(getWindowTimeSpan("luar"), "23:00–11:00");
  assert.equal(getWindowTimeSpan("unknown-window"), "");

  assert.equal(
    getWindowLabelWithSpan({ id: "siang", label: "Siang" }),
    "Siang (11:00–12:30)",
  );
  assert.equal(
    getWindowLabelWithSpan({ id: "luar", label: "Di luar jam sibuk" }),
    "Di luar jam sibuk (23:00–11:00)",
  );
});

test("formatWibDateTime: waktu dalam WIB Asia/Jakarta", () => {
  // 1761384000 = 2025-10-25 09:20:00 UTC = 16:20 WIB
  const res = formatWibDateTime(1761384000);
  assert.ok(res.includes("WIB"), `Harus berakhiran WIB: ${res}`);
  assert.ok(res.includes("2025"), `Harus berisi tahun 2025: ${res}`);
  assert.ok(res.includes("16"), `Harus berisi jam 16: ${res}`);
  assert.equal(formatWibDateTime(null), "–");
  assert.equal(formatWibDateTime(0), "–");
});

test("formatEvidenceSummary: menghasilkan ringkasan teks lengkap dan deterministik", () => {
  const mockEvidence = {
    range: "3d",
    from: 1761124800,
    to: 1761384000,
    coverage: {
      trafficSince: 1761124800,
      eventsSince: 1761124800,
      trafficBuckets: 864,
      expectedBuckets: 864,
      eventsCoverRange: true,
      notes: ["Data riwayat koneksi dan trafik lengkap untuk rentang 3 hari."],
    },
    connection: {
      state: "up",
      since: 1761350000,
      events: [],
      outages: [
        {
          from: 1761300000,
          to: 1761307500,
          seconds: 7500,
          source: "live",
          windows: ["pulang-kerja"],
        },
        {
          from: 1761340000,
          to: null,
          seconds: 300,
          source: "alert",
          windows: ["magrib-malam"],
        },
      ],
      summary: {
        outageCount: 2,
        downSeconds: 7800,
        uptimePct: 97.0,
        longestOutageSeconds: 7500,
        flapCount: 1,
      },
    },
    windows: [
      {
        id: "luar",
        label: "Di luar jam sibuk",
        bucketCount: 100,
        avgDownMbps: 12.5,
        avgUpMbps: 2.1,
        p95DownMbps: 18.0,
        maxDownMbps: 20.0,
        maxUpMbps: 5.0,
        downSeconds: 0,
        outageStarts: 0,
      },
      {
        id: "siang",
        label: "Siang",
        bucketCount: 50,
        avgDownMbps: 8.2,
        avgUpMbps: 1.5,
        p95DownMbps: 14.1,
        maxDownMbps: 15.0,
        maxUpMbps: 3.0,
        downSeconds: 300,
        outageStarts: 1,
      },
    ],
    daily: [],
    hourly: [],
    findings: [
      {
        severity: "warn",
        text: "Terdeteksi 1 gangguan panjang di jam sibuk sore pulang kerja.",
      },
    ],
    incidents: [
      {
        id: "1761300000",
        from: 1761300000,
        to: 1761307500,
        downSeconds: 7500,
        outageCount: 1,
        longestOutageSeconds: 7500,
        sources: ["live"],
        verdict: "terbukti",
        verdictReason: "Trafik nol selama down.",
        final: true,
        windows: ["pulang-kerja"],
        startWindow: "pulang-kerja",
        outages: [{ from: 1761300000, to: 1761307500 }],
        beforeAvgDownMbps: 15.2,
        afterAvgDownMbps: 14.8,
        queueSecondsDuring: 0,
        scope: {
          kind: "sendiri",
          otherDown: 0,
          routerCustomers: 10,
        },
      },
      {
        id: "1761340000",
        from: 1761340000,
        to: null,
        downSeconds: 300,
        outageCount: 1,
        longestOutageSeconds: 300,
        sources: ["alert"],
        verdict: "kedipan",
        verdictReason: "Durasi < 5 menit tanpa flap berulang.",
        final: false,
        windows: ["magrib-malam"],
        startWindow: "magrib-malam",
        outages: [{ from: 1761340000, to: null }],
        beforeAvgDownMbps: null,
        afterAvgDownMbps: null,
        queueSecondsDuring: null,
        scope: {
          kind: "sendiri",
          otherDown: 0,
          routerCustomers: 10,
        },
      },
    ],
    incidentSummary: {
      real: 1,
      belumTerverifikasi: 0,
      tidakTerbukti: 0,
      kedipan: 1,
      realDownSeconds: 7500,
      realByWindow: {
        siang: 0,
        "pulang-sekolah": 0,
        "pulang-kerja": 1,
        "magrib-malam": 0,
        luar: 0,
      },
      realMassal: 0,
      lastRealAt: 1761300000,
    },
  };

  const text = formatEvidenceSummary(mockEvidence, {
    name: "Budi Santoso",
    pppoeUsername: "budi-01",
  });

  assert.ok(text.includes("BUKTI KELUHAN PELANGGAN (3 HARI)"));
  assert.ok(text.includes("Budi Santoso (budi-01)"));
  assert.ok(text.includes("Status saat ini: Online"));
  assert.ok(text.includes("Gangguan nyata: 1 kali"));
  assert.ok(text.includes("Total durasi down nyata: 2 j 5 m"));
  assert.ok(
    text.includes(
      "Status verifikasi lain: 0 belum terverifikasi, 0 tidak terbukti, 1 kedipan",
    ),
  );
  assert.ok(text.includes("Kejadian putus tercatat: 2 kali"));
  assert.ok(text.includes("Uptime: 97.0%"));
  assert.ok(text.includes("Cakupan: Sendiri"));
  assert.ok(text.includes("Trafik: 15.2 Mbps -> 14.8 Mbps"));
  assert.ok(text.includes("Sore pulang kerja"));
  assert.ok(text.includes("Siang (11:00–12:30)"));
  assert.ok(text.includes("Di luar jam sibuk (23:00–11:00)"));
  // Pastikan off-peak diletakkan setelah siang
  const siangIdx = text.indexOf("Siang (11:00–12:30)");
  const luarIdx = text.indexOf("Di luar jam sibuk (23:00–11:00)");
  assert.ok(siangIdx < luarIdx, "Baris off-peak harus berada di akhir");

  assert.ok(text.includes("[WARN] Terdeteksi 1 gangguan panjang"));
  assert.ok(text.includes("Data riwayat koneksi dan trafik lengkap"));
});

test("formatEvidenceSummary: tanpa gangguan menampilkan teks ramah", () => {
  const mockEvidence = {
    range: "24h",
    from: 1761297600,
    to: 1761384000,
    coverage: {
      trafficSince: 1761297600,
      eventsSince: 1761297600,
      trafficBuckets: 288,
      expectedBuckets: 288,
      eventsCoverRange: true,
      notes: [],
    },
    connection: {
      state: "up",
      since: 1761297600,
      events: [],
      outages: [],
      summary: {
        outageCount: 0,
        downSeconds: 0,
        uptimePct: 100,
        longestOutageSeconds: 0,
        flapCount: 0,
      },
    },
    windows: [],
    daily: [],
    hourly: [],
    findings: [],
    incidents: [],
    incidentSummary: {
      real: 0,
      belumTerverifikasi: 0,
      tidakTerbukti: 0,
      kedipan: 0,
      realDownSeconds: 0,
      realByWindow: {
        siang: 0,
        "pulang-sekolah": 0,
        "pulang-kerja": 0,
        "magrib-malam": 0,
        luar: 0,
      },
      realMassal: 0,
      lastRealAt: null,
    },
  };

  const text = formatEvidenceSummary(mockEvidence);
  assert.ok(
    text.includes("Tidak ada gangguan nyata tercatat pada rentang ini."),
  );
  assert.ok(text.includes("Total durasi down nyata: 0 m"));
  assert.ok(text.includes("Uptime: 100.0%"));
});
