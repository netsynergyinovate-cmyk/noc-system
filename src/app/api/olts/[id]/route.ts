import { ApiError, readJson, withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { testOltConnection } from "@/services/device-connection.service";
import { deleteOlt, getOlt, getOltCredentials, updateOlt } from "@/services/devices.service";
import { oltIdSchema, updateOltSchema } from "@/validators/devices";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

const notFound = () => new ApiError(404, "NOT_FOUND", "OLT tidak ditemukan.");
const target = (id: string) => `/api/olts/${id}`;

export function GET(request: Request, context: Context) {
  return withApiSession(request, async () => {
    const olt = await getOlt(oltIdSchema.parse((await context.params).id));
    if (!olt) throw notFound();
    return Response.json({ data: olt });
  });
}

// `?skipTest=1` melewati tes login (setup offline).
export async function PUT(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const audit = withAudit({ action: "olt-updated", getTarget: () => target(rawId) });
  return withApiPermission(request, { router: ["manage"] }, audit(request, async () => {
    const id = oltIdSchema.parse(rawId);
    const input = updateOltSchema.parse(await readJson(request));
    const current = await getOlt(id);
    const creds = current && (await getOltCredentials(id));
    if (!current || !creds) throw notFound();
    if (new URL(request.url).searchParams.get("skipTest") !== "1") {
      await testOltConnection({
        host: input.host ?? current.host,
        brand: input.brand ?? current.brand,
        driver: input.driver ?? current.driver,
        username: input.username ?? creds.username,
        password: input.password ?? creds.password,
      });
    }
    const olt = await updateOlt(id, input);
    if (!olt) throw notFound();
    return Response.json({ data: olt });
  }));
}

export async function DELETE(request: Request, context: Context) {
  const { id: rawId } = await context.params;
  const audit = withAudit({ action: "olt-deleted", getTarget: () => target(rawId) });
  return withApiPermission(request, { router: ["manage"] }, audit(request, async () => {
    if (!(await deleteOlt(oltIdSchema.parse(rawId)))) throw notFound();
    return new Response(null, { status: 204 });
  }));
}
