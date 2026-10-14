import { withApiSession } from "@/lib/api";
import {
  getRealOptionalIntegrationsOverview,
  setOptionalIntegrationStatusOverride,
} from "@/services/optional-integrations.service";
import type { OptionalIntegrationStatus } from "@/lib/dashboard/optional-integrations";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const overview = await getRealOptionalIntegrationsOverview();

    return Response.json({
      data: overview,
    });
  });
}

export function POST(request: Request) {
  return withApiSession(request, async () => {
    let body: { id?: string; status?: OptionalIntegrationStatus } = {};
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json(
        { error: "Payload JSON tidak valid" },
        { status: 400 },
      );
    }

    if (!body.id || !body.status) {
      return Response.json(
        { error: "id dan status wajib diisi" },
        { status: 422 },
      );
    }

    setOptionalIntegrationStatusOverride(body.id, body.status);
    const updatedOverview = await getRealOptionalIntegrationsOverview();

    return Response.json({
      data: updatedOverview,
      message: `Status integrasi ${body.id} berhasil diperbarui menjadi ${body.status}.`,
    });
  });
}
