import { ApiError, readJson, withApiPermission } from "@/lib/api";
import {
  deleteRecipient,
  RecipientError,
  updateRecipient,
} from "@/services/whatsapp.service";
import { recipientIdSchema, updateRecipientSchema } from "@/validators/whatsapp";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function PUT(request: Request, context: Context) {
  return withApiPermission(request, { threshold: ["manage"] }, async () => {
    const id = recipientIdSchema.parse((await context.params).id);
    const input = updateRecipientSchema.parse(await readJson(request));
    try {
      return Response.json({ data: await updateRecipient(id, input) });
    } catch (error) {
      if (error instanceof RecipientError)
        throw new ApiError(
          error.status,
          error.status === 404 ? "NOT_FOUND" : "VALIDATION_ERROR",
          error.message,
        );
      throw error;
    }
  });
}

export function DELETE(request: Request, context: Context) {
  return withApiPermission(request, { threshold: ["manage"] }, async () => {
    const id = recipientIdSchema.parse((await context.params).id);
    if (!(await deleteRecipient(id)))
      throw new ApiError(404, "NOT_FOUND", "Penerima tidak ditemukan.");
    return new Response(null, { status: 204 });
  });
}
