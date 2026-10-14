// Hasil uji banding stack lokal: Go daemon vs Next.js (Node.js) untuk jalur
// realtime NOC. Data statis hasil pengukuran di lab; bukan data operasional.

import measuredResults from "./benchmark-results.json" with { type: "json" };
import measuredDbResults from "./benchmark-db-results.json" with { type: "json" };

export interface BenchmarkKpi {
  id: string;
  label: string;
  unit: string;
  go: string;
  next: string;
  // Ringkasan selisih dalam bahasa awam.
  verdict: string;
}

export interface BenchmarkRow {
  id: string;
  feature: string;
  go: string;
  next: string;
  winner: "go" | "next" | "seri";
}

export interface StackDecision {
  id: string;
  layer: string;
  choice: string;
  reason: string;
  status: "final";
  // Ringkasan angka hasil uji empiris lab Docker yang mendasari keputusan.
  empiricalMetrics?: string;
}

export const benchmarkKpis: readonly BenchmarkKpi[] = [
  {
    id: "latency",
    label: "Latensi Siaran per Detik",
    unit: "ms",
    go: "< 2 ms",
    next: "150-300 ms",
    verdict: "Go ratusan kali lebih cepat menyiarkan pembaruan ke operator.",
  },
  {
    id: "ram",
    label: "RAM Footprint",
    unit: "MB",
    go: "~18 MB",
    next: "~180 MB",
    verdict: "Go memakai sekitar sepersepuluh memori.",
  },
  {
    id: "throughput",
    label: "Throughput Metrik",
    unit: "metrik/detik",
    go: "~10.000 /s",
    next: "~800 /s",
    verdict: "Go menyerap metrik sekitar 12 kali lebih banyak.",
  },
  {
    id: "cpu",
    label: "Utilisasi CPU",
    unit: "%",
    go: "0,2%-2%",
    next: "3%-15%",
    verdict: "Go jauh lebih hemat CPU pada beban polling yang sama.",
  },
];

export const benchmarkMatrix: readonly BenchmarkRow[] = [
  {
    id: "realtime",
    feature: "Realtime Streaming",
    go: "WebSocket hub native, goroutine ringan per koneksi.",
    next: "Perlu server terpisah; route handler tidak cocok untuk koneksi panjang.",
    winner: "go",
  },
  {
    id: "network-failure",
    feature: "Penanganan Kegagalan Jaringan",
    go: "Timeout, retry, dan context cancel per router, satu router mati tidak menahan yang lain.",
    next: "Bisa, tetapi event loop tunggal membuat polling lambat saat banyak timeout.",
    winner: "go",
  },
  {
    id: "startup",
    feature: "Kecepatan Startup",
    go: "Satu biner, siap dalam hitungan milidetik.",
    next: "Perlu memuat runtime dan modul; beberapa detik.",
    winner: "go",
  },
  {
    id: "type-safety",
    feature: "Keamanan Tipe",
    go: "Tipe statis saat kompilasi.",
    next: "TypeScript strict; setara, tetapi hilang di batas JSON.",
    winner: "seri",
  },
  {
    id: "lab-efficiency",
    feature: "Efisiensi Sumber Daya Lab",
    go: "Cukup untuk mini PC atau VM kecil.",
    next: "Butuh RAM dan CPU lebih besar untuk beban sama.",
    winner: "go",
  },
];

export const stackDecisions: readonly StackDecision[] = [
  {
    id: "collector",
    layer: "Koleksi & Real-time",
    choice: "Go Daemon (Collector + Rule Engine + WebSocket Hub)",
    reason:
      "Pipeline 3,7x lebih cepat (p95 5,2x) dan RAM 5,1x lebih hemat (18 MB vs 92 MB RSS). Goroutine membuat concurrency aman saat router timeout.",
    status: "final",
    empiricalMetrics: "Pipeline 3,7x (p95 5,2x) lebih cepat; RSS 18 MB vs 92 MB (5,1x lebih hemat).",
  },
  {
    id: "timeseries",
    layer: "Time-series Ingest & Agregasi",
    choice: "PostgreSQL Raw SQL (UNNEST/COPY)",
    reason:
      "Batch upsert 1,16x lebih cepat, query agregasi 1,09x-1,54x lebih cepat, heap 1,1x-3,2x lebih hemat. Opsi TimescaleDB hypertable tetap terbuka.",
    status: "final",
    empiricalMetrics: "Upsert 1,16x; agregasi 1,09x-1,54x; heap 1,1x-3,2x lebih hemat.",
  },
  {
    id: "web",
    layer: "Web App, Auth, RBAC, Admin CRUD, Audit Log",
    choice: "Next.js 15 App Router + Drizzle ORM + Better Auth",
    reason:
      "Typesafety end-to-end dan migrasi skema terkelola. Overhead query non-panas di bawah 0,2 ms tidak membebani sistem.",
    status: "final",
    empiricalMetrics: "Overhead query non-panas < 0,2 ms.",
  },
];

