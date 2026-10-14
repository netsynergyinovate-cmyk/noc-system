import { and, eq, ilike, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auditLog } from "../db/schema/audit-log";

export interface AuditQueryOptions {
  limit?: number;
  before?: Date;
  action?: string;
  userId?: string;
  q?: string;
}

// `before`: epoch (ms) atau string ISO. Angka murni dibaca sebagai epoch.
const beforeSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) =>
    /^\d+$/.test(value) ? new Date(Number(value)) : new Date(value),
  )
  .refine((date) => !Number.isNaN(date.getTime()), "Invalid date.");

const text = (max: number) => z.string().trim().min(1).max(max);

export const auditQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(500).default(50),
    before: beforeSchema.optional(),
    action: text(100).optional(),
    userId: text(200).optional(),
    q: text(200).optional(),
  })
  .strict();

// Parameter kosong (`?q=`) dianggap tidak ada; kunci asing ditolak oleh schema.
export function parseAuditQuery(params: URLSearchParams): AuditQueryOptions {
  const raw: Record<string, string> = {};
  for (const [key, value] of params) if (value.trim() !== "") raw[key] = value;
  return auditQuerySchema.parse(raw);
}

export function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

export function buildAuditConditions({
  before,
  action,
  userId,
  q,
}: AuditQueryOptions): SQL[] {
  const conditions: SQL[] = [];
  if (before) conditions.push(lt(auditLog.createdAt, before));
  if (action) conditions.push(eq(auditLog.action, action));
  if (userId) conditions.push(eq(auditLog.userId, userId));
  if (q) {
    const pattern = `%${escapeLike(q)}%`;
    const search = or(
      ilike(auditLog.target, pattern),
      ilike(auditLog.action, pattern),
    );
    if (search) conditions.push(search);
  }
  return conditions;
}

export function auditWhere(options: AuditQueryOptions) {
  const conditions = buildAuditConditions(options);
  return conditions.length ? and(...conditions) : undefined;
}

export function clampAuditLimit(limit = 50, max = 500) {
  return Math.min(Math.max(Math.trunc(limit) || 50, 1), max);
}
