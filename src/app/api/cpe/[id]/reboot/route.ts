import { withApiPermission } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import { enqueueDiagnosticTask } from "@/services/cpe.service";

export const runtime = "nodejs";

export function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let target = "";
  const audit = withAudit({
    action: "cpe-changed",
    getTarget: () => target || new URL(request.url).pathname,
  });

  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async (session) => {
      const { id } = await params;
      target = `/api/cpe/${id}/reboot`;
      const task = await enqueueDiagnosticTask(
        { customerId: id, action: "reboot_device", parameters: {} },
        session.user.id,
      );

      const ok =
        task.status === "success" ||
        task.status === "pending" ||
        task.status === "queued";
      return Response.json(
        {
          ok,
          message: ok
            ? "Perintah reboot berhasil dikirim ke GenieACS."
            : (task.payload?.errorReason ??
              "GenieACS gagal menjalankan perintah reboot."),
          data: task,
        },
        { status: ok ? 200 : 400 },
      );
    }),
  );
}