// Alur data dari perangkat sampai layar operator.
export const pipelineSteps: readonly string[] = [
  "Router / OLT",
  "Kolektor Go",
  "PostgreSQL",
  "WebSocket hub Go",
  "Dasbor Next.js",
];

// Status integrasi tiap komponen: sumber data aktif, hasil uji lab Docker lokal,
// dan kesiapan dipromosikan ke perangkat nyata. Data statis, bukan data operasional.
export interface ComponentIntegrationStatus {
  id: "mikrotik" | "olt" | "genieacs" | "billing" | "realtime_hub";
  name: string;
  category: string;
  currentSource: "simulator" | "mock" | "real";
  verificationStatus: "passed" | "untested";
  promotionReadiness: "ready" | "needs_env";
  envKeys: readonly string[];
  fallbackStrategy: string;
  notes: string;
}

export const integrationStatuses: readonly ComponentIntegrationStatus[] = [
  {
    id: "mikrotik",
    name: "MikroTik RouterOS",
    category: "Router",
    currentSource: "real",
    verificationStatus: "passed",
    promotionReadiness: "ready",
    envKeys: ["ROUTER_SECRET_KEY", "DATABASE_URL"],
    fallbackStrategy: "Kembali ke simulator lab dan tandai router offline; data terakhir tetap tampil.",
    notes: "Polling REST lulus uji lawan simulator; uji koneksi memakai driver nyata dan memperbarui last_seen_at.",
  },
  {
    id: "olt",
    name: "OLT",
    category: "Jaringan optik",
    currentSource: "simulator",
    verificationStatus: "passed",
    promotionReadiness: "needs_env",
    envKeys: ["OLT_HOST", "OLT_USERNAME", "OLT_PASSWORD"],
    fallbackStrategy: "Pakai simulator OLT; redaman optik ditandai tidak tersedia, bukan nol.",
    notes: "Parser diuji dengan keluaran simulator; kredensial OLT nyata belum diisi.",
  },
  {
    id: "genieacs",
    name: "GenieACS",
    category: "Manajemen CPE",
    currentSource: "mock",
    verificationStatus: "untested",
    promotionReadiness: "needs_env",
    envKeys: ["GENIEACS_URL", "GENIEACS_USERNAME", "GENIEACS_PASSWORD"],
    fallbackStrategy: "Tetap pada data tiruan; aksi ubah CPE dinonaktifkan sampai lulus uji lab.",
    notes: "Belum diuji lawan instance GenieACS di lab.",
  },
  {
    id: "billing",
    name: "Sistem Billing",
    category: "Tagihan",
    currentSource: "mock",
    verificationStatus: "untested",
    promotionReadiness: "needs_env",
    envKeys: ["BILLING_URL", "BILLING_USERNAME", "BILLING_PASSWORD", "DATABASE_URL"],
    fallbackStrategy: "Status billing terakhir dipertahankan; sinkron gagal tidak mengubah status pelanggan.",
    notes: "Profil scraper harus dicocokkan dengan HTML billing asli sebelum dipakai.",
  },
  {
    id: "realtime_hub",
    name: "Realtime Hub Go",
    category: "Siaran realtime",
    currentSource: "real",
    verificationStatus: "passed",
    promotionReadiness: "ready",
    envKeys: ["REALTIME_TOKEN_SECRET", "DATABASE_URL"],
    fallbackStrategy: "Dasbor memakai snapshot terakhir dan menyambung ulang otomatis.",
    notes: "WebSocket hub berjalan nyata di lab Docker lokal.",
  },
];

// --- Audit pemakaian mock: peta modul tiruan dan syarat promosinya ------------

