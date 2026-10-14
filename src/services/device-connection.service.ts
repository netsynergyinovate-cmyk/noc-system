import "server-only";

import { ApiError } from "@/lib/api";
import type { DeviceTarget } from "@/lib/mode-switch";
import { getDeviceMode } from "@/services/mode-switch.service";
import { saveDeviceTestResult } from "@/services/device-test-results.service";
import type { DeviceConnectionTestInput } from "@/lib/device-connection";
import {
  defaultPortFor,
  parseTarget,
  testDeviceConnection as runDeviceConnectionTest,
  type DeviceTestResult,
  type DeviceType,
} from "@/services/device-connection-tester";

export type DeviceConnectionResponse = DeviceTestResult & {
  type: DeviceType;
  mode: "simulator" | "real";
};

// Motor uji ada di device-connection-tester; hasilnya superset TestOutcome (frontend)
// dan DeviceConnectionTestResult (panel lama): ok, message, code, latencyMs, data.
export async function testDeviceConnection(
  input: DeviceConnectionTestInput,
  opts: { testedBy?: string; deviceId?: string } = {},
): Promise<DeviceConnectionResponse> {
  const target = parseTarget(input.host);
  const tls = target?.useTls ?? input.useTls ?? input.port === 443;
  const mode = input.mode ?? getDeviceMode(input.type as DeviceTarget);
  const port = input.port ?? target?.port ?? defaultPortFor(input.type, tls);
  const result = await runDeviceConnectionTest({
    type: input.type,
    host: input.host,
    port,
    username: input.username ?? "",
    password: input.password,
    mode,
    useTls: input.useTls,
  });
  const response: DeviceConnectionResponse = { ...result, type: input.type, mode };
  // Simpan riwayat; kegagalan DB tidak boleh menggagalkan uji koneksi.
  try {
    await saveDeviceTestResult(response, opts.testedBy, opts.deviceId, {
      host: target?.host ?? input.host,
      port,
      username: input.username,
    });
  } catch {
    // ponytail: DB tidak tersedia = riwayat dilewati; tambah log bila perlu diagnosa.
  }
  return response;
}

async function testOrThrow(input: DeviceConnectionTestInput) {
  const result = await testDeviceConnection(input);
  if (!result.ok) {
    throw new ApiError(400, result.code, result.message);
  }
  return result;
}

// Pembungkus agar route handler lama tidak berubah.
export async function testMikrotikConnection(params: {
  host: string;
  username: string;
  password: string;
}): Promise<{
  ok: boolean;
  version?: string;
  cpuLoad?: number;
  uptime?: string;
  boardName?: string;
}> {
  const r = await testOrThrow({ ...params, type: "mikrotik", mode: "real" });
  const d = r.data ?? {};
  return {
    ok: true,
    version: d.version as string | undefined,
    cpuLoad: d.cpuLoad as number | undefined,
    uptime: d.uptime as string | undefined,
    boardName: d.boardName as string | undefined,
  };
}

// ponytail: OLT dites lewat HTTP saja (web UI/REST). SNMP/Telnet belum ada;
// tambahkan per driver saat ada OLT nyata untuk diuji.
export async function testOltConnection(params: {
  host: string;
  brand: string;
  driver: string;
  username: string;
  password: string;
}): Promise<{ ok: boolean; info?: string }> {
  await testOrThrow({
    type: "olt",
    mode: "real",
    host: params.host,
    username: params.username,
    password: params.password,
  });
  return { ok: true, info: "OLT terhubung" };
}
