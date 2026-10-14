import { readJson, withApiPermission, withApiSession } from "@/lib/api";
import { withAudit } from "@/lib/audit-middleware";
import {
  enqueueChangeWifi,
  enqueueDiagnosticTask,
  listCpeDiagnosticTasks,
} from "@/services/cpe.service";
import {
  changeWifiSchema,
  createDiagnosticTaskSchema,
  listCpeTasksParamsSchema,
} from "@/validators/cpe";

export const runtime = "nodejs";

export function GET(request: Request) {
  return withApiSession(request, async () => {
    const url = new URL(request.url);
    const parsed = listCpeTasksParamsSchema.parse(
      Object.fromEntries(url.searchParams.entries()),
    );
    const data = await listCpeDiagnosticTasks(parsed);
    return Response.json({ data });
  });
}

export function POST(request: Request) {
  const audit = withAudit({
    action: "cpe-changed",
    getTarget: () => "/api/cpe/tasks",
  });
  return withApiPermission(
    request,
    { cpe: ["manage"] },
    audit(request, async (session) => {
      const body = await readJson(request);

      // Cek apakah request berupa changeWifi atau diagnostic task
      if (body && typeof body === "object" && "ssid" in body) {
        const input = changeWifiSchema.parse(body);
        await enqueueChangeWifi(input, session.user.id);
        return Response.json(
          { message: "Perintah perubahan WiFi telah masuk antrean." },
          { status: 202 },
        );
      }

      const input = createDiagnosticTaskSchema.parse(body);
      const task = await enqueueDiagnosticTask(input, session.user.id);
      return Response.json(
        {
          message: `Tugas diagnostik ${input.action} telah dibuat.`,
          data: task,
        },
        { status: 201 },
      );
    }),
  );
}