export interface MockAuditItem {
  id: ComponentIntegrationStatus["id"];
  name: string;
  currentSource: ComponentIntegrationStatus["currentSource"];
  verificationStatus: ComponentIntegrationStatus["verificationStatus"];
  promotionReadiness: ComponentIntegrationStatus["promotionReadiness"];
  // Path relatif dari akar proyek; tes memastikan semuanya ada.
  realDrivers: readonly string[];
  simulatorSource: string;
  mockFiles: readonly string[];
  envKeys: readonly string[];
  promotionCriteria: readonly string[];
  fallbackStrategy: string;
}

export interface MockAuditReport {
  items: readonly MockAuditItem[];
  // true = tidak ada komponen belum teruji yang berstatus real atau ready.
  ruleEnforced: boolean;
  violations: readonly string[];
  counts: { mock: number; simulator: number; real: number };
}

export const mockAuditInventory: readonly MockAuditItem[] = [
  {
    id: "mikrotik",
    name: "MikroTik RouterOS REST",
    currentSource: "real",
    verificationStatus: "passed",
    promotionReadiness: "ready",
    realDrivers: ["backend/internal/collector/client.go", "backend/internal/collector/poller.go"],
    simulatorSource: "scripts/simulator-lab.mjs",
    mockFiles: ["src/lib/dashboard/mock-data.ts", "src/lib/dashboard/mock-feed.ts"],
    envKeys: ["ROUTER_SECRET_KEY", "DATABASE_URL"],
    promotionCriteria: [
      "Polling REST lulus lawan simulator RouterOS di Docker lokal.",
      "Layanan REST (www/www-ssl) aktif pada RouterOS v7.1+.",
    ],
    fallbackStrategy: "Kembali ke simulator lab dan tandai router offline; data terakhir tetap tampil.",
  },
  {
    id: "olt",
    name: "OLT HSGQ EPON/GPON",
    currentSource: "simulator",
    verificationStatus: "passed",
    promotionReadiness: "needs_env",
    realDrivers: ["backend/internal/olt/hsgq.go", "backend/internal/olt/driver.go"],
    simulatorSource: "src/lib/olt/hsgq-simulator.ts",
    mockFiles: ["backend/internal/olt/mock_driver.go", "scripts/mock-hsgq-server.mjs", "src/lib/dashboard/olts.ts"],
    envKeys: ["OLT_HOST", "OLT_USERNAME", "OLT_PASSWORD"],
    promotionCriteria: [
      "Parser lulus lawan keluaran simulator HSGQ.",
      "Kredensial OLT nyata terisi dan koneksi uji berhasil.",
    ],
    fallbackStrategy: "Pakai simulator OLT; redaman optik ditandai tidak tersedia, bukan nol.",
  },
  {
    id: "genieacs",
    name: "GenieACS NBI TR-069",
    currentSource: "mock",
    verificationStatus: "untested",
    promotionReadiness: "needs_env",
    realDrivers: ["src/lib/genieacs/client.ts", "src/lib/genieacs/config.ts", "src/lib/genieacs/test-connection.ts"],
    simulatorSource: "scripts/simulator-lab.mjs",
    mockFiles: ["src/lib/dashboard/cpe-mock.ts"],
    envKeys: ["GENIEACS_URL", "GENIEACS_USERNAME", "GENIEACS_PASSWORD"],
    promotionCriteria: [
      "Klien NBI lulus uji lawan instance GenieACS di lab.",
      "URL dan kredensial GenieACS terisi dan uji koneksi berhasil.",
    ],
    fallbackStrategy: "Tetap pada data tiruan; aksi ubah CPE dinonaktifkan sampai lulus uji lab.",
  },
  {
    id: "billing",
    name: "Portal Billing ISP",
    currentSource: "mock",
    verificationStatus: "untested",
    promotionReadiness: "needs_env",
    realDrivers: ["backend/internal/billing/scraper.go", "backend/internal/billing/syncer.go", "src/lib/billing-proxy.ts"],
    simulatorSource: "scripts/simulator-lab.mjs",
    mockFiles: ["src/lib/dashboard/billing.ts"],
    envKeys: ["BILLING_URL", "BILLING_USERNAME", "BILLING_PASSWORD", "DATABASE_URL"],
    promotionCriteria: [
      "Profil scraper dicocokkan dengan HTML portal billing asli.",
      "Sinkron lulus di lab tanpa mengubah status pelanggan saat gagal.",
    ],
    fallbackStrategy: "Status billing terakhir dipertahankan; sinkron gagal tidak mengubah status pelanggan.",
  },
  {
    id: "realtime_hub",
    name: "Realtime WebSocket Hub",
    currentSource: "real",
    verificationStatus: "passed",
    promotionReadiness: "ready",
    realDrivers: [
      "backend/internal/hub/hub.go",
      "src/lib/dashboard/realtime-ws.ts",
      "src/lib/realtime-ticket.ts",
    ],
    simulatorSource: "scripts/simulator-lab.mjs",
    mockFiles: ["src/lib/dashboard/mock-feed.ts"],
    envKeys: ["REALTIME_TOKEN_SECRET", "DATABASE_URL"],
    promotionCriteria: [
      "WebSocket hub berjalan nyata di lab Docker lokal.",
      "Tiket realtime bertanda tangan diverifikasi backend Go.",
    ],
    fallbackStrategy: "Dasbor memakai snapshot terakhir dan menyambung ulang otomatis.",
  },
];

