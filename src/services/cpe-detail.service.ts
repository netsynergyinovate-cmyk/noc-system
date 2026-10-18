// Rincian dan sandi satu modem dari GenieACS. Relatif (tanpa alias / server-only) agar
// bisa diuji dengan node --test.
import { GenieAcsClient } from "../lib/genieacs/client.ts";
import {
  parseDeviceDetail,
  parseDeviceSecrets,
  planWifiChange,
  verifyWifiChange,
  WifiChangeError,
  type CpeDetail,
  type DeviceSecrets,
  type WifiVerification,
} from "../lib/genieacs/device-detail.ts";

/**
 * Id GenieACS memuat teks "%2D" apa adanya (mis. D05FAF-FD511GW-DF77%2D2511027460), jadi
 * satu kali decode di URL tidak boleh diulang diam-diam: coba id sesuai diterima dulu,
 * baru bentuk yang di-decode lagi (untuk klien yang meng-encode dua kali).
 */
export function deviceIdCandidates(id: string): string[] {
  const out = [id];
  try {
    const decoded = decodeURIComponent(id);
    if (decoded !== id) out.push(decoded);
  } catch {
    // bukan escape yang sah: pakai apa adanya
  }
  return out;
}

async function loadRaw(id: string, client: GenieAcsClient): Promise<unknown | null> {
  for (const candidate of deviceIdCandidates(id)) {
    const raw = await client.getRawDevice(candidate);
    if (raw) return raw;
  }
  return null;
}

export async function getCpeDetail(id: string, client = new GenieAcsClient()): Promise<CpeDetail | null> {
  const raw = await loadRaw(id, client);
  return raw ? parseDeviceDetail(raw) : null;
}

export async function getCpeSecrets(
  id: string,
  client = new GenieAcsClient(),
): Promise<{ deviceId: string; secrets: DeviceSecrets } | null> {
  const raw = await loadRaw(id, client);
  if (!raw) return null;
  return { deviceId: parseDeviceDetail(raw).deviceId, secrets: parseDeviceSecrets(raw) };
}

// ---------------------------------------------------------------------------
// Ubah Wi-Fi satu modem
// ---------------------------------------------------------------------------
export interface WifiChangeResult {
  /** applied: modem menerima dan menjalankan. queued: tersimpan di GenieACS, jalan saat modem lapor. */
  status: "applied" | "queued";
  verified: WifiVerification;
  deviceId: string;
  message: string;
}

export class WifiChangeFailed extends Error {
  httpStatus?: number;
  constructor(message: string, httpStatus?: number) {
    super(message);
    this.name = "WifiChangeFailed";
    this.httpStatus = httpStatus;
  }
}

// NBI menunggu sebegini lama sampai modem menyelesaikan task. Mengubah Wi-Fi bisa membuat radio
// restart beberapa detik, dan modem harus dihubungi dulu lewat connection request.
const WIFI_WAIT_MS = 20_000;
const READBACK_WAIT_MS = 15_000;

export async function changeDeviceWifi(
  id: string,
  input: { index: number; ssid?: string; password?: string },
  client = new GenieAcsClient(),
): Promise<WifiChangeResult | null> {
  let deviceId = "";
  let raw: unknown = null;
  for (const candidate of deviceIdCandidates(id)) {
    raw = await client.getRawDevice(candidate);
    if (raw) {
      deviceId = candidate;
      break;
    }
  }
  if (!raw) return null;

  // Melempar WifiChangeError (WLAN tidak ada / tak ada parameter sandi): dipetakan route ke 4xx.
  const plan = planWifiChange(raw, input);

  const sent = await client.postTask(deviceId, { name: "setParameterValues", parameterValues: plan.parameterValues }, true, WIFI_WAIT_MS);
  if (!sent.ok) throw new WifiChangeFailed(sent.error ?? "GenieACS menolak perintah.", sent.status);

  // 200 = modem sudah menjalankan; 202 = diantre (modem belum bisa dihubungi sekarang).
  if (sent.status === 202) {
    return {
      status: "queued",
      verified: { ssid: null, password: null },
      deviceId,
      message: "Perintah tersimpan di GenieACS dan akan dijalankan saat modem menghubungi ACS (modem tidak menjawab sekarang).",
    };
  }

  // Baca ulang dari modem lalu bandingkan: 200 dari NBI tidak membuktikan nilainya berubah
  // (fault dari modem ikut menjadi 200 pada sebagian versi).
  await client.postTask(deviceId, { name: "getParameterValues", parameterNames: plan.readBack }, true, READBACK_WAIT_MS);
  const after = await client.getRawDevice(deviceId);
  const verified = verifyWifiChange(after, plan);
  const failed = verified.ssid === false || verified.password === false;
  if (failed) {
    throw new WifiChangeFailed("Modem menerima perintah tetapi nilainya tidak berubah. Periksa karakter SSID/sandi atau coba lagi.");
  }
  return {
    status: "applied",
    verified,
    deviceId,
    message:
      "Wi-Fi diubah. Perangkat yang terhubung akan terputus dan perlu memakai " +
      (input.password !== undefined ? "sandi baru." : "nama Wi-Fi baru."),
  };
}

export { WifiChangeError };
