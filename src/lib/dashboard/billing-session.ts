// Status sesi scraper billing (cookiejar, token CSRF, akun portal). Murni:
// tanpa React dan tanpa server. Bentuknya adalah kontrak untuk endpoint status
// sesi di backend nanti; sekarang diisi tiruan oleh `mockBillingSession`.
export interface BillingScraperSession {
  portalUrl: string;
  username: string;
  isConfigured: boolean;
  sessionStatus: "active" | "expired" | "not_logged_in";
  csrfStatus: "acquired" | "missing" | "not_required";
  lastLoginAt: number | null;
  consecutiveFailures: number;
  isBackoffActive: boolean;
  cookiejarCount: number;
}

export type BillingSessionTone = "success" | "warning" | "danger" | "muted";

// Gagal login beruntun yang memperlambat jadwal (sama dengan backend).
export const BILLING_BACKOFF_FAILURES = 3;

export function describeBillingSession(session: BillingScraperSession): {
  tone: BillingSessionTone;
  text: string;
  hint: string;
} {
  if (!session.isConfigured) {
    return {
      tone: "muted",
      text: "Kredensial belum dikonfigurasi",
      hint: "Atur URL portal dan akun login scraper.",
    };
  }
  if (
    session.isBackoffActive ||
    session.consecutiveFailures >= BILLING_BACKOFF_FAILURES
  ) {
    return {
      tone: "danger",
      text: "Proteksi perlambatan 6 jam aktif",
      hint: "3x gagal login beruntun. Jadwal diperlambat untuk mencegah blokir akun.",
    };
  }
  if (session.sessionStatus === "active") {
    return {
      tone: "success",
      text: "Sesi login aktif",
      hint: "Cookiejar dan token CSRF valid untuk sinkronisasi.",
    };
  }
  if (session.sessionStatus === "expired") {
    return {
      tone: "warning",
      text: "Sesi kedaluwarsa",
      hint: "Akan otomatis memperbarui login pada jadwal berikutnya.",
    };
  }
  return {
    tone: "warning",
    text: "Belum login",
    hint: "Sesi akan dibuat pada sinkronisasi berikutnya.",
  };
}

// ponytail: tiruan, fungsi dari `syncState` saja. Ganti dengan GET status sesi
// dari backend saat endpoint-nya ada.
export function mockBillingSession(syncState?: {
  runs?: { status: string; finishedAt: number }[];
}): BillingScraperSession {
  const runs = syncState?.runs ?? [];
  let failures = 0;
  for (const run of runs) {
    if (run.status !== "failed") break;
    failures += 1;
  }
  const lastSuccess = runs.find((run) => run.status === "success");
  const backoff = failures >= BILLING_BACKOFF_FAILURES;
  return {
    portalUrl: "https://billing.example.net/login",
    username: "noc-scraper",
    isConfigured: true,
    sessionStatus: backoff
      ? "expired"
      : lastSuccess
        ? "active"
        : "not_logged_in",
    csrfStatus: backoff ? "missing" : lastSuccess ? "acquired" : "missing",
    lastLoginAt: lastSuccess?.finishedAt ?? null,
    consecutiveFailures: failures,
    isBackoffActive: backoff,
    cookiejarCount: !backoff && lastSuccess ? 2 : 0,
  };
}
