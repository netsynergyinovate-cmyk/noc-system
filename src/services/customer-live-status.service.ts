import "server-only";
import { env } from "@/lib/env";
import { issueRealtimeTicket } from "@/lib/realtime-ticket";
import type { CustomerLiveStatus } from "@/lib/dashboard/customer-live";

// Data status langsung pelanggan (MikroTik + GenieACS + OLT + deteksi LOS) diproses 100% di backend Go.
export async function getCustomerLiveStatus(
  userId: string = "system",
): Promise<Record<string, CustomerLiveStatus>> {
  const backendUrl = env.BACKEND_INTERNAL_URL;
  const secret = env.REALTIME_TOKEN_SECRET;

  if (!backendUrl || !secret) {
    throw new Error(
      "Backend Go belum dikonfigurasi (BACKEND_INTERNAL_URL / REALTIME_TOKEN_SECRET kosong)",
    );
  }

  const { token } = issueRealtimeTicket({
    userId,
    secret,
  });

  const res = await fetch(`${backendUrl}/api/v1/customers/live-status`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });

  if (!res.ok) {
    throw new Error(
      `Backend Go /api/v1/customers/live-status menjawab HTTP ${res.status}`,
    );
  }

  const body = (await res.json().catch(() => null)) as {
    data?: Record<string, CustomerLiveStatus>;
  } | null;

  if (!body?.data) {
    throw new Error("Format respon backend Go tidak valid (data kosong)");
  }

  return body.data;
}
