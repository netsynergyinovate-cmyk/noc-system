import "server-only";
import { and, count, desc, eq, gte, isNotNull, isNull, lte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  alertKinds,
  alertSeverities,
  alertTicketPriorities,
  alertTicketStatuses,
  alerts,
  auditLog,
  routers,
  type AlertKind,
  type AlertSeverity,
} from "@/db/schema";
import {
  defaultWhatsappConfig,
  renderWhatsappMessage,
} from "@/lib/dashboard/whatsapp";
import { broadcastWhatsappMessage } from "@/services/whatsapp.service";
import { env } from "@/lib/env";
import { sanitizeAuditDetail } from "@/lib/audit-sanitize";
import {
  validateTicketActionInput,
  type AlertTicketActionInput,
  type AlertTicketPriority,
  type AlertTicketResponseRecord,
  type AlertTicketStatus,
} from "@/lib/dashboard/alert-ticket-actions";
import { mockActiveAlerts, mockResolvedAlerts } from "@/lib/dashboard/alerts";

export type AlertListStatus = "active" | "resolved" | "all";

export interface AlertListOptions {
  status?: AlertListStatus;
  type?: string;
  severity?: string;
  /** Detik epoch. Dibandingkan dengan startedAt (endedAt untuk resolved). */
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

// Bentuk tunggal untuk data nyata dan tiruan. Waktu = detik epoch bulat.
export interface AlertItem {
  id: string;
  type: string;
  severity: string;
  status: string;
  routerId: string | null;
  customerId: string | null;
  title: string | null;
  message: string | null;
  startedAt: number;
  detectedAt: number;
  endedAt: number | null;
  timeSource: string;
  timeUncertaintySeconds: number;
  endTimeSource: string | null;
  endTimeUncertaintySeconds: number | null;
  handledBy: string | null;
  handledAt: number | null;
  opticalPowerDbm: number | null;
  location: {
    name: string;
    address: string | null;
    odpName: string | null;
    latitude: number | null;
    longitude: number | null;
  };
  ticket: {
    status: string;
    priority: string;
    notes: string | null;
    actionTaken: string | null;
    dispatchTechnician: boolean;
    technicianName: string | null;
  };
}

type AlertRow = typeof alerts.$inferSelect;

const sec = (d: Date | null) => (d ? Math.floor(d.getTime() / 1000) : null);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

function toItem(r: AlertRow): AlertItem {
  return {
    id: r.id,
    type: r.type,
    severity: r.severity,
    status: r.status,
    routerId: r.routerId,
    customerId: r.customerId,
    title: r.title,
    message: r.message,
    startedAt: sec(r.startedAt)!,
    detectedAt: sec(r.detectedAt)!,
    endedAt: sec(r.endedAt),
    timeSource: r.timeSource,
    timeUncertaintySeconds: r.timeUncertaintySeconds,
    endTimeSource: r.endTimeSource,
    endTimeUncertaintySeconds: r.endTimeUncertaintySeconds,
    handledBy: r.handledBy,
    handledAt: sec(r.handledAt),
    // Rx pada saat alert optik dibuat rule engine (detail.opticalPowerDbm).
    opticalPowerDbm:
      typeof r.detail?.opticalPowerDbm === "number"
        ? r.detail.opticalPowerDbm
        : null,
    location: {
      name:
        r.locationName ??
        r.locationOdp ??
        r.locationAddress ??
        "Lokasi belum diketahui",
      address: r.locationAddress,
      odpName: r.locationOdp,
      latitude: r.latitude,
      longitude: r.longitude,
    },
    ticket: {
      status: r.ticketStatus,
      priority: r.ticketPriority,
      notes: r.ticketNotes,
      actionTaken: r.actionTaken,
      dispatchTechnician: r.dispatchTechnician ?? false,
      technicianName: r.technicianName,
    },
  };
}

function mockItems(nowSec: number): AlertItem[] {
  const base = {
    routerId: null,
    title: null,
    message: null,
    handledAt: null,
    opticalPowerDbm: null,
    ticket: {
      status: "open",
      priority: "medium",
      notes: null,
      actionTaken: null,
      dispatchTechnician: false,
      technicianName: null,
    },
  };
  const active = mockActiveAlerts(nowSec).map(
    (a): AlertItem => ({
      ...base,
      id: a.id,
      type: a.kind,
      severity: a.severity,
      status: "active",
      routerId: a.routerId,
      customerId: a.customerId,
      startedAt: a.startedAt,
      detectedAt: a.detectedAt,
      endedAt: null,
      timeSource: a.timeSource,
      timeUncertaintySeconds: a.timeUncertaintySeconds,
      endTimeSource: null,
      endTimeUncertaintySeconds: null,
      handledBy: null,
      location: a.location,
    }),
  );
  const resolved = mockResolvedAlerts(nowSec).map(
    (a): AlertItem => ({
      ...base,
      id: a.id,
      type: a.kind,
      severity: a.severity,
      status: a.handledBy ? "handled" : "resolved",
      routerId: a.routerId,
      customerId: a.customerId,
      startedAt: a.startedAt,
      detectedAt: a.detectedAt,
      endedAt: a.endedAt,
      timeSource: a.timeSource,
      timeUncertaintySeconds: a.timeUncertaintySeconds,
      endTimeSource: a.endTimeSource,
      endTimeUncertaintySeconds: a.endTimeUncertaintySeconds,
      handledBy: a.handledBy,
      location: a.location,
    }),
  );
  return [...active, ...resolved];
}

function listFromMock(
  o: AlertListOptions,
  status: AlertListStatus,
  limit: number,
  offset: number,
) {
  const sortKey = (a: AlertItem) =>
    status === "resolved" ? a.endedAt! : a.startedAt;
  const items = mockItems(Math.floor(Date.now() / 1000))
    .filter((a) => {
      if (status === "active" && a.endedAt !== null) return false;
      if (status === "resolved" && a.endedAt === null) return false;
      if (o.type && a.type !== o.type) return false;
      if (o.severity && a.severity !== o.severity) return false;
      if (o.from !== undefined && sortKey(a) < o.from) return false;
      if (o.to !== undefined && sortKey(a) > o.to) return false;
      return true;
    })
    .sort((a, b) => sortKey(b) - sortKey(a) || a.id.localeCompare(b.id));
  return { items: items.slice(offset, offset + limit), total: items.length };
}

export async function getAlertsList(
  options: AlertListOptions = {},
): Promise<{ items: AlertItem[]; total: number }> {
  const status = options.status ?? "all";
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(options.offset ?? 0, 0);
  const demo = env.DASHBOARD_DATA === "demo";

  const sortCol = status === "resolved" ? alerts.endedAt : alerts.startedAt;
  const conds: SQL[] = [];
  if (status === "active") conds.push(isNull(alerts.endedAt));
  if (status === "resolved") conds.push(isNotNull(alerts.endedAt));
  if (options.type) conds.push(eq(alerts.type, options.type as never));
  if (options.severity)
    conds.push(eq(alerts.severity, options.severity as never));
  if (options.from !== undefined)
    conds.push(gte(sortCol, new Date(options.from * 1000)));
  if (options.to !== undefined)
    conds.push(lte(sortCol, new Date(options.to * 1000)));
  const where = conds.length ? and(...conds) : undefined;

  try {
    if (demo) {
      const [{ n }] = await db.select({ n: count() }).from(alerts);
      if (n === 0) return listFromMock(options, status, limit, offset);
    }
    const [rows, [{ total }]] = await Promise.all([
      db
        .select()
        .from(alerts)
        .where(where)
        .orderBy(desc(sortCol))
        .limit(limit)
        .offset(offset),
      db.select({ total: count() }).from(alerts).where(where),
    ]);
    return { items: rows.map(toItem), total };
  } catch (error) {
    // Demo tetap jalan tanpa database; live harus gagal terlihat.
    if (demo) return listFromMock(options, status, limit, offset);
    throw error;
  }
}

// Alert terbaru satu pelanggan (halaman detail pelanggan), terbaru dulu.
export async function listCustomerAlerts(customerId: string, limit = 10): Promise<AlertItem[]> {
  if (!UUID.test(customerId)) return [];
  const rows = await db
    .select()
    .from(alerts)
    .where(eq(alerts.customerId, customerId))
    .orderBy(desc(alerts.startedAt))
    .limit(limit);
  return rows.map(toItem);
}

export type HandleResult =
  | { ok: true; data: AlertItem }
  | { ok: false; error: "not_active" | "not_found" };

export async function markAlertHandled(
  alertId: string,
  operatorName: string,
  userId?: string | null,
): Promise<HandleResult> {
  if (!UUID.test(alertId)) return { ok: false, error: "not_found" };
  return db.transaction(async (tx): Promise<HandleResult> => {
    const now = new Date();
    // Satu UPDATE bersyarat: dua petugas serentak tidak bisa sama-sama berhasil.
    const [row] = await tx
      .update(alerts)
      .set({
        status: "handled",
        endedAt: now,
        endTimeSource: "operator",
        endTimeUncertaintySeconds: 0,
        handledBy: operatorName,
        handledAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(alerts.id, alertId),
          isNull(alerts.endedAt),
          eq(alerts.status, "active"),
        ),
      )
      .returning();
    if (!row) {
      const [exists] = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(eq(alerts.id, alertId))
        .limit(1);
      return { ok: false, error: exists ? "not_active" : "not_found" };
    }
    await tx.insert(auditLog).values({
      userId: userId ?? null,
      action: "alert_handle",
      target: alertId,
      detail: sanitizeAuditDetail({ actor: operatorName }),
    });
    return { ok: true, data: toItem(row) };
  });
}

function toTicketRecord(r: AlertRow): AlertTicketResponseRecord {
  return {
    id: r.id,
    alertId: r.id,
    status: r.ticketStatus as AlertTicketStatus,
    priority: r.ticketPriority as AlertTicketPriority,
    operator: r.handledBy || "Operator",
    notes: r.ticketNotes || "",
    respondedAt: (r.updatedAt || r.createdAt).toISOString(),
    actionTaken: r.actionTaken || undefined,
    dispatchTechnician: Boolean(r.dispatchTechnician),
    technicianName: r.technicianName || undefined,
  };
}

function ticketFromMock(alertId: string): AlertTicketResponseRecord | null {
  const nowSec = Math.floor(Date.now() / 1000);
  const a = mockItems(nowSec).find((x) => x.id === alertId);
  if (!a) return null;
  return {
    id: a.id,
    alertId: a.id,
    status: (a.endedAt === null ? "open" : "resolved") as AlertTicketStatus,
    priority: a.ticket.priority as AlertTicketPriority,
    operator: a.handledBy || "Operator",
    notes: "",
    respondedAt: new Date((a.endedAt ?? a.startedAt) * 1000).toISOString(),
    dispatchTechnician: false,
  };
}

export async function getAlertTicket(
  alertId: string,
): Promise<AlertTicketResponseRecord | null> {
  const demo = env.DASHBOARD_DATA === "demo";
  try {
    // Demo + tabel kosong: data tiruan memakai id non-UUID, jadi cek sebelum UUID.
    if (demo) {
      const [{ n }] = await db.select({ n: count() }).from(alerts);
      if (n === 0) return ticketFromMock(alertId);
    }
    if (!UUID.test(alertId)) return null;
    const [row] = await db
      .select()
      .from(alerts)
      .where(eq(alerts.id, alertId))
      .limit(1);
    return row ? toTicketRecord(row) : null;
  } catch (error) {
    if (demo) return ticketFromMock(alertId);
    throw error;
  }
}

export type TicketResult =
  | { ok: true; data: AlertTicketResponseRecord }
  | { ok: false; error: "validation_error"; details: string[] }
  | { ok: false; error: "not_found" };

// `input` datang dari body HTTP; alertId dan operator diisi di sini, bukan
// dipercaya dari klien.
export async function updateAlertTicket(
  alertId: string,
  input: Partial<AlertTicketActionInput> | null | undefined,
  operatorName: string,
  userId?: string | null,
): Promise<TicketResult> {
  const body = input ?? {};
  const full = { ...body, alertId, operator: operatorName } as AlertTicketActionInput;
  const { errors } = validateTicketActionInput({
    ...full,
    notes: typeof body.notes === "string" ? body.notes : "",
  });
  if (!alertTicketStatuses.includes(body.status as never))
    errors.push("Status tiket tidak valid.");
  if (!alertTicketPriorities.includes(body.priority as never))
    errors.push("Prioritas tiket tidak valid.");
  if (errors.length) return { ok: false, error: "validation_error", details: errors };
  if (!UUID.test(alertId)) return { ok: false, error: "not_found" };

  const dispatch = body.dispatchTechnician === true;
  let dispatched: AlertRow | null = null;
  const outcome = await db.transaction(async (tx): Promise<TicketResult> => {
    const now = new Date();
    const [row] = await tx
      .update(alerts)
      .set({
        ticketStatus: body.status,
        ticketPriority: body.priority,
        ticketNotes: body.notes!.trim(),
        actionTaken:
          typeof body.actionTaken === "string" && body.actionTaken.trim()
            ? body.actionTaken.trim()
            : null,
        dispatchTechnician: dispatch,
        technicianName: dispatch ? body.technicianName!.trim() : null,
        updatedAt: now,
      })
      .where(eq(alerts.id, alertId))
      .returning();
    if (!row) return { ok: false, error: "not_found" };
    let result = row;
    // Tiket selesai = alert ikut ditandai handled (hanya bila masih aktif).
    let handled = false;
    if (body.status === "resolved" && !row.endedAt && row.status === "active") {
      const [h] = await tx
        .update(alerts)
        .set({
          status: "handled",
          endedAt: now,
          endTimeSource: "operator",
          endTimeUncertaintySeconds: 0,
          handledBy: operatorName,
          handledAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(alerts.id, alertId),
            isNull(alerts.endedAt),
            eq(alerts.status, "active"),
          ),
        )
        .returning();
      if (h) {
        result = h;
        handled = true;
      }
    }
    await tx.insert(auditLog).values({
      userId: userId ?? null,
      action: "ticket_update",
      target: alertId,
      detail: sanitizeAuditDetail({
        actor: operatorName,
        status: body.status,
        priority: body.priority,
        dispatchTechnician: dispatch,
        handled,
      }),
    });
    dispatched = result;
    return { ok: true, data: toTicketRecord(result) };
  });

  // Setelah commit: kegagalan WhatsApp tidak boleh membatalkan pembaruan tiket.
  if (outcome.ok && dispatch && dispatched) {
    const row: AlertRow = dispatched;
    const name = (body.technicianName ?? "").trim();
    const notes = (body.notes ?? "").trim();
    try {
      await broadcastWhatsappMessage(
        `📋 *PENUGASAN TEKNISI NOC*\nAlert: ${row.type} (${row.severity})\nTeknisi: ${name}\nCatatan: ${notes}`,
        row.type,
      );
    } catch (error) {
      console.error(
        "Notifikasi penugasan teknisi gagal:",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }
  return outcome;
}

export interface CreateAlertInput {
  type: AlertKind;
  severity: AlertSeverity;
  title: string;
  message: string;
  routerId?: string | null;
  customerId?: string | null;
  locationName?: string | null;
  locationAddress?: string | null;
  locationOdp?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface WhatsappCount {
  sent: number;
  failed: number;
}

export type CreateAlertResult =
  | { ok: true; data: AlertItem; whatsapp: WhatsappCount }
  | { ok: false; error: "validation_error"; details: string[] };

const NO_WHATSAPP: WhatsappCount = { sent: 0, failed: 0 };

// Pesan memakai templat bawaan; waktu dalam WIB.
async function notifyAlertViaWhatsapp(row: AlertRow): Promise<WhatsappCount> {
  let router = "-";
  if (row.routerId) {
    const [r] = await db
      .select({ name: routers.name })
      .from(routers)
      .where(eq(routers.id, row.routerId))
      .limit(1);
    if (r?.name) router = r.name;
  }
  const message = renderWhatsappMessage(defaultWhatsappConfig.template, {
    severity: row.severity,
    kind: row.type,
    subject:
      row.locationName ?? row.title ?? row.locationOdp ?? row.locationAddress ?? "-",
    router,
    time: row.startedAt.toLocaleString("id-ID", { timeZone: "Asia/Jakarta" }) + " WIB",
    message: row.message ?? row.title ?? "-",
  });
  return broadcastWhatsappMessage(message, row.type);
}

export async function createAlert(
  input: CreateAlertInput,
): Promise<CreateAlertResult> {
  const errors: string[] = [];
  if (!(alertKinds as readonly string[]).includes(input?.type))
    errors.push("type tidak valid.");
  if (!(alertSeverities as readonly string[]).includes(input?.severity))
    errors.push("severity tidak valid.");
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const message = typeof input?.message === "string" ? input.message.trim() : "";
  if (!title) errors.push("title wajib diisi.");
  if (!message) errors.push("message wajib diisi.");
  if (input?.routerId && !UUID.test(input.routerId))
    errors.push("routerId bukan UUID.");
  if (input?.customerId && !UUID.test(input.customerId))
    errors.push("customerId bukan UUID.");
  if (errors.length) return { ok: false, error: "validation_error", details: errors };

  const [row] = await db
    .insert(alerts)
    .values({
      type: input.type,
      severity: input.severity,
      title,
      message,
      routerId: input.routerId || null,
      customerId: input.customerId || null,
      locationName: input.locationName ?? null,
      locationAddress: input.locationAddress ?? null,
      locationOdp: input.locationOdp ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
    })
    .returning();

  let whatsapp = NO_WHATSAPP;
  if (row.severity === "critical" || row.severity === "warning") {
    try {
      whatsapp = await notifyAlertViaWhatsapp(row);
    } catch (error) {
      // Alert sudah tersimpan; notifikasi yang gagal tidak boleh menghilangkannya.
      console.error(
        "Notifikasi WhatsApp alert gagal:",
        error instanceof Error ? error.name : "UnknownError",
      );
    }
  }
  return { ok: true, data: toItem(row), whatsapp };
}

export type NotifyResult =
  | { ok: true; sent: number; failed: number }
  | { ok: false; error: "not_found" };

// Kirim ulang/manual notifikasi untuk alert nyata, apa pun keparahannya.
export async function notifyAlertWhatsapp(alertId: string): Promise<NotifyResult> {
  if (!UUID.test(alertId)) return { ok: false, error: "not_found" };
  const [row] = await db
    .select()
    .from(alerts)
    .where(eq(alerts.id, alertId))
    .limit(1);
  if (!row) return { ok: false, error: "not_found" };
  const { sent, failed } = await notifyAlertViaWhatsapp(row);
  return { ok: true, sent, failed };
}