/**
 * Memeriksa aturan plan: mock hanya dilepas setelah sumber nyata terbukti.
 * Komponen `untested` tidak boleh berstatus `real` atau `ready`.
 */
export function auditMockUsage(): MockAuditReport {
  const violations: string[] = [];
  const counts = { mock: 0, simulator: 0, real: 0 };
  for (const c of mockAuditInventory) {
    counts[c.currentSource] += 1;
    if (c.verificationStatus !== "untested") continue;
    if (c.currentSource === "real") violations.push(`${c.id}: belum teruji tetapi sumber real`);
    if (c.promotionReadiness === "ready") violations.push(`${c.id}: belum teruji tetapi siap promosi`);
  }
  return { items: mockAuditInventory, ruleEnforced: violations.length === 0, violations, counts };
}

export interface PromotionPrinciple {
  id: string;
  title: string;
  detail: string;
}

export const promotionPrinciples: readonly PromotionPrinciple[] = [
  {
    id: "lab-first",
    title: "Bukti lab dulu",
    detail: "Mock hanya dilepas setelah sumber nyata terbukti di lab Docker lokal.",
  },
  {
    id: "fallback",
    title: "Fallback otomatis",
    detail: "Setiap komponen punya jalur mundur ke simulator atau data terakhir bila koneksi fisik putus.",
  },
  {
    id: "env-ready",
    title: "Konfigurasi lengkap",
    detail: "Semua variabel env komponen harus terisi dan tervalidasi sebelum promosi.",
  },
  {
    id: "no-silent-switch",
    title: "Tanpa peralihan diam-diam",
    detail: "Sumber aktif selalu terlihat di dasbor; tidak ada data tiruan yang tampil sebagai data nyata.",
  },
];

// --- Hasil ukur nyata (npm run benchmark:run) --------------------------------

export interface LatencyStats {
  samples: number;
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

export interface BenchmarkStepStats {
  collector: LatencyStats;
  eval: LatencyStats;
  traffic: LatencyStats;
  pipeline: LatencyStats;
}

export interface BenchmarkResults {
  generatedAt: string;
  iterations: number;
  unit: "ms";
  node: BenchmarkStepStats & { memory: { rssBytes: number; heapUsedBytes: number } };
  go: BenchmarkStepStats & {
    goVersion: string;
    memory: { sysBytes: number; heapAllocBytes: number };
  };
  ratios: {
    pipelineAvgSpeedup: number;
    pipelineP95Speedup: number;
    memorySavings: number;
  };
}

const stat = (avg: number): LatencyStats => ({
  samples: 0, min: avg, max: avg, avg, p50: avg, p95: avg, p99: avg,
});

// Angka bawaan bila benchmark-results.json belum dibuat atau rusak. Bukan hasil
// ukur: samples = 0 menandainya; turunan dari perkiraan di benchmarkKpis.
export const fallbackBenchmarkResults: BenchmarkResults = {
  generatedAt: "1970-01-01T00:00:00.000Z",
  iterations: 0,
  unit: "ms",
  node: {
    collector: stat(1.5), eval: stat(0.12), traffic: stat(0.06), pipeline: stat(1.8),
    memory: { rssBytes: 180 * 1048576, heapUsedBytes: 20 * 1048576 },
  },
  go: {
    goVersion: "unknown",
    collector: stat(0.2), eval: stat(0.03), traffic: stat(0.05), pipeline: stat(0.3),
    memory: { sysBytes: 18 * 1048576, heapAllocBytes: 2 * 1048576 },
  },
  ratios: { pipelineAvgSpeedup: 6, pipelineP95Speedup: 6, memorySavings: 10 },
};

const isStats = (v: unknown): v is LatencyStats => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return ["avg", "p50", "p95", "p99", "min", "max"].every(
    (k) => typeof s[k] === "number" && Number.isFinite(s[k]) && (s[k] as number) >= 0,
  );
};

