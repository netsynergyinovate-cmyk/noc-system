// Pure: diagnosis perangkat tak terjangkau + kebijakan uji ulang (backoff).
// Tanpa import, supaya bisa diuji langsung oleh node:test.

export type UnreachableDeviceType = "router" | "olt" | "genieacs" | "billing";
export type UnreachableFailureCode =
  | "TIMEOUT"
  | "CONNECTION_REFUSED"
  | "AUTH_FAILED"
  | "HOST_UNREACHABLE"
  | "UNKNOWN";

export interface UnreachableDeviceReport {
  deviceId: string;
  deviceName: string;
  deviceType: UnreachableDeviceType;
  endpoint: string;
  lastSeenEpoch: number | null;
  downtimeSeconds: number;
  failureReason: string;
  failureCode: UnreachableFailureCode;
  consecutiveFailures: number;
  troubleshootingSteps: string[];
  suggestedCliCommand?: string;
}

export interface DeviceRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  nextRetryEpoch: number;
  canRetryNow: boolean;
}

export const MAX_AUTO_RETRIES = 5;
// Urutan jeda: 2 dtk, 5 dtk, 10 dtk, 20 dtk, lalu mentok 30 dtk.
const BACKOFF_MS = [2000, 5000, 10000, 20000, 30000] as const;

export function mapFailureCode(raw?: string): UnreachableFailureCode {
  const c = (raw ?? "").trim().toUpperCase();
  if (c === "TIMEOUT" || c === "ETIMEDOUT") return "TIMEOUT";
  if (c === "CONNECTION_REFUSED" || c === "ECONNREFUSED") return "CONNECTION_REFUSED";
  if (c === "AUTH_FAILED" || c === "HTTP_401" || c === "HTTP_403") return "AUTH_FAILED";
  if (
    c === "HOST_UNREACHABLE" ||
    c === "EHOSTUNREACH" ||
    c === "ENETUNREACH" ||
    c === "DNS_ERROR" ||
    c === "ENOTFOUND" ||
    c === "INVALID_HOST"
  )
    return "HOST_UNREACHABLE";
  return "UNKNOWN";
}

const REASON: Record<UnreachableFailureCode, string> = {
  TIMEOUT: "Perangkat tidak menjawab dalam batas waktu.",
  CONNECTION_REFUSED: "Koneksi ditolak: layanan di port tujuan tidak aktif.",
  AUTH_FAILED: "Login ditolak: username atau kata sandi tidak diterima.",
  HOST_UNREACHABLE: "Alamat perangkat tidak dapat dijangkau dari server NOC.",
  UNKNOWN: "Perangkat tidak dapat dihubungi (penyebab belum diketahui).",
};

const LABEL: Record<UnreachableDeviceType, string> = {
  router: "router MikroTik",
  olt: "OLT",
  genieacs: "server GenieACS",
  billing: "portal billing",
};

function codeStep(code: UnreachableFailureCode, type: UnreachableDeviceType): string {
  switch (code) {
    case "TIMEOUT":
      return `Cek daya dan kabel/uplink ${LABEL[type]}, lalu ping dari server NOC.`;
    case "CONNECTION_REFUSED":
      return `Pastikan layanan API/web di ${LABEL[type]} aktif dan port benar.`;
    case "AUTH_FAILED":
      return `Periksa username dan kata sandi ${LABEL[type]} di Setup Perangkat.`;
    case "HOST_UNREACHABLE":
      return `Periksa alamat IP/hostname ${LABEL[type]} dan rute jaringan ke sana.`;
    default:
      return `Cek status fisik dan log ${LABEL[type]} untuk mencari penyebabnya.`;
  }
}

const TYPE_STEPS: Record<UnreachableDeviceType, [string, string]> = {
  router: [
    "Pastikan firewall MikroTik mengizinkan IP server NOC ke layanan api/www-ssl.",
    "Aktifkan REST API (service www-ssl) dan cek akun API di /user.",
  ],
  olt: [
    "Pastikan switch/uplink ke OLT menyala dan VLAN manajemen benar.",
    "Cek layanan Web/Telnet OLT aktif dan batas sesi login belum penuh.",
  ],
  genieacs: [
    "Pastikan proses genieacs-nbi berjalan dan port NBI (7557) terbuka.",
    "Cek log layanan GenieACS dan akses firewall dari server NOC.",
  ],
  billing: [
    "Buka portal billing di browser untuk memastikan situs hidup.",
    "Cek apakah akun sinkron billing terkunci atau kata sandinya berubah.",
  ],
};

function cliFor(type: UnreachableDeviceType, host: string): string | undefined {
  switch (type) {
    case "router":
      return `ping ${host} count=4\n/ip service print\n/ip service enable www-ssl`;
    case "olt":
      return `ping ${host}\ntelnet ${host} 23`;
    case "genieacs":
      return `curl -i http://${host}:7557/devices?limit=1\nsystemctl status genieacs-nbi`;
    case "billing":
      return `curl -I ${host}`;
  }
}

function hostOf(endpoint: string): string {
  const m = /^(?:[A-Z]+\s+)?(?:[a-z]+:\/\/)?([^\s/:]+)/.exec(endpoint.trim());
  return m?.[1] ?? endpoint;
}

export function diagnoseUnreachableDevice(params: {
  deviceId: string;
  deviceName: string;
  deviceType: UnreachableDeviceType;
  endpoint: string;
  lastSeenEpoch: number | null;
  nowSec: number;
  errorCode?: string;
  consecutiveFailures?: number;
}): UnreachableDeviceReport {
  const failureCode = mapFailureCode(params.errorCode);
  const downtime = params.nowSec - (params.lastSeenEpoch ?? params.nowSec);
  const steps = [
    codeStep(failureCode, params.deviceType),
    ...TYPE_STEPS[params.deviceType],
  ];
  const cli = cliFor(params.deviceType, hostOf(params.endpoint));
  return {
    deviceId: params.deviceId,
    deviceName: params.deviceName,
    deviceType: params.deviceType,
    endpoint: params.endpoint,
    lastSeenEpoch: params.lastSeenEpoch,
    downtimeSeconds: Math.max(0, downtime),
    failureReason: REASON[failureCode],
    failureCode,
    consecutiveFailures: Math.max(1, Math.floor(params.consecutiveFailures ?? 1)),
    troubleshootingSteps: steps,
    ...(cli && { suggestedCliCommand: cli }),
  };
}

export function computeRetryPolicy(
  consecutiveFailures: number,
  lastRetryEpoch: number,
  nowSec: number,
): DeviceRetryPolicy {
  const n = Number.isFinite(consecutiveFailures) ? Math.max(1, Math.floor(consecutiveFailures)) : 1;
  const backoffMs = BACKOFF_MS[Math.min(n, BACKOFF_MS.length) - 1];
  const nextRetryEpoch = lastRetryEpoch + Math.ceil(backoffMs / 1000);
  return {
    maxRetries: MAX_AUTO_RETRIES,
    backoffMs,
    nextRetryEpoch,
    canRetryNow: nowSec >= nextRetryEpoch,
  };
}

export function formatDowntime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} detik`;
  if (s < 3600) return `${Math.floor(s / 60)} menit`;
  if (s < 86400) return `${Math.floor(s / 3600)} jam ${Math.floor((s % 3600) / 60)} menit`;
  return `${Math.floor(s / 86400)} hari ${Math.floor((s % 86400) / 3600)} jam`;
}
