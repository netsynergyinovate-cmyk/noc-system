import { ApiError, readJson, withApiPermission } from "@/lib/api";
import { getOnu, mapOnuToCustomer } from "@/services/devices.service";
import { mapOnuSchema, oltIdSchema } from "@/validators/devices";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

// Audit `onu-mapped`/`onu-unmapped` ditulis service (satu transaksi dengan update).
async function handle(request: Request, context: Context) {
  return withApiPermission(request, { cpe: ["manage"] }, async (session) => {
    const id = oltIdSchema.parse((await context.params).id);
    const { customerId } = mapOnuSchema.parse(await readJson(request));
    const data = await mapOnuToCustomer(id, customerId, session.user.id);
    if (!data) throw new ApiError(404, "NOT_FOUND", "ONU tidak ditemukan.");
    return Response.json({ data });
  });
}

export const POST = handle;
export const PUT = handle;

export function GET(request: Request, context: Context) {
  return withApiPermission(request, { cpe: ["manage"] }, async () => {
    const id = oltIdSchema.parse((await context.params).id);
    const data = await getOnu(id);
    if (!data) throw new ApiError(404, "NOT_FOUND", "ONU tidak ditemukan.");
    return Response.json({
      data: {
        onuId: data.id,
        oltId: data.oltId,
        oltName: data.oltName,
        ponIndex: data.ponIndex,
        onuIndex: data.onuIndex,
        customerId: data.customerId,
        customerName: data.customerName,
        pppoeUsername: data.pppoeUsername,
        serialNumber: data.serialNumber,
        status: data.status,
      },
    });
  });
}

export function DELETE(request: Request, context: Context) {
  return withApiPermission(request, { cpe: ["manage"] }, async (session) => {
    const id = oltIdSchema.parse((await context.params).id);
    const data = await mapOnuToCustomer(id, null, session.user.id);
    if (!data) throw new ApiError(404, "NOT_FOUND", "ONU tidak ditemukan.");
    return Response.json({ data });
  });
}
