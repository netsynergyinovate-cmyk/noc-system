import "server-only";
import { and, asc, desc, eq, gte, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { whatsappLogs, whatsappRecipients } from "@/db/schema";
import {
  dispatchGateway,
  formatGatewayPayload,
} from "@/lib/dashboard/whatsapp-gateway";
import { retryRows } from "@/lib/dashboard/whatsapp-retry";
import type { WaProvider } from "@/lib/dashboard/whatsapp";
import { normalizeTarget, summarizeLogCounts } from "@/validators/whatsapp";

export interface SendWhatsappParams {
  target: string;
  message: string;
  recipientName?: string;
  alertKind?: string;
  recipientId?: string;
  provider?: WaProvider;
  gatewayUrl?: string;
  apiKey?: string;
}

// ponytail: nomor uji 628000000000 selalu disimulasikan; ganti dengan config bila perlu banyak.
const TEST_TARGET = "628000000000";

export async function sendWhatsappMessage(
  params: SendWhatsappParams,
): Promise<{ ok: boolean; logId: string; error?: string }> {
  const [log] = await db
    .insert(whatsappLogs)
    .values({
      recipientId: params.recipientId ?? null,
      recipientTarget: params.target,
      recipientName: params.recipientName ?? params.target,
      message: params.message,
      alertKind: params.alertKind ?? null,
      status: "pending",
    })
    .returning({ id: whatsappLogs.id });

  const apiKey = params.apiKey ?? process.env.WHATSAPP_API_KEY ?? "";
  let result: { ok: boolean; error?: string };
  if (!apiKey || params.target === TEST_TARGET) {
    await new Promise((r) => setTimeout(r, 50));
    result = { ok: true };
  } else {
    result = await dispatchGateway(
      formatGatewayPayload(
        params.provider ?? "fonnte",
        params.target,
        params.message,
        { apiKey, gatewayUrl: params.gatewayUrl },
      ),
    );
  }

  await db
    .update(whatsappLogs)
    .set(
      result.ok
        ? { status: "sent", sentAt: new Date(), error: null }
        : { status: "failed", error: result.error ?? "Gagal mengirim." },
    )
    .where(eq(whatsappLogs.id, log.id));

  return { ok: result.ok, logId: log.id, error: result.error };
}

export interface SendLogEntry {
  logId: string;
  target: string;
  recipientName: string;
  ok: boolean;
  error?: string;
}

export type SendRequestResult =
  | { kind: "invalid"; message: string }
  | { kind: "broadcast"; totalSent: number; totalFailed: number; logs: SendLogEntry[] }
  | { kind: "single"; ok: boolean; logId: string; target: string; error?: string };

// Satu pintu untuk /api/whatsapp/send: broadcast ke penerima aktif, atau satu target.
// Dikirim berurutan agar tidak membanjiri gateway; setiap percobaan tetap tercatat di whatsapp_logs.
export async function sendWhatsappRequest(input: {
  message: string;
  target?: string;
  recipientId?: string;
  alertKind?: string;
  broadcast?: boolean;
}): Promise<SendRequestResult> {
  if (input.broadcast) {
    const recipients = await db
      .select()
      .from(whatsappRecipients)
      .where(eq(whatsappRecipients.isActive, true));
    const logs: SendLogEntry[] = [];
    for (const r of recipients) {
      const res = await sendWhatsappMessage({
        target: r.target,
        message: input.message,
        recipientName: r.name,
        recipientId: r.id,
        alertKind: input.alertKind,
      });
      logs.push({ logId: res.logId, target: r.target, recipientName: r.name, ok: res.ok, error: res.error });
    }
    const totalSent = logs.filter((l) => l.ok).length;
    return { kind: "broadcast", totalSent, totalFailed: logs.length - totalSent, logs };
  }

  let target = input.target?.trim();
  let recipientName: string | undefined;
  if (input.recipientId) {
    const [r] = await db
      .select()
      .from(whatsappRecipients)
      .where(eq(whatsappRecipients.id, input.recipientId));
    if (!r) return { kind: "invalid", message: "Penerima tidak ditemukan." };
    target ??= r.target;
    recipientName = r.name;
  }
  const normalized = target
    ? normalizeTarget(target, "individual") || normalizeTarget(target, "group")
    : null;
  if (!normalized) return { kind: "invalid", message: "Nomor telepon atau ID grup tidak valid." };
  const res = await sendWhatsappMessage({
    target: normalized,
    message: input.message,
    recipientName,
    recipientId: input.recipientId,
    alertKind: input.alertKind,
  });
  return { kind: "single", ok: res.ok, logId: res.logId, target: normalized, error: res.error };
}

const RETRY_WINDOW_MS = 60 * 60 * 1000;

// Kirim ulang log gagal (maks. N terlama dalam 1 jam terakhir); baris yang sama diperbarui, tidak dibuat baru.
export async function retryFailedWhatsappLogs(params: { maxRetries?: number } = {}) {
  const limit = Math.min(Math.max(params.maxRetries ?? 10, 1), 10);
  const rows = await db
    .select({
      id: whatsappLogs.id,
      recipientTarget: whatsappLogs.recipientTarget,
      message: whatsappLogs.message,
    })
    .from(whatsappLogs)
    .where(
      and(
        eq(whatsappLogs.status, "failed"),
        gte(whatsappLogs.createdAt, new Date(Date.now() - RETRY_WINDOW_MS)),
      ),
    )
    .orderBy(asc(whatsappLogs.createdAt))
    .limit(limit);
  const apiKey = process.env.WHATSAPP_API_KEY ?? "";
  return retryRows(
    rows,
    async (row) => {
      if (!apiKey || row.recipientTarget === TEST_TARGET) return { ok: true };
      return dispatchGateway(
        formatGatewayPayload("fonnte", row.recipientTarget, row.message, { apiKey }),
      );
    },
    async (id, result) => {
      await db
        .update(whatsappLogs)
        .set(
          result.ok
            ? { status: "sent", sentAt: new Date(), error: null }
            : { error: result.error ?? "Gagal mengirim." },
        )
        .where(eq(whatsappLogs.id, id));
    },
  );
}

export interface AlertEventInput {
  kind: string;
  severity: "critical" | "warning" | "info";
  subject: string;
  message?: string;
}

// ponytail: template tetap; ambil dari pengaturan bila sudah disimpan di DB.
// Mengirim ke semua penerima aktif; satu kegagalan tidak menghentikan yang lain.
export async function triggerAlertWhatsappNotification(
  event: AlertEventInput,
  minSeverity: "critical" | "warning" = "warning",
) {
  if (event.severity === "info" || (event.severity === "warning" && minSeverity === "critical"))
    return { sent: 0, failed: 0 };
  const recipients = await db
    .select()
    .from(whatsappRecipients)
    .where(eq(whatsappRecipients.isActive, true));
  const label = event.severity === "critical" ? "KRITIS" : "PERINGATAN";
  const message = `${label} ${event.kind}: ${event.subject}${event.message ? ` - ${event.message}` : ""}`;
  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendWhatsappMessage({
        target: r.target,
        message,
        recipientName: r.name,
        recipientId: r.id,
        alertKind: event.kind,
      }),
    ),
  );
  const sent = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  return { sent, failed: results.length - sent };
}

