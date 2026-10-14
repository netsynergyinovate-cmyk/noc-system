import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { testOltConnection } from "@/services/device-connection.service";
import { createOlt, listDevices } from "@/services/devices.service";
import { createOltSchema } from "@/validators/devices";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const devices = await listDevices();
    return Response.json({ data: devices.olts });
  });
}

// Seperti POST /api/routers: izin diperiksa sebelum body dibaca.
export function POST(request: Request) {
  const audit = withAudit({
    action: "olt-added",
    getTarget: (_req, res) => res.headers.get("Location") ?? "/api/olts",
  });
  return withApiPermission(request, { router: ["manage"] }, audit(request, async () => {
    const input = createOltSchema.parse(await readJson(request));
    // `?skipTest=1` melewati tes login (setup offline).
    if (new URL(request.url).searchParams.get("skipTest") !== "1") {
      await testOltConnection(input);
    }
    const olt = await createOlt(input);
    return Response.json(
      { data: olt },
      { status: 201, headers: { Location: `/api/olts/${olt.id}` } },
    );
  }));
}
