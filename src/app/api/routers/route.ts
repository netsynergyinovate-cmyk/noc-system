import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { listRoutersWithStatus } from "@/services/devices.service";
import { createRouter } from "@/services/routers.service";
import { createRouterSchema } from "@/validators/routers";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () =>
    Response.json({ data: await listRoutersWithStatus() }),
  );
}

// Menambah router mengubah data jaringan, jadi hanya peran dengan
// router:manage. Izin diperiksa sebelum isi permintaan dibaca: akun hanya-lihat
// mendapat 403 bahkan untuk body yang rusak.
export function POST(request: Request) {
  const audit = withAudit({
    action: "router-added",
    getTarget: (_req, res) => res.headers.get("Location") ?? "/api/routers",
  });
  return withApiPermission(
    request,
    { router: ["manage"] },
    audit(request, async () => {
      const input = createRouterSchema.parse(await readJson(request));
      const router = await createRouter(input);
      return Response.json(
        { data: router },
        { status: 201, headers: { Location: `/api/routers/${router.id}` } },
      );
    }),
  );
}
