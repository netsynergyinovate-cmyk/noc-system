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
    const resolvedId =
      raw !== null && typeof raw === "object" && "_id" in raw && typeof raw._id === "string"
        ? raw._id
        : candidate;

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

    for (const i of [1, 2, 3, 4, 5]) {
      if (readParam(raw, `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TotalAssociations`) !== undefined) {
        paramNames.push(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.TotalAssociations`);
      }
    }
    // Port Ethernet LAN: link naik/turun dan kecepatan ikut dibaca langsung (bukan hanya Wi-Fi).
    for (const i of [1, 2, 3, 4]) {
      for (const leaf of ["Status", "MaxBitRate"]) {
        const path = `InternetGatewayDevice.LANDevice.1.LANEthernetInterfaceConfig.${i}.${leaf}`;
        if (readParam(raw, path) !== undefined) paramNames.push(path);
      }
    }
    if (readParam(raw, "InternetGatewayDevice.DeviceInfo.UpTime") !== undefined) {
      paramNames.push("InternetGatewayDevice.DeviceInfo.UpTime");
    }

    const objectsToRefresh: string[] = [];
    if (hasNode(raw, "InternetGatewayDevice.LANDevice.1.Hosts")) {
      objectsToRefresh.push("InternetGatewayDevice.LANDevice.1.Hosts.Host");
    } else if (hasNode(raw, "Device.Hosts")) {
      objectsToRefresh.push("Device.Hosts.Host");
    }

    for (const i of [1, 2, 3, 4, 5]) {
      if (hasNode(raw, `InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.AssociatedDevice`)) {
        objectsToRefresh.push(`InternetGatewayDevice.LANDevice.1.WLANConfiguration.${i}.AssociatedDevice`);
      }
    }

    const tasks: Array<{ task: Record<string, unknown>; desc: string }> = [];
    if (paramNames.length > 0) {
      tasks.push({ task: { name: "getParameterValues", parameterNames: paramNames }, desc: "getParameterValues" });
    }
    for (const obj of objectsToRefresh) {
      tasks.push({ task: { name: "refreshObject", objectName: obj }, desc: `refreshObject:${obj}` });
    }

    if (tasks.length === 0) {
      return { ok: true, refreshed: false, status: 200, tasksSent: [] };
    }

    // Batch: kirim task 1 s.d. n-1 tanpa wake-up (connectionRequest=false),
    // lalu kirim task terakhir DENGAN connection_request=true & timeout.
    // Modem hanya dibangunkan SEKALI dan menyelesaikan semua task dalam satu sesi.
    const postedTaskIds: string[] = [];
    const tasksSent: string[] = [];
    let lastStatus = 200;
    let anyApplied = false;

    for (let i = 0; i < tasks.length; i++) {
      const isLast = i === tasks.length - 1;
      const { task, desc } = tasks[i];
      tasksSent.push(desc);

      const res = await client.postTask(
        resolvedId,
        task,
        isLast,
        isLast ? READBACK_WAIT_MS : undefined,
      );

      if (res.taskId) postedTaskIds.push(res.taskId);
      if (isLast) {
        lastStatus = res.status ?? (res.ok ? 200 : 500);
        if (res.ok && res.status === 200) {
          anyApplied = true;
        }
      }
    }

    // Bila tidak selesai 200 (mis. 202/timeout), bersihkan semua task yang diantrekan
    if (!anyApplied) {
      for (const tid of postedTaskIds) {
        await client.deleteTask(tid);
      }
    }

    return {
      ok: anyApplied,
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
