import "server-only";
import { and, desc, eq, inArray, count, SQL } from "drizzle-orm";
import { db } from "@/db";
import { cpeTasks, auditLog, customers } from "@/db/schema";
import { GenieAcsClient } from "../lib/genieacs/client.ts";
import { getGenieacsConfig } from "../lib/genieacs/config.ts";
import { changeDeviceWifi, WifiChangeError } from "./cpe-detail.service.ts";
import {
  ChangeWifiInput,
  CreateDiagnosticTaskInput,
  ListCpeTasksParams,
} from "@/validators/cpe";
import { ApiError } from "@/lib/api";

/** Cari deviceId GenieACS pelanggan lewat pppoe_username. Null bila tidak ada. */
async function resolveDeviceId(
  client: GenieAcsClient,
  simulator: boolean,
  customerId: string,
): Promise<string | null> {
  const [customer] = await db
    .select({ pppoeUsername: customers.pppoeUsername })
    .from(customers)
    .where(eq(customers.id, customerId))
    .limit(1);
  if (!customer) return null;
  const found = await client.findDeviceIdByPppoe(customer.pppoeUsername);
  if (found) return found;
  // Simulator tidak punya perangkat untuk pelanggan database; task tiruan tetap diterima.
  return simulator ? `sim-${customer.pppoeUsername}` : null;
}

export async function enqueueChangeWifi(input: ChangeWifiInput, userId: string) {
  // Masukkan dua task: satu untuk ganti SSID, satu untuk password
  const tasks = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(cpeTasks)
      .values([
        {
          customerId: input.customerId,
          action: "change_ssid",
          payload: { ssid: input.ssid },
          createdBy: userId,
          status: "pending",
        },
        {
          customerId: input.customerId,
          action: "change_password",
          payload: { password: input.password },
          createdBy: userId,
          status: "pending",
        },
      ])
      .returning();

    await tx.insert(auditLog).values({
      userId,
      action: "enqueue_change_wifi",
      target: input.customerId,
      // Jangan log password di detail!
      detail: { ssid: input.ssid },
    });

    return inserted;
  });

  // Dorong ke GenieACS. Gagal mendorong tidak boleh membatalkan antrean yang sudah tercatat.
  let ok = false;
  try {
    const config = getGenieacsConfig();
    const client = new GenieAcsClient(config);
    const deviceId = await resolveDeviceId(client, config.mode === "simulator", input.customerId);
    if (deviceId) {
      // Jalur baru: tulis ke parameter sandi yang benar-benar ada di modem itu, lalu baca ulang
      // untuk memastikan. Null (simulator) atau modem tanpa parameter sandi yang dikenal: jalur lama.
      try {
        const changed = await changeDeviceWifi(deviceId, { index: 1, ssid: input.ssid, password: input.password }, client);
        ok = changed !== null ? true : (await client.setWifiConfig(deviceId, { ssid: input.ssid, password: input.password })).ok;
      } catch (err) {
        ok = err instanceof WifiChangeError
          ? (await client.setWifiConfig(deviceId, { ssid: input.ssid, password: input.password })).ok
          : false;
      }
    }
  } catch {
    // Pesan galat sengaja tidak dicatat: bisa membawa data permintaan.
    ok = false;
  }

  const ids = tasks.map((t) => t.id);
  const status = ok ? "success" : "failed";
  // Tugas sudah final: kata sandi tidak perlu tersimpan lagi di payload.
  await db.update(cpeTasks).set({ status }).where(inArray(cpeTasks.id, ids));
  await db
    .update(cpeTasks)
    .set({ payload: {} })
    .where(
      inArray(
        cpeTasks.id,
        tasks.filter((t) => t.action === "change_password").map((t) => t.id),
      ),
    );

  return tasks.map((t) => ({ ...t, status }));
}