// Kirim satu pesan ke semua penerima aktif; satu kegagalan tidak menghentikan yang lain.
// Setiap percobaan tercatat di whatsapp_logs oleh sendWhatsappMessage.
export async function broadcastWhatsappMessage(message: string, alertKind?: string) {
  const recipients = await db
    .select()
    .from(whatsappRecipients)
    .where(eq(whatsappRecipients.isActive, true));
  const results = await Promise.allSettled(
    recipients.map((r) =>
      sendWhatsappMessage({
        target: r.target,
        message,
        recipientName: r.name,
        recipientId: r.id,
        alertKind,
      }),
    ),
  );
  const sent = results.filter((r) => r.status === "fulfilled" && r.value.ok).length;
  return { sent, failed: results.length - sent };
}

export async function listWhatsappLogs(
  params: {
    limit?: number;
    offset?: number;
    status?: string;
    alertKind?: string;
    q?: string;
  } = {},
) {
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
  const offset = Math.max(params.offset ?? 0, 0);
  const q = params.q?.trim();
  const like = q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : null;
  const where = and(
    params.status
      ? eq(whatsappLogs.status, params.status as "pending" | "sent" | "failed")
      : undefined,
    params.alertKind ? eq(whatsappLogs.alertKind, params.alertKind) : undefined,
    like
      ? or(
          ilike(whatsappLogs.message, like),
          ilike(whatsappLogs.recipientTarget, like),
          ilike(whatsappLogs.recipientName, like),
        )
      : undefined,
  );
  const [logs, [count]] = await Promise.all([
    db
      .select()
      .from(whatsappLogs)
      .where(where)
      .orderBy(desc(whatsappLogs.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: sql<number>`count(*)::int` })
      .from(whatsappLogs)
      .where(where),
  ]);
  return { logs, total: count?.total ?? 0 };
}

