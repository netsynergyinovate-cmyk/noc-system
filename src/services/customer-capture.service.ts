import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  customerTrafficCaptures,
  domainCatalog,
  type CustomerCaptureFlowItem,
} from "@/db/schema";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import { getCustomerMapDetail } from "./customer-location.service";

export interface StartCaptureInput {
  customerId: string;
  durationSeconds: 15 | 30 | 60;
  operatorName: string;
  userId?: string;
}

export interface CaptureResult {
  id: string;
  customerId: string;
  customerIp: string;
  durationSeconds: number;
  startedAt: string;
  endedAt: string;
  totalBytes: number;
  totalPackets: number;
  flowCount: number;
  topApp: string;
  recordedBy: string;
  flows: CustomerCaptureFlowItem[];
}

/**
 * Mencari kategori domain HANYA dari tabel domain_catalog database.
 * Tanpa tebakan atau daftar buatan: domain yang belum terdaftar berstatus "belum terklasifikasi".
 */
export async function classifyDomain(
  domain: string,
): Promise<{ category: string | null; confidence: number | null }> {
  const clean = domain.toLowerCase().trim();
  try {
    const [row] = await db
      .select({ category: domainCatalog.category, confidence: domainCatalog.confidence })
      .from(domainCatalog)
      .where(eq(domainCatalog.domain, clean))
      .limit(1);
    if (row) {
      return { category: row.category, confidence: row.confidence };
    }
  } catch {
    // Abaikan jika query database gagal
  }

  return { category: "belum terklasifikasi", confidence: null };
}

/**
 * Mengambil seluruh riwayat tangkapan rekaman riil pelanggan dari database PostgreSQL.
 */
export async function getCustomerCapturesHistory(
  customerId: string,
): Promise<CaptureResult[]> {
  const rows = await db
    .select()
    .from(customerTrafficCaptures)
    .where(eq(customerTrafficCaptures.customerId, customerId))
    .orderBy(desc(customerTrafficCaptures.startedAt))
    .limit(50);

  return rows.map((r) => ({
    id: r.id,
    customerId: r.customerId,
    customerIp: r.customerIp,
    durationSeconds: r.durationSeconds,
    startedAt: r.startedAt.toISOString(),
    endedAt: r.endedAt.toISOString(),
    totalBytes: r.totalBytes,
    totalPackets: r.totalPackets,
    flowCount: r.flowCount,
    topApp: r.topApp ?? "Umum",
    recordedBy: r.recordedBy,
    flows: r.flows,
  }));
}

/**
 * Perekaman Torch langsung diteruskan ke Go backend yang memanggil RouterOS /rest/tool/torch.
 */
export async function recordCustomerLiveCapture(
  input: StartCaptureInput,
): Promise<CaptureResult> {
  const cust = await getCustomerMapDetail(input.customerId);
  if (!cust) {
    throw new Error("Pelanggan tidak ditemukan.");
  }

  if (!env.BACKEND_INTERNAL_URL || !env.REALTIME_TOKEN_SECRET) {
    throw new Error("Backend realtime belum dikonfigurasi.");
  }

  const { token } = issueRealtimeTicket({
    userId: input.userId || "system",
    secret: env.REALTIME_TOKEN_SECRET,
    perms: ["capture:run"],
  });

  const res = await fetch(`${env.BACKEND_INTERNAL_URL}/api/v1/netflow/torch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      customerId: input.customerId,
      durationSeconds: input.durationSeconds,
    }),
    signal: AbortSignal.timeout((input.durationSeconds + 15) * 1000),
  });

  const json = (await res.json().catch(() => ({}))) as {
    data?: CaptureResult;
    error?: string | { message?: string };
  };
  if (!res.ok || !json.data) {
    const msg =
      typeof json.error === "object" && json.error?.message
        ? json.error.message
        : typeof json.error === "string"
        ? json.error
        : `Backend menjawab HTTP ${res.status}`;
    throw new Error(msg);
  }

  const d = json.data;
  return {
    id: d.id,
    customerId: d.customerId,
    customerIp: d.customerIp,
    durationSeconds: d.durationSeconds,
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    totalBytes: d.totalBytes,
    totalPackets: d.totalPackets,
    flowCount: d.flowCount,
    topApp: d.topApp ?? "Umum",
    recordedBy: d.recordedBy,
    flows: d.flows,
  };
}
