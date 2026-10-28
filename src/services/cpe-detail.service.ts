// Rincian dan sandi satu modem dari GenieACS. Relatif (tanpa alias / server-only) agar
// bisa diuji dengan node --test.
import { GenieAcsClient } from "../lib/genieacs/client.ts";
import {
  hasNode,
  parseDeviceDetail,
  parseDeviceSecrets,
  planWifiChange,
  readParam,
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

export interface RefreshRealtimeResult {
  ok: boolean;
  refreshed: boolean;
  status: number;
  tasksSent: string[];
}

/**
 * Memicu pembacaan parameter segar dari modem seketika (real-time) via connection request TR-069.
 * Mengambil optik (redaman) dan perangkat terhubung saat itu secara aman:
 * 1. Hanya meminta parameter yang benar-benar ada di pohon modem (menghindari fault 9005).
 * 2. Menggunakan refreshObject untuk objek Host / AssociatedDevice yang ada (dicek via hasNode).
 * 3. Menghapus task dari antrean GenieACS bila berstatus 202 (queued) agar tidak menumpuk di modem offline.
 */
export async function refreshCpeRealtime(
  id: string,
  client = new GenieAcsClient(),
): Promise<RefreshRealtimeResult> {
  for (const candidate of deviceIdCandidates(id)) {
    const raw = await client.getRawDevice(candidate);
    if (!raw) continue;

    // Kumpulkan parameter leaf yang benar-benar ada di pohon modem ini
    const paramNames: string[] = [];
    if (readParam(raw, "InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower") !== undefined) {
      paramNames.push(
        "InternetGatewayDevice.X_ALU_OntOpticalParam.RXPower",
        "InternetGatewayDevice.X_ALU_OntOpticalParam.TXPower",
      );
      if (readParam(raw, "InternetGatewayDevice.X_ALU_OntOpticalParam.TransceiverTemperature") !== undefined) {
        paramNames.push("InternetGatewayDevice.X_ALU_OntOpticalParam.TransceiverTemperature");
      }
    } else if (readParam(raw, "InternetGatewayDevice.DeviceInfo.XponInterface.RXPower") !== undefined) {
      paramNames.push(
        "InternetGatewayDevice.DeviceInfo.XponInterface.RXPower",
        "InternetGatewayDevice.DeviceInfo.XponInterface.TXPower",
      );
      if (readParam(raw, "InternetGatewayDevice.DeviceInfo.XponInterface.TransceiverTemperature") !== undefined) {
        paramNames.push("InternetGatewayDevice.DeviceInfo.XponInterface.TransceiverTemperature");
      }
    } else if (readParam(raw, "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower") !== undefined) {
      paramNames.push(
        "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.RXPower",
        "InternetGatewayDevice.WANDevice.1.X_CT-COM_EponInterfaceConfig.TXPower",
      );
    } else if (readParam(raw, "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower") !== undefined) {
      paramNames.push(
        "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.RXPower",
        "InternetGatewayDevice.WANDevice.1.X_CT-COM_GponInterfaceConfig.TXPower",
      );
    }

    if (readParam(raw, "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations") !== undefined) {
      paramNames.push("InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.TotalAssociations");
    }
    if (readParam(raw, "InternetGatewayDevice.DeviceInfo.UpTime") !== undefined) {
      paramNames.push("InternetGatewayDevice.DeviceInfo.UpTime");
    }

    const tasksSent: string[] = [];
    let allOk = true;
    let anyApplied = false;
    let lastStatus = 200;

    // 1. Minta pembacaan parameter nilai (redaman, total asosiasi, uptime)
    if (paramNames.length > 0) {
      tasksSent.push("getParameterValues");
      const res = await client.postTask(
        candidate,
        { name: "getParameterValues", parameterNames: paramNames },
        true,
        READBACK_WAIT_MS,
      );
      lastStatus = res.status ?? (res.ok ? 200 : 500);
      if (res.ok && res.status === 200) {
        anyApplied = true;
      } else {
        allOk = false;
        if (res.status === 202 && res.taskId) {
          await client.deleteTask(res.taskId);
        }
      }
    }

    // 2. Minta penyegaran pohon host kabel & Wi-Fi
    const objectToRefresh = hasNode(raw, "InternetGatewayDevice.LANDevice.1.Hosts")
      ? "InternetGatewayDevice.LANDevice.1.Hosts.Host"
      : hasNode(raw, "Device.Hosts")
        ? "Device.Hosts.Host"
        : null;

    if (objectToRefresh) {
      tasksSent.push(`refreshObject:${objectToRefresh}`);
      const objRes = await client.postTask(
        candidate,
        { name: "refreshObject", objectName: objectToRefresh },
        true,
        READBACK_WAIT_MS,
      );
      if (objRes.ok && objRes.status === 200) {
        anyApplied = true;
      } else {
        allOk = false;
        if (objRes.status === 202 && objRes.taskId) {
          await client.deleteTask(objRes.taskId);
        }
      }
    }

    // 3. Minta penyegaran pohon AssociatedDevice bila firmware mendukung
    if (hasNode(raw, "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice")) {
      const assocTarget = "InternetGatewayDevice.LANDevice.1.WLANConfiguration.1.AssociatedDevice";
      tasksSent.push(`refreshObject:${assocTarget}`);
      const assocRes = await client.postTask(
        candidate,
        { name: "refreshObject", objectName: assocTarget },
        true,
        READBACK_WAIT_MS,
      );
      if (assocRes.ok && assocRes.status === 200) {
        anyApplied = true;
      } else {
        allOk = false;
        if (assocRes.status === 202 && assocRes.taskId) {
          await client.deleteTask(assocRes.taskId);
        }
      }
    }

    return {
      ok: anyApplied || allOk,
      refreshed: anyApplied,
      status: anyApplied ? 200 : lastStatus,
      tasksSent,
    };
  }
  return { ok: false, refreshed: false, status: 404, tasksSent: [] };
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
