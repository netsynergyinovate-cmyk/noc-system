// Validasi kelengkapan konfigurasi saat start (murni, tanpa server-only agar bisa diuji).
// Tidak pernah memasukkan nilai password/secret ke report.

export interface StartupValidationReport {
  valid: boolean;
  canBoot: boolean;
  fatalErrors: string[];
  warnings: string[];
  dataMode: "demo" | "live";
  deviceMode: "simulator" | "real";
  details: {
    database: { ok: boolean; message: string };
    auth: { ok: boolean; message: string };
    devices: { ok: boolean; missing: string[]; configured: string[] };
    goLiveCheck: { passed: boolean; violations: string[] };
    pageDataSources?: { passed: boolean; dummyPages: string[] };
  };
}

export class StartupValidationError extends Error {
  readonly report: StartupValidationReport;
  constructor(report: StartupValidationReport) {
    super(
      `Konfigurasi belum lengkap: ${report.fatalErrors.join("; ") || "tidak diketahui"}`,
    );
    this.name = "StartupValidationError";
    this.report = report;
  }
}

type Source = Record<string, string | undefined>;

const MIKROTIK_VARS = [
  "MIKROTIK_REST_HOST",
  "MIKROTIK_REST_USER",
  "MIKROTIK_REST_PASSWORD",
] as const;

const filled = (v: string | undefined) => !!v?.trim();

// ponytail: duplikat kecil dari mode-switch.ts (import ekstensi-less gagal di node --test); gabung bila loader mendukung.
function parseMode(raw: string | undefined): "simulator" | "real" | undefined {
  const v = raw?.trim().toLowerCase();
  if (v === "real" || v === "live" || v === "nyata") return "real";
  if (v === "simulator" || v === "demo" || v === "dummy") return "simulator";
  return undefined;
}

function isLive(source: Source): boolean {
  const v = (x: string | undefined) => x?.trim().toLowerCase();
  return (
    ["live", "nyata"].includes(v(source.DASHBOARD_DATA) ?? "") ||
    ["live", "nyata"].includes(v(source.DATA_MODE) ?? "")
  );
}