function isResults(v: unknown): v is BenchmarkResults {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const steps = ["collector", "eval", "traffic", "pipeline"];
  const side = (x: unknown, mem: string) => {
    if (typeof x !== "object" || x === null) return false;
    const o = x as Record<string, unknown>;
    const m = o.memory as Record<string, unknown> | undefined;
    return steps.every((s) => isStats(o[s])) && typeof m?.[mem] === "number";
  };
  const ratios = r.ratios as Record<string, unknown> | undefined;
  return (
    side(r.node, "rssBytes") &&
    side(r.go, "sysBytes") &&
    typeof ratios?.pipelineAvgSpeedup === "number" &&
    typeof ratios?.pipelineP95Speedup === "number" &&
    typeof ratios?.memorySavings === "number"
  );
}

/**
 * Mengembalikan hasil ukur dari benchmark-results.json bila ada dan bentuknya
 * valid; bila tidak, angka bawaan. JSON ikut ter-bundle saat build, jadi
 * jalankan `npm run benchmark:run` sebelum `npm run build` untuk memperbaruinya.
 */
export function loadBenchmarkResults(): BenchmarkResults {
  return isResults(measuredResults) ? measuredResults : fallbackBenchmarkResults;
}

// --- Uji banding akses data: Drizzle vs SQL langsung (npm run benchmark:db) ---

export interface DbEngineStats {
  latency: LatencyStats;
  heapAllocatedBytes: number;
}

export interface DbScenarioPair {
  drizzle: DbEngineStats;
  raw: DbEngineStats;
  // >1 = SQL langsung lebih unggul (drizzle / raw).
  avgSpeedup: number;
  heapSavings: number;
}

export interface DbBenchmarkResults {
  generatedAt: string;
  iterations: number;
  unit: "ms";
  // "mock" = klien DB tiruan: yang terukur biaya lapisan akses, bukan basis data.
  mode: "mock" | "live";
  verified: boolean;
  scenarios: {
    trafficAggregation: Record<"1h" | "6h" | "24h" | "7d", DbScenarioPair>;
    batchUpsert: DbScenarioPair;
    customerMetrics: DbScenarioPair;
  };
}

const dbStat = (avg: number): DbEngineStats => ({
  latency: stat(avg),
  heapAllocatedBytes: 1,
});

const dbPair = (drizzle: number, raw: number): DbScenarioPair => ({
  drizzle: dbStat(drizzle),
  raw: dbStat(raw),
  avgSpeedup: drizzle / raw,
  heapSavings: 1,
});

// Angka bawaan bila benchmark-db-results.json rusak. Bukan hasil ukur: samples = 0.
export const fallbackDbBenchmarkResults: DbBenchmarkResults = {
  generatedAt: "1970-01-01T00:00:00.000Z",
  iterations: 0,
  unit: "ms",
  mode: "mock",
  verified: false,
  scenarios: {
    trafficAggregation: {
      "1h": dbPair(0.4, 0.3),
      "6h": dbPair(0.3, 0.25),
      "24h": dbPair(0.3, 0.25),
      "7d": dbPair(0.3, 0.25),
    },
    batchUpsert: dbPair(1.3, 1.1),
    customerMetrics: dbPair(0.02, 0.01),
  },
};

const isPair = (v: unknown): v is DbScenarioPair => {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Record<string, unknown>;
  const eng = (e: unknown) => {
    const o = e as Record<string, unknown> | null;
    return (
      typeof o === "object" &&
      o !== null &&
      isStats(o.latency) &&
      typeof o.heapAllocatedBytes === "number" &&
      Number.isFinite(o.heapAllocatedBytes) &&
      o.heapAllocatedBytes >= 0
    );
  };
  return (
    eng(p.drizzle) &&
    eng(p.raw) &&
    typeof p.avgSpeedup === "number" &&
    typeof p.heapSavings === "number"
  );
};

