// Pure: logika dialog uji koneksi Router/OLT/GenieACS. Tanpa import apa pun.

export type TestableDeviceType = "mikrotik" | "olt" | "genieacs";

export interface DeviceTestRequest {
  type: TestableDeviceType;
  name: string;
  host: string;
  port: number;
  username: string;
  password?: string;
  mode?: "simulator" | "real";
}

export interface DeviceTestResultSummary {
  ok: boolean;
  status: "connected" | "error" | "refused" | "unauthorized" | "timeout";
  message: string;
  latencyMs: number | null;
  deviceType: TestableDeviceType;
  details: Record<string, string | number | boolean | null>;
  testedAt: string;
}

export const DEVICE_TYPE_LABEL: Record<TestableDeviceType, string> = {
  mikrotik: "Router MikroTik",
  olt: "OLT HSGQ",
  genieacs: "GenieACS NBI",
};

export function formatDeviceEndpoint(
  type: TestableDeviceType,
  host: string,
  port: number,
): string {
  const h = host.trim();
  return type === "mikrotik"
    ? `https://${h}:${port}/rest`
    : `http://${h}:${port}`;
}

// Ponytail: input sengaja `any`; bentuk hasil simulator dan real berbeda sedikit.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function evaluateConnectionTestOutcome(
  rawResult: any,
  type: TestableDeviceType,
): DeviceTestResultSummary {
  const r = rawResult ?? {};
  const code = String(r.code ?? "");
  const raw = String(r.status ?? "");
  const http = Number(r.statusCode);
  let status: DeviceTestResultSummary["status"];
  if (r.ok === true) status = "connected";
  else if (
    raw === "unauthorized" ||
    code === "AUTH_FAILED" ||
    http === 401 ||
    http === 403
  )
    status = "unauthorized";
  else if (raw === "refused" || code === "CONNECTION_REFUSED")
    status = "refused";
  else if (raw === "timeout" || code === "TIMEOUT") status = "timeout";
  else status = "error";

  const details: DeviceTestResultSummary["details"] = {};
  const src = r.data ?? r.details;
  if (src && typeof src === "object") {
    for (const [k, v] of Object.entries(src)) {
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) {
        details[k] = v as string | number | boolean | null;
      }
    }
  }

  const ts =
    typeof r.timestamp === "number"
      ? r.timestamp * 1000
      : Date.parse(String(r.testedAt ?? ""));
  const latency = Number(r.latencyMs);
  return {
    ok: status === "connected",
    status,
    message: String(
      r.message ?? (status === "connected" ? "Terhubung." : "Pengujian gagal."),
    ),
    latencyMs:
      r.latencyMs == null || !Number.isFinite(latency) ? null : latency,
    deviceType: type,
    details,
    testedAt: new Date(Number.isFinite(ts) ? ts : Date.now()).toISOString(),
  };
}

export function getRecommendedActionForFailure(status: string): string {
  switch (status) {
    case "unauthorized":
      return "Username atau password ditolak. Periksa kredensial dan pastikan akun punya hak akses API (read) di perangkat.";
    case "timeout":
      return "Perangkat tidak merespons. Periksa rute jaringan, firewall, dan pastikan IP/port benar serta perangkat menyala.";
    case "refused":
      return "Koneksi ditolak pada port ini. Pastikan layanan API/web aktif (mis. www-ssl di MikroTik) dan port sesuai.";
    case "connected":
      return "";
    default:
      return "Pengujian gagal. Periksa host, port, mode, dan log server, lalu coba lagi.";
  }
}
