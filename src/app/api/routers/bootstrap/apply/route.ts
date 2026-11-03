import { NextResponse } from "next/server";
import * as z from "zod";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { applyProvision, previewProvision } from "@/services/router-provision.service";
import { connectionSchema, failure, toConn } from "../_shared";

export const runtime = "nodejs";

const name = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

const bodySchema = z
  .object({
    connection: connectionSchema,
    dryRun: z.boolean().optional(),
    options: z
      .object({
        enableWww: z.boolean(),
        enableWwwSsl: z.boolean(),
        wwwSslCertificate: z.string().max(128).optional(),
        allowedAddress: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}(\/\d{1,2})?$/),
        restUser: name,
        restPassword: z.string().min(8).max(128),
        restGroup: name,
      })
      .strict(),
  })
  .strict();

const PLAN_ERRORS = /^(Sertifikat www-ssl wajib|Akun REST tidak boleh|Layanan .* tidak ditemukan)/;

// Body (berisi kata sandi) tidak pernah ikut audit: target hanya URL.
export const POST = (request: Request) => {
  const audit = withAudit({ action: "router-provisioned", getTarget: () => request.url });
  return withApiPermission(
    request,
    { router: ["manage"] },
    audit(request, async () => {
      const parsed = bodySchema.safeParse(await readJson(request));
      if (!parsed.success) throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
      const { connection, options, dryRun } = parsed.data;
      if (options.restUser === connection.username) {
        throw new ApiError(422, "VALIDATION_ERROR", "Akun REST tidak boleh sama dengan akun admin yang dipakai masuk");
      }
      const conn = toConn(connection);
      try {
        const data = dryRun ? await previewProvision(conn, options) : await applyProvision(conn, options);
        return NextResponse.json({ success: true, data });
      } catch (err) {
        const f = await failure(err, connection, conn);
        if (f) return NextResponse.json({ success: true, data: f });
        if (err instanceof Error && PLAN_ERRORS.test(err.message)) {
          throw new ApiError(422, "VALIDATION_ERROR", err.message);
        }
        throw err;
      }
    }),
  );
};
