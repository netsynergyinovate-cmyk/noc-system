import "server-only";
import { createWithAudit } from "@/lib/audit-sanitize";
import { recordAudit } from "@/services/audit.service";

export function recordAuditSafe(
  userId: string | null | undefined,
  action: string,
  target: string,
  detail?: Record<string, unknown>,
) {
  return recordAudit({ userId, action, target, detail });
}

// Bungkus handler withApiSession/withApiPermission: respons 2xx dicatat otomatis.
export const withAudit = createWithAudit(recordAuditSafe);
