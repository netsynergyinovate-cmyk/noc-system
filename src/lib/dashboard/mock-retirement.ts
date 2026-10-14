// Utilitas pensiun kode data tiruan (mock retirement guard).
// Memastikan data tiruan (dummy / mock) tidak pernah disajikan atau lolos saat
// aplikasi dibangun / dijalankan dalam lingkungan produksi (Fase 5 - Syarat Go-Live).

import {
  SETUP_DATA_SOURCE_REGISTRY,
  type DataSourceEntry,
} from "./setup-extended.ts";

export type DataEnvironment = "production" | "staging" | "test" | "development";

export interface MockRetirementPolicy {
  isProduction: boolean;
  isLiveMode: boolean;
  retireEnforced: boolean;
  allowedEnvironments: readonly DataEnvironment[];
}

export class MockDataRetiredError extends Error {
  readonly code = "MOCK_DATA_RETIRED" as const;
  readonly module: string;
  readonly page?: string;
  readonly remediation: string;

  constructor(options: { module: string; page?: string; remediation?: string }) {
    const pageMsg = options.page ? ` pada rute ${options.page}` : "";
    const remMsg =
      options.remediation ??
      "Hubungkan modul ini ke tabel database atau API perangkat nyata.";
    super(
      `[Go-Live Guard] Data tiruan untuk modul "${options.module}"${pageMsg} telah dipensiunkan di lingkungan produksi. ${remMsg}`,
    );
    this.name = "MockDataRetiredError";
    this.module = options.module;
    this.page = options.page;
    this.remediation = remMsg;
  }
}

/**
 * Memeriksa apakah pensiun data tiruan aktif berdasarkan variabel lingkungan.
 */
export function isMockDataRetired(
  source: Record<string, string | undefined> = process.env,
): boolean {
  const nodeEnv = source.NODE_ENV?.toLowerCase();
  const dashData = source.DASHBOARD_DATA?.toLowerCase();
  const dataMode = source.DATA_MODE?.toLowerCase();

  return (
    nodeEnv === "production" ||
    dashData === "live" ||
    dashData === "nyata" ||
    dataMode === "live" ||
    dataMode === "nyata"
  );
}

/**
 * Mengambil ringkasan kebijakan pensiun mock data.
 */
export function getMockRetirementPolicy(
  source: Record<string, string | undefined> = process.env,
): MockRetirementPolicy {
  const nodeEnv = (source.NODE_ENV?.toLowerCase() ?? "development") as DataEnvironment;
  const isProd = nodeEnv === "production";
  const isLive =
    source.DASHBOARD_DATA === "live" ||
    source.DASHBOARD_DATA === "nyata" ||
    source.DATA_MODE === "live" ||
    source.DATA_MODE === "nyata";

  return {
    isProduction: isProd,
    isLiveMode: isLive,
    retireEnforced: isProd || isLive,
    allowedEnvironments: ["test", "development"],
  };
}

/**
 * Melindungi pemanggilan nilai agar tidak menggunakan fallback mock di produksi.
 * Jika realValue tidak tersedia dan pensiun aktif, lemparkan MockDataRetiredError atau kembalikan null.
 */
export function guardRetireMock<T>(
  mockValue: T,
  realValue: T | undefined | null,
  options: {
    module: string;
    page?: string;
    throwOnRetired?: boolean;
    source?: Record<string, string | undefined>;
  },
): T | null {
  const { module, page, throwOnRetired = true, source = process.env } = options;

  if (realValue !== undefined && realValue !== null) {
    return realValue;
  }

  if (isMockDataRetired(source)) {
    if (throwOnRetired) {
      throw new MockDataRetiredError({
        module,
        page,
        remediation: `Segera pasang backend nyata untuk ${module} sebelum go-live.`,
      });
    }
    return null;
  }

  return mockValue;
}

/**
 * Melindungi array agar tidak menyajikan mock array di produksi jika data nyata kosong/null.
 */
export function guardRetireMockArray<T>(
  mockArray: readonly T[],
  realArray: readonly T[] | undefined | null,
  options: {
    module: string;
    page?: string;
    source?: Record<string, string | undefined>;
  },
): readonly T[] {
  const { module, page, source = process.env } = options;

  if (realArray !== undefined && realArray !== null) {
    return realArray;
  }

  if (isMockDataRetired(source)) {
    // Di produksi, jangan sajikan data tiruan jika backend belum menghasilkan baris
    return [];
  }

  return mockArray;
}

export interface MockAuditScanResult {
  totalRegistered: number;
  retiredCount: number;
  dummyCount: number;
  isGoLiveClean: boolean;
  activeDummies: DataSourceEntry[];
}

/**
 * Memindai daftar registry sumber data untuk memastikan tidak ada dummy aktif yang tertinggal.
 */
export function scanMockDataRegistry(
  registry: readonly DataSourceEntry[] = SETUP_DATA_SOURCE_REGISTRY,
  source: Record<string, string | undefined> = process.env,
): MockAuditScanResult {
  const enforced = isMockDataRetired(source);
  const activeDummies = registry.filter((e) => e.status === "dummy");

  return {
    totalRegistered: registry.length,
    retiredCount: enforced ? registry.length : 0,
    dummyCount: activeDummies.length,
    isGoLiveClean: !enforced || activeDummies.length === 0,
    activeDummies,
  };
}

/**
 * Asersi bahwa tidak ada data tiruan yang aktif di lingkungan produksi.
 * Menolak boot atau build jika masih ada data dummy.
 */
export function assertNoActiveMockInProduction(
  registry: readonly DataSourceEntry[] = SETUP_DATA_SOURCE_REGISTRY,
  source: Record<string, string | undefined> = process.env,
): void {
  if (!isMockDataRetired(source)) {
    return;
  }

  const scan = scanMockDataRegistry(registry, source);
  if (!scan.isGoLiveClean && scan.activeDummies.length > 0) {
    const list = scan.activeDummies.map((d) => `${d.module} (${d.envKey})`).join(", ");
    throw new MockDataRetiredError({
      module: "Sistem Go-Live Guard",
      remediation: `Ditemukan ${scan.activeDummies.length} modul yang masih berstatus dummy: ${list}.`,
    });
  }
}