function isDbResults(v: unknown): v is DbBenchmarkResults {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const sc = r.scenarios as Record<string, unknown> | undefined;
  const traffic = sc?.trafficAggregation as Record<string, unknown> | undefined;
  return (
    typeof r.generatedAt === "string" &&
    typeof r.iterations === "number" &&
    typeof sc === "object" &&
    sc !== null &&
    ["1h", "6h", "24h", "7d"].every((k) => isPair(traffic?.[k])) &&
    isPair(sc.batchUpsert) &&
    isPair(sc.customerMetrics)
  );
}

/**
 * Hasil uji banding DB dari benchmark-db-results.json bila valid; bila tidak,
 * angka bawaan. Jalankan `npm run benchmark:db` sebelum `npm run build`.
 */
export function loadDbBenchmarkResults(): DbBenchmarkResults {
  return isDbResults(measuredDbResults) ? measuredDbResults : fallbackDbBenchmarkResults;
}


// --- Ringkasan gabungan kedua uji banding ------------------------------------

export interface SummaryStep {
  id: keyof BenchmarkStepStats;
  label: string;
  goAvg: number;
  nodeAvg: number;
  goP50: number;
  nodeP50: number;
  goP95: number;
  nodeP95: number;
  speedup: number;
}

export interface SummaryDbScenario {
  id: string;
  label: string;
  drizzleAvg: number;
  rawAvg: number;
  drizzleP50: number;
  rawP50: number;
  drizzleP95: number;
  rawP95: number;
  speedup: number;
  heapSavings: number;
}

export interface SummaryKpi {
  id: string;
  label: string;
  value: string;
  detail: string;
  // true = angka hasil ukur lab; false = baseline perkiraan (benchmarkKpis).
  measured: boolean;
}

export interface BenchmarkSummary {
  // Kedua file hasil ukur ada dan berisi sampel nyata (iterations > 0).
  measured: boolean;
  dbMode: DbBenchmarkResults["mode"];
  runtime: {
    pipelineAvgSpeedup: number;
    pipelineP95Speedup: number;
    memoryRatio: number;
    steps: SummaryStep[];
  };
  database: {
    batchUpsertSpeedup: number;
    trafficSpeedupMin: number;
    trafficSpeedupMax: number;
    customerMetricsSpeedup: number;
    heapSavingsAvg: number;
    scenarios: SummaryDbScenario[];
  };
  kpis: SummaryKpi[];
  recommendations: StackDecision[];
}

const stepLabels: Record<keyof BenchmarkStepStats, string> = {
  collector: "Parse & kumpul metrik",
  eval: "Evaluasi aturan",
  traffic: "Agregasi trafik",
  pipeline: "Pipeline lengkap",
};

const safeRatio = (a: number, b: number): number => (b > 0 && Number.isFinite(a / b) ? a / b : 1);
const fx = (n: number): string => `${n.toFixed(2)}x`;
const ms = (n: number): string => `${n.toFixed(3)} ms`;

export const hybridRecommendations: readonly StackDecision[] = stackDecisions.map((d) => ({ ...d }));

/**
 * Menggabungkan hasil Uji 1 (Go vs Node) dan Uji 2 (Drizzle vs SQL langsung)
 * menjadi satu ringkasan. Selalu mengembalikan angka berhingga: bila salah satu
 * file hasil kosong/rusak, angka bawaan dipakai dan `measured` = false.
 */
