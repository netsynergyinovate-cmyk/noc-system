import { NextResponse } from "next/server";
import {
  ApiError,
  readJson,
  withApiPermission,
  withApiSession,
} from "@/lib/api";
import { alertKinds, alertSeverities } from "@/db/schema";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  createAlert,
  getAlertsList,
  type CreateAlertInput,
  type AlertListStatus,
} from "@/services/alerts.service";

export const runtime = "nodejs";

const STATUSES: readonly AlertListStatus[] = ["active", "resolved", "all"];

function intParam(
  params: URLSearchParams,
  name: string,
  min: number,
  max = Number.MAX_SAFE_INTEGER,
): number | undefined {
  const raw = params.get(name);
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max)
    throw new ApiError(400, "INVALID_QUERY", `Parameter ${name} tidak valid.`);
  return n;
}

// Membuat alert memicu broadcast WhatsApp, jadi butuh izin alert:handle (bukan sekadar login).
export const POST = (request: Request) =>
  withApiPermission(request, { alert: ["handle"] }, async () => {
    const raw = await readJson(request);
    const body =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};
    const str = (k: string) =>
      typeof body[k] === "string" ? (body[k] as string) : undefined;
    const num = (k: string) =>
      typeof body[k] === "number" ? (body[k] as number) : undefined;
    const result = await createAlert({
      type: body.type as CreateAlertInput["type"],
      severity: body.severity as CreateAlertInput["severity"],
      title: str("title") as string,
      message: str("message") as string,
      routerId: str("routerId"),
      customerId: str("customerId"),
      locationName: str("locationName"),
      locationAddress: str("locationAddress"),
      locationOdp: str("locationOdp"),
      latitude: num("latitude"),
      longitude: num("longitude"),
    });
    if (!result.ok)
      return NextResponse.json(
        { error: "validation_error", details: result.details },
        { status: 400 },
      );
    return NextResponse.json(
      { ok: true, data: result.data, notification: result.whatsapp },
      { status: 201 },
    );
  });

export const GET = (request: Request) =>
  withApiSession(request, async () => {
    const params = new URL(request.url).searchParams;

    const status = (params.get("status") || "all") as AlertListStatus;
    if (!STATUSES.includes(status))
      throw new ApiError(400, "INVALID_QUERY", "Parameter status tidak valid.");

    const type = params.get("type") || undefined;
    if (type && !(alertKinds as readonly string[]).includes(type))
      throw new ApiError(400, "INVALID_QUERY", "Parameter type tidak valid.");

    const severity = params.get("severity") || undefined;
    if (severity && !(alertSeverities as readonly string[]).includes(severity))
      throw new ApiError(
        400,
        "INVALID_QUERY",
        "Parameter severity tidak valid.",
      );

    const from = intParam(params, "from", 0);
    const to = intParam(params, "to", 0);
    const limit = intParam(params, "limit", 1, MAX_LIMIT) ?? DEFAULT_LIMIT;
    const offset = intParam(params, "offset", 0) ?? 0;

    const { items, total } = await getAlertsList({
      status,
      type,
      severity,
      from,
      to,
      limit,
      offset,
    });
    return NextResponse.json({
      data: items,
      meta: { total, status, limit, offset },
    });
  });