export function runStartupValidation(
  source: Source = process.env,
): StartupValidationReport {
  const fatalErrors: string[] = [];
  const warnings: string[] = [];
  const live = isLive(source);
  const dataMode = live ? "live" : "demo";

  // Database
  const dbUrl = source.DATABASE_URL?.trim();
  let database: { ok: boolean; message: string };
  if (!dbUrl) {
    database = { ok: false, message: "DATABASE_URL belum diisi." };
  } else {
    let ok = false;
    try {
      ok = ["postgres:", "postgresql:"].includes(new URL(dbUrl).protocol);
    } catch {}
    database = ok
      ? { ok, message: "DATABASE_URL terisi (PostgreSQL)." }
      : { ok, message: "DATABASE_URL bukan URL PostgreSQL yang valid." };
  }
  if (!database.ok) fatalErrors.push(database.message);

  // Auth
  const authProblems: string[] = [];
  if ((source.BETTER_AUTH_SECRET?.length ?? 0) < 32)
    authProblems.push("BETTER_AUTH_SECRET wajib minimal 32 karakter.");
  const rawAuthUrl = source.BETTER_AUTH_URL?.trim();
  const authUrl = rawAuthUrl || (live ? "" : "http://localhost:3000");
  if (!authUrl) authProblems.push("BETTER_AUTH_URL belum diisi.");
  else {
    try {
      new URL(authUrl);
    } catch {
      authProblems.push("BETTER_AUTH_URL bukan URL yang valid.");
    }
  }
  const auth = authProblems.length
    ? { ok: false, message: authProblems.join(" ") }
    : { ok: true, message: "Auth secret dan URL valid." };
  fatalErrors.push(...authProblems);

  // Perangkat MikroTik
  const configured = MIKROTIK_VARS.filter((k) => filled(source[k])) as string[];
  const missing = MIKROTIK_VARS.filter((k) => !filled(source[k])) as string[];
  const deviceMode =
    parseMode(source.MIKROTIK_MODE) ??
    parseMode(source.DEVICE_MODE) ??
    parseMode(source.DASHBOARD_DATA) ??
    parseMode(source.DATA_MODE) ??
    "simulator";

  const violations: string[] = [];
  const dummyPages: string[] = [];

  const isSim = (val: string | undefined) =>
    val?.trim().toLowerCase() === "simulator";

  // Periksa perangkat & halaman yang terdeteksi masih bertumpu pada sumber data tiruan
  const pageChecks: Array<{
    pagePath: string;
    pageTitle: string;
    isDummy: boolean;
    reason: string;
  }> = [
    {
      pagePath: "/app/router",
      pageTitle: "Router MikroTik",
      isDummy:
        !filled(source.MIKROTIK_REST_HOST) ||
        isSim(source.MIKROTIK_MODE) ||
        isSim(source.DEVICE_MODE),
      reason: "Variabel MIKROTIK_REST_HOST belum lengkap atau mode simulator aktif",
    },
    {
      pagePath: "/app/cpe",
      pageTitle: "OLT HSGQ & Port Optik",
      isDummy: isSim(source.OLT_MODE) || source.DUMMY_OLT === "true",
      reason: "OLT berjalan dalam mode simulator",
    },
    {
      pagePath: "/app/billing",
      pageTitle: "Status Pembayaran Billing",
      isDummy: isSim(source.BILLING_MODE) || source.DUMMY_BILLING === "true",
      reason: "Billing scraper berjalan dalam mode simulator",
    },
    {
      pagePath: "/app/netflow",
      pageTitle: "Papan NetFlow & Aliran Trafik",
      isDummy: isSim(source.NETFLOW_MODE) || source.DUMMY_NETFLOW === "true",
      reason: "NetFlow collector berjalan dalam mode simulator",
    },
  ];

  if (source.DUMMY_PAGES) {
    const customList = source.DUMMY_PAGES.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const p of customList) {
      if (!pageChecks.some((c) => c.pagePath === p)) {
        pageChecks.push({
          pagePath: p,
          pageTitle: p,
          isDummy: true,
          reason: "Halaman terdaftar dalam variabel DUMMY_PAGES",
        });
      }
    }
  }

  if (live) {
    const allowEmpty = source.ALLOW_EMPTY_DEVICES === "true";
    if (missing.length) {
      if (allowEmpty) {
        warnings.push(
          `Mode live (device fleksibel): variabel MikroTik REST belum lengkap (${missing.join(", ")}). Perangkat dapat ditambahkan via database/UI.`,
        );
      } else {
        violations.push(
          `Mode live: variabel MikroTik REST belum lengkap (${missing.join(", ")}).`,
        );
      }
    }
    if (deviceMode === "simulator" && !allowEmpty)
      violations.push(
        "Pelanggaran Go-Live: MikroTik berjalan dalam mode simulator di mode live.",
      );

    for (const c of pageChecks) {
      if (c.isDummy) {
        dummyPages.push(c.pagePath);
        if (c.pagePath === "/app/router") {
          // Sudah dihitung di atas
          continue;
        }
        if (!allowEmpty) {
          violations.push(
            `Pelanggaran Mode Nyata: Halaman "${c.pageTitle}" (${c.pagePath}) masih menggunakan data tiruan (${c.reason}).`,
          );
        } else {
          warnings.push(
            `Mode Nyata: Halaman "${c.pageTitle}" (${c.pagePath}) menunggu perangkat terhubung (${c.reason}).`,
          );
        }
      }
    }

    fatalErrors.push(...violations);
  } else if (missing.length) {
    warnings.push(
      `Mode demo: variabel MikroTik REST belum lengkap (${missing.join(", ")}).`,
    );
  }

  const canBoot = fatalErrors.length === 0;
  return {
    valid: canBoot && warnings.length === 0,
    canBoot,
    fatalErrors,
    warnings,
    dataMode,
    deviceMode,
    details: {
      database,
      auth,
      devices: { ok: missing.length === 0, missing, configured },
      goLiveCheck: { passed: violations.length === 0, violations },
      pageDataSources: { passed: dummyPages.length === 0, dummyPages },
    },
  };
}

export function formatStartupBanner(report: StartupValidationReport): string {
  const d = report.details;
  const lines = [
    "==================== NOC STARTUP ====================",
    `Status      : ${report.canBoot ? "[READY]" : "[BLOCKED]"}`,
    `Mode Data   : ${report.dataMode}`,
    `Mode Device : ${report.deviceMode}`,
    `Database    : ${d.database.ok ? "OK" : "GAGAL"} - ${d.database.message}`,
    `Auth        : ${d.auth.ok ? "OK" : "GAGAL"} - ${d.auth.message}`,
  ];
  if (report.fatalErrors.length) {
    lines.push("Fatal Errors:");
    for (const e of report.fatalErrors) lines.push(`  - ${e}`);
  }
  if (report.warnings.length) {
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  lines.push("=====================================================");
  return lines.join("\n");
}

export function assertStartupConfig(
  source: Source = process.env,
): StartupValidationReport {
  const report = runStartupValidation(source);
  if (!report.canBoot) throw new StartupValidationError(report);
  return report;
}