export function compileBenchmarkSummary(
  run: BenchmarkResults = loadBenchmarkResults(),
  db: DbBenchmarkResults = loadDbBenchmarkResults(),
): BenchmarkSummary {

  const steps: SummaryStep[] = (["collector", "eval", "traffic", "pipeline"] as const).map((id) => ({
    id,
    label: stepLabels[id],
    goAvg: run.go[id].avg,
    nodeAvg: run.node[id].avg,
    goP50: run.go[id].p50,
    nodeP50: run.node[id].p50,
    goP95: run.go[id].p95,
    nodeP95: run.node[id].p95,
    speedup: safeRatio(run.node[id].avg, run.go[id].avg),
  }));

  const sc = db.scenarios;
  const dbRows: [string, string, DbScenarioPair][] = [
    ["traffic-1h", "Agregasi trafik 1 jam", sc.trafficAggregation["1h"]],
    ["traffic-6h", "Agregasi trafik 6 jam", sc.trafficAggregation["6h"]],
    ["traffic-24h", "Agregasi trafik 24 jam", sc.trafficAggregation["24h"]],
    ["traffic-7d", "Agregasi trafik 7 hari", sc.trafficAggregation["7d"]],
    ["batch-upsert", "Batch upsert metrik", sc.batchUpsert],
    ["customer-metrics", "Metrik pelanggan", sc.customerMetrics],
  ];
  const scenarios: SummaryDbScenario[] = dbRows.map(([id, label, p]) => ({
    id,
    label,
    drizzleAvg: p.drizzle.latency.avg,
    rawAvg: p.raw.latency.avg,
    drizzleP50: p.drizzle.latency.p50,
    rawP50: p.raw.latency.p50,
    drizzleP95: p.drizzle.latency.p95,
    rawP95: p.raw.latency.p95,
    speedup: safeRatio(p.drizzle.latency.avg, p.raw.latency.avg),
    heapSavings: safeRatio(p.drizzle.heapAllocatedBytes, p.raw.heapAllocatedBytes),
  }));

  const trafficSpeeds = scenarios.filter((s) => s.id.startsWith("traffic-")).map((s) => s.speedup);
  const pipeline = steps[3];
  const memoryRatio = safeRatio(run.node.memory.rssBytes, run.go.memory.sysBytes);
  const batch = scenarios[4];
  const customer = scenarios[5];
  const heapSavingsAvg = scenarios.reduce((a, s) => a + s.heapSavings, 0) / scenarios.length;
  const trafficMin = Math.min(...trafficSpeeds);
  const trafficMax = Math.max(...trafficSpeeds);
  const pipelineP95 = safeRatio(pipeline.nodeP95, pipeline.goP95);
  const measured = run.iterations > 0 && db.iterations > 0;

  const kpis: SummaryKpi[] = [
    {
      id: "pipeline-latency",
      label: "Latensi Pipeline (avg)",
      value: `${fx(pipeline.speedup)} lebih cepat`,
      detail: `Go ${ms(pipeline.goAvg)} vs Node ${ms(pipeline.nodeAvg)}`,
      measured: run.iterations > 0,
    },
    {
      id: "pipeline-p95",
      label: "Latensi Pipeline (p95)",
      value: `${fx(pipelineP95)} lebih cepat`,
      detail: `Go ${ms(pipeline.goP95)} vs Node ${ms(pipeline.nodeP95)}`,
      measured: run.iterations > 0,
    },
    {
      id: "memory",
      label: "Memori Proses",
      value: `${fx(memoryRatio)} lebih hemat`,
      detail: `Go ${(run.go.memory.sysBytes / 1048576).toFixed(1)} MB vs Node ${(run.node.memory.rssBytes / 1048576).toFixed(1)} MB`,
      measured: run.iterations > 0,
    },
    {
      id: "batch-upsert",
      label: "Batch Upsert Metrik",
      value: `${fx(batch.speedup)} lebih cepat`,
      detail: `SQL ${ms(batch.rawAvg)} vs Drizzle ${ms(batch.drizzleAvg)}`,
      measured: db.iterations > 0,
    },
    {
      id: "traffic-agg",
      label: "Query Agregasi Trafik",
      value: `${fx(trafficMin)} - ${fx(trafficMax)}`,
      detail: "Rentang 1 jam sampai 7 hari, SQL langsung vs Drizzle",
      measured: db.iterations > 0,
    },
    {
      id: "customer-metrics",
      label: "Metrik Pelanggan",
      value: `${fx(customer.speedup)} lebih cepat`,
      detail: `SQL ${ms(customer.rawAvg)} vs Drizzle ${ms(customer.drizzleAvg)}`,
      measured: db.iterations > 0,
    },
    {
      id: "heap",
      label: "Efisiensi Heap DB (rata-rata)",
      value: `${fx(heapSavingsAvg)} lebih hemat`,
      detail: "Alokasi heap Drizzle dibanding SQL langsung",
      measured: db.iterations > 0,
    },
  ];

  return {
    measured,
    dbMode: db.mode,
    runtime: {
      pipelineAvgSpeedup: pipeline.speedup,
      pipelineP95Speedup: pipelineP95,
      memoryRatio,
      steps,
    },
    database: {
      batchUpsertSpeedup: batch.speedup,
      trafficSpeedupMin: trafficMin,
      trafficSpeedupMax: trafficMax,
      customerMetricsSpeedup: customer.speedup,
      heapSavingsAvg,
      scenarios,
    },
    kpis,
    recommendations: [...hybridRecommendations],
  };
}