export async function getWhatsappLogSummary() {
  const rows = await db
    .select({ status: whatsappLogs.status, n: sql<number>`count(*)::int` })
    .from(whatsappLogs)
    .groupBy(whatsappLogs.status);
  const n = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
  return summarizeLogCounts({ sent: n("sent"), failed: n("failed"), pending: n("pending") });
}


export class RecipientError extends Error {
  constructor(
    readonly status: 404 | 409 | 422,
    message: string,
  ) {
    super(message);
  }
}

type RecipientType = "individual" | "group";

function normalizedOrThrow(target: string, type: RecipientType) {
  const t = normalizeTarget(target, type);
  if (!t)
    throw new RecipientError(
      422,
      type === "group" ? "ID grup tidak valid." : "Nomor telepon tidak valid.",
    );
  return t;
}

// 23505 = unique_violation (target unik); drizzle bisa membungkusnya di cause.
function rethrowDuplicate(error: unknown): never {
  const e = error as { code?: string; cause?: { code?: string } };
  if (e?.code === "23505" || e?.cause?.code === "23505")
    throw new RecipientError(409, "Target sudah terdaftar.");
  throw error;
}

export function listRecipients() {
  return db.select().from(whatsappRecipients).orderBy(asc(whatsappRecipients.name));
}

export async function createRecipient(input: {
  name: string;
  target: string;
  type: RecipientType;
  isActive?: boolean;
}) {
  const target = normalizedOrThrow(input.target, input.type);
  try {
    const [row] = await db
      .insert(whatsappRecipients)
      .values({ name: input.name, target, type: input.type, isActive: input.isActive ?? true })
      .returning();
    return row;
  } catch (error) {
    rethrowDuplicate(error);
  }
}

export async function updateRecipient(
  id: string,
  input: Partial<{ name: string; target: string; type: RecipientType; isActive: boolean }>,
) {
  const [current] = await db
    .select()
    .from(whatsappRecipients)
    .where(eq(whatsappRecipients.id, id));
  if (!current) throw new RecipientError(404, "Penerima tidak ditemukan.");
  const type = input.type ?? current.type;
  const set: Partial<typeof whatsappRecipients.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.isActive !== undefined) set.isActive = input.isActive;
  if (input.type !== undefined) set.type = input.type;
  // Target atau tipe berubah: validasi ulang pasangan target+tipe.
  if (input.target !== undefined || input.type !== undefined)
    set.target = normalizedOrThrow(input.target ?? current.target, type);
  try {
    const [row] = await db
      .update(whatsappRecipients)
      .set(set)
      .where(eq(whatsappRecipients.id, id))
      .returning();
    return row;
  } catch (error) {
    rethrowDuplicate(error);
  }
}

export async function deleteRecipient(id: string) {
  const rows = await db
    .delete(whatsappRecipients)
    .where(eq(whatsappRecipients.id, id))
    .returning({ id: whatsappRecipients.id });
  return rows.length > 0;
}

export function toggleRecipientActive(id: string, isActive: boolean) {
  return updateRecipient(id, { isActive });
}

