// Pembentuk request gateway WhatsApp. Murni: tanpa DB, tanpa server-only,
// supaya mudah diuji. Pengiriman nyata ada di services/whatsapp.service.ts.

import { providerDefaultUrl, type WaProvider } from "./whatsapp.ts";

export interface GatewayPayload {
  url: string;
  headers: Record<string, string>;
  body: string;
}

export function formatGatewayPayload(
  provider: WaProvider,
  target: string,
  message: string,
  opts: { apiKey?: string; gatewayUrl?: string } = {},
): GatewayPayload {
  const url = opts.gatewayUrl?.trim() || providerDefaultUrl[provider];
  const auth = { Authorization: opts.apiKey ?? "" };
  if (provider === "fonnte") {
    return {
      url,
      headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ target, message }).toString(),
    };
  }
  return {
    url,
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: target, message }),
  };
}

// Kirim ke gateway; tidak pernah melempar. Status HTTP bukan 2xx = gagal.
export async function dispatchGateway(
  payload: GatewayPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!payload.url) return { ok: false, error: "URL gateway belum diisi." };
  try {
    const res = await fetchImpl(payload.url, {
      method: "POST",
      headers: payload.headers,
      body: payload.body,
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      return { ok: false, error: `Gateway membalas HTTP ${res.status}.` };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Gateway tidak terjangkau.",
    };
  }
}
