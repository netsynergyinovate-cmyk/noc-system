import "server-only";
import { ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";

// Semua analisis diagnosa sekarang berjalan di backend Go. File ini hanya
// meneruskan permintaan UI ke API Go dengan tiket internal bertanda tangan;
// tidak ada pembacaan router atau evaluasi lapisan di Next.js.
export async function goDiagnostics<T>(
  userId: string,
  path: string,
  init: RequestInit = {},
  perms: readonly string[] = [],
): Promise<T> {
  const secret = env.REALTIME_TOKEN_SECRET;
  if (!secret) {
    throw new ApiError(
      503,
      "DIAGNOSTIC_BACKEND_UNCONFIGURED",
      "REALTIME_TOKEN_SECRET belum diatur; API Go tidak dapat dipanggil.",
    );
  }
  const { token } = issueRealtimeTicket({ userId, secret, perms });
  let res: Response;
  try {
    res = await fetch(`${env.BACKEND_INTERNAL_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch {
    throw new ApiError(
      502,
      "DIAGNOSTIC_BACKEND_DOWN",
      "Backend Go tidak dapat dihubungi.",
    );
  }
  const json = (await res.json().catch(() => null)) as {
    data?: T;
    error?: string;
    message?: string;
  } | null;
  if (!res.ok) {
    throw new ApiError(
      res.status,
      json?.error ?? "DIAGNOSTIC_FAILED",
      json?.message ?? `Backend Go menjawab HTTP ${res.status}.`,
    );
  }
  return json?.data as T;
}

export interface GoRun {
  id: string;
  customerId: string | null;
  customerName: string;
  pppoeUsername: string;
  triggerMode: "manual" | "auto";
  triggeredBy: string | null;
  triggerReason: string;
  triggerSourceRef: string | null;
  mergedCount: number;
  status: "queued" | "running" | "done" | "failed";
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  verdictLayer: string | null;
  verdictDetail: string | null;
  verdictScope: "own" | "shared" | "unknown" | null;
  verdictRoot: unknown;
  verdictSecondary: unknown[];
  verdictHeld: boolean;
  isSharedFault: boolean;
  complaintAt: string | null;
  timeline: unknown[];
}

export interface GoFinding {
  layer: string;
  metric: string;
  label: string;
  value: string | null;
  threshold: string | null;
  comparator: string | null;
  status: "ok" | "warn" | "fail" | "unchecked";
  detail: string;
  sourceRef: string | null;
  sampledAt: string | null;
}

export function shapeRun(
  run: GoRun,
  findings?: GoFinding[],
  firewallRules: unknown[] = [],
) {
  return {
    ...run,
    // UI lama memakai id temuan sebagai key; Go memakai kombinasi yang stabil.
    findings: findings?.map((f, index) => ({
      ...f,
      id: `${run.id}:${f.layer}:${f.metric}:${index}`,
      sampledAt: f.sampledAt ?? null,
    })),
    firewallRules,
  };
}
