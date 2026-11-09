// Murni (tanpa impor server) agar bisa diuji langsung.
const SECRET_KEY = /pass|token|secret|api[-_]?key|auth|credential|cookie/i;
const SECRET_VALUE =
  /\bBearer\s+\S+|\b(?:sk|ghp|gho|ngpk|xox[bp]|AKIA)[-_][A-Za-z0-9_-]{8,}|\bAKIA[0-9A-Z]{12,}|:\/\/[^\s/:@]+:[^\s/@]+@|[A-Za-z0-9+/_-]{32,}/;
const MAX_DEPTH = 6;

export const REDACTED = "[REDACTED]";

function clean(value: unknown, depth: number): unknown {
  if (typeof value === "string")
    return SECRET_VALUE.test(value) ? REDACTED : value;
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return REDACTED;
  if (Array.isArray(value)) return value.map((v) => clean(v, depth + 1));
  return sanitizeAuditDetail(value as Record<string, unknown>, depth + 1);
}

export function sanitizeAuditDetail(
  detail: Record<string, unknown>,
  depth = 0,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail ?? {})) {
    if (key === "__proto__") continue;
    out[key] = SECRET_KEY.test(key) ? REDACTED : clean(value, depth);
  }
  return out;
}

export const isSuccessStatus = (status: number) =>
  status >= 200 && status < 300;

type Session = { user: { id: string } };
type Record_ = (
  userId: string,
  action: string,
  target: string,
  detail?: Record<string, unknown>,
) => Promise<unknown>;

// Inti withAudit tanpa dependensi server, agar kontraknya bisa diuji.
export function createWithAudit(record: Record_) {
  return ({
      action,
      getTarget,
      getDetail,
    }: {
      action: string;
      getTarget?: (req: Request, res: Response, session: Session) => string;
      getDetail?: (req: Request, res: Response) => Record<string, unknown>;
    }) =>
    <S extends Session>(
      request: Request,
      handler: (session: S) => Promise<Response>,
    ) =>
    async (session: S) => {
      const response = await handler(session);
      if (isSuccessStatus(response.status))
        await record(
          session.user.id,
          action,
          getTarget?.(request, response, session) ??
            new URL(request.url).pathname,
          { method: request.method, ...(getDetail?.(request, response) ?? {}) },
        );
      return response;
    };
}
