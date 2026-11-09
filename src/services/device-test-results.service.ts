import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  deviceTestCodes,
  deviceTestResults,
  type DeviceTestCode,
  type DeviceTestResultRow,
  type DeviceType,
} from "@/db/schema";
import { redactSecrets } from "@/services/device-connection-tester";
import type { DeviceConnectionResponse } from "@/services/device-connection.service";

export interface DeviceTestTarget {
  host: string;
  port: number;
  username?: string | null;
}

// Simpan satu hasil uji. Password tidak pernah masuk: hanya username & hasil yang sudah disaring.
export async function saveDeviceTestResult(
  result: DeviceConnectionResponse,
  testedBy?: string,
  deviceId?: string,
  target: DeviceTestTarget = { host: "-", port: 0 },
): Promise<DeviceTestResultRow> {
  const [row] = await db
    .insert(deviceTestResults)
    .values({
      deviceType: result.type,
      deviceId: deviceId ?? null,
      host: target.host,
      port: target.port,
      username: target.username || null,
      endpointTested: result.endpointTested,
      mode: result.mode,
      status: result.status,
      code: result.code,
      statusCode: result.statusCode ?? null,
      message: result.message,
      latencyMs: result.latencyMs,
      ok: result.ok,
      details: result.data ?? {},
      testedBy: testedBy ?? null,
      testedAt: new Date(result.timestamp * 1000),
    })
    .returning();
  return row;
}

export interface ClientTestRaw {
  ok: boolean;
  message: string;
  code?: string;
  statusCode?: number;
  latencyMs?: number | null;
  endpointTested?: string;
  timestamp?: number;
  data?: Record<string, unknown>;
  resource?: object;
}

const KNOWN_CODES: ReadonlySet<string> = new Set(deviceTestCodes);
const TEST_PATH: Partial<Record<DeviceType, string>> = {
  mikrotik: "/rest/system/resource",
  olt: "/api/v1/system",
};

/**
 * Ubah hasil klien (MikrotikRestClient/HsgqClient) ke bentuk seragam, saring
 * rahasia, lalu simpan ke device_test_results. Gagal koneksi (ok=false) tetap
 * disimpan; kegagalan DB tidak menggagalkan uji.
 */
export async function recordClientTestResult(input: {
  type: DeviceType;
  mode: "simulator" | "real";
  raw: ClientTestRaw;
  host: string;
  port: number;
  tls?: boolean;
  username: string;
  password?: string;
  testedBy?: string;
  deviceId?: string;
}): Promise<DeviceConnectionResponse> {
  const { raw } = input;
  const secrets = { username: input.username, password: input.password };
  const code = raw.ok
    ? "OK"
    : KNOWN_CODES.has(raw.code ?? "")
      ? (raw.code as DeviceTestCode)
      : "HTTP_ERROR";
  const endpoint =
    raw.endpointTested ??
    `GET http${input.tls ? "s" : ""}://${input.host}:${input.port}${TEST_PATH[input.type] ?? ""}`;
  const data = (raw.data ?? raw.resource) as
    Record<string, unknown> | undefined;
  const response: DeviceConnectionResponse = {
    type: input.type,
    mode: input.mode,
    ok: raw.ok,
    status: raw.ok ? "connected" : code === "TIMEOUT" ? "timeout" : "error",
    code,
    statusCode: raw.statusCode,
    message: redactSecrets(raw.message, secrets),
    latencyMs: raw.latencyMs ?? null,
    endpointTested: redactSecrets(endpoint, secrets),
    timestamp: raw.timestamp ?? Math.floor(Date.now() / 1000),
    ...(data && { data }),
  };
  try {
    await saveDeviceTestResult(response, input.testedBy, input.deviceId, {
      host: input.host,
      port: input.port,
      username: input.username,
    });
  } catch {
    // ponytail: DB tidak tersedia = riwayat dilewati; tambah log bila perlu diagnosa.
  }
  return response;
}

// Hasil uji terbaru; filter host dan/atau deviceId bila diberikan.
export async function getLatestDeviceTestResult(
  deviceType: DeviceType,
  host?: string,
  deviceId?: string,
): Promise<DeviceTestResultRow | null> {
  const conds = [eq(deviceTestResults.deviceType, deviceType)];
  if (host) conds.push(eq(deviceTestResults.host, host));
  if (deviceId) conds.push(eq(deviceTestResults.deviceId, deviceId));
  const [row] = await db
    .select()
    .from(deviceTestResults)
    .where(and(...conds))
    .orderBy(desc(deviceTestResults.testedAt))
    .limit(1);
  return row ?? null;
}
