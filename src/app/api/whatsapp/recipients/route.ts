import {
  ApiError,
  readJson,
  withApiPermission,
  withApiSession,
} from "@/lib/api";
import {
  createRecipient,
  listRecipients,
  RecipientError,
} from "@/services/whatsapp.service";
import { createRecipientSchema } from "@/validators/whatsapp";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({ data: await listRecipients() }),
  );
}

export function POST(request: Request) {
  return withApiPermission(request, { threshold: ["manage"] }, async () => {
    const input = createRecipientSchema.parse(await readJson(request));
    try {
      return Response.json(
        { data: await createRecipient(input) },
        { status: 201 },
      );
    } catch (error) {
      if (error instanceof RecipientError)
        throw new ApiError(error.status, "VALIDATION_ERROR", error.message);
      throw error;
    }
  });
}