export async function enqueueDiagnosticTask(input: CreateDiagnosticTaskInput, userId: string) {
  const [customer] = await db
    .select({ id: customers.id, name: customers.name, pppoeUsername: customers.pppoeUsername })
    .from(customers)
    .where(eq(customers.id, input.customerId))
    .limit(1);

  if (!customer) {
    throw new ApiError(404, "CUSTOMER_NOT_FOUND", "Pelanggan tidak ditemukan.");
  }

  const [task] = await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(cpeTasks)
      .values({
        customerId: input.customerId,
        action: input.action,
        payload: {
          parameters: input.parameters,
          customerName: customer.name,
          pppoeUsername: customer.pppoeUsername,
        },
        createdBy: userId,
        status: "pending",
      })
      .returning();

    await tx.insert(auditLog).values({
      userId,
      action: `cpe_diagnostic_${input.action}`,
      target: input.customerId,
      detail: { taskId: inserted[0].id, action: input.action, parameters: input.parameters },
    });

    return inserted;
  });

  // Eksekusi task ke GenieACS / Simulator
  let ok = false;
  let resultSummary = "";
  let latencyMs: number | null = null;
  let errorReason: string | undefined = undefined;

  try {
    const config = getGenieacsConfig();
    const client = new GenieAcsClient(config);
    const deviceId = await resolveDeviceId(client, config.mode === "simulator", input.customerId);

    if (!deviceId) {
      ok = false;
      errorReason = "Perangkat tidak ditemukan di GenieACS atau pelanggan offline.";
    } else if (config.mode === "simulator") {
      ok = true;
      if (input.action === "ping_test") {
        latencyMs = 15;
        resultSummary = "4/4 paket diterima (0% packet loss), RTT min/avg/max = 12/15/18 ms";
      } else if (input.action === "traceroute") {
        latencyMs = 24;
        resultSummary = "Traceroute selesai: 5 hop tercapai tanpa packet loss";
      } else if (input.action === "reboot_device") {
        resultSummary = "Perintah reboot berhasil dikirim ke perangkat";
      } else if (input.action === "check_optical") {
        resultSummary = "Redaman RX -21.40 dBm, TX 2.30 dBm, kondisi normal";
      } else if (input.action === "speed_test") {
        latencyMs = 20;
        resultSummary = "Download 45.2 Mbps, Upload 18.5 Mbps";
      } else if (input.action === "factory_reset") {
        resultSummary = "Perintah reset pabrik berhasil dikirim ke perangkat";
      } else if (input.action === "list_hosts") {
        resultSummary = "Daftar 3 klien LAN berhasil diambil";
      }
    } else {
      // Real mode: dorong ke GenieACS tasks
      let postRes: { ok: boolean; error?: string } = { ok: false };
      if (input.action === "reboot_device") {
        postRes = await client.postTask(deviceId, { name: "reboot" });
      } else if (input.action === "factory_reset") {
        postRes = await client.postTask(deviceId, { name: "factoryReset" });
      } else {
        // Diagnostic task TR-069
        postRes = await client.postTask(deviceId, {
          name: "setParameterValues",
          parameterValues: Object.entries(input.parameters).map(([k, v]) => [k, String(v), "xsd:string"]),
        });
      }

      ok = postRes.ok;
      if (!ok) {
        errorReason = postRes.error || "Gagal mengirim tugas ke perangkat via GenieACS";
      } else {
        resultSummary = `Tugas ${input.action} berhasil diterima GenieACS NBI`;
      }
    }
  } catch (err) {
    ok = false;
    errorReason = err instanceof Error ? err.message : "Gagal memproses diagnostik CPE";
  }

  const finalStatus = ok ? "success" : "failed";
  const updatedPayload = {
    ...task.payload,
    resultSummary,
    latencyMs,
    errorReason,
    completedAt: new Date().toISOString(),
  };

  await db
    .update(cpeTasks)
    .set({
      status: finalStatus,
      payload: updatedPayload,
      updatedAt: new Date(),
    })
    .where(eq(cpeTasks.id, task.id));

  return {
    ...task,
    status: finalStatus,
    payload: updatedPayload,
  };
}

export async function listCpeDiagnosticTasks(params: ListCpeTasksParams) {
  const conds: SQL[] = [];
  if (params.customerId) conds.push(eq(cpeTasks.customerId, params.customerId));
  if (params.action) conds.push(eq(cpeTasks.action, params.action as any));
  if (params.status) conds.push(eq(cpeTasks.status, params.status));

  const where = conds.length > 0 ? and(...conds) : undefined;

  const [items, [{ total }]] = await Promise.all([
    db
      .select({
        id: cpeTasks.id,
        customerId: cpeTasks.customerId,
        customerName: customers.name,
        action: cpeTasks.action,
        status: cpeTasks.status,
        payload: cpeTasks.payload,
        createdBy: cpeTasks.createdBy,
        createdAt: cpeTasks.createdAt,
        updatedAt: cpeTasks.updatedAt,
      })
      .from(cpeTasks)
      .leftJoin(customers, eq(customers.id, cpeTasks.customerId))
      .where(where)
      .orderBy(desc(cpeTasks.createdAt))
      .limit(params.limit)
      .offset(params.offset),
    db
      .select({ total: count() })
      .from(cpeTasks)
      .where(where),
  ]);

  return { items, total };
}
