import { NextResponse } from "next/server";
import { withApiPermission, readJson, ApiError } from "@/lib/api";
import { env } from "@/lib/env";
import {
  defaultPortFor,
  parseTarget,
  testDeviceConnection,
} from "@/services/device-connection-tester";
import { testBillingConnectionSchema } from "@/validators/devices";

export const runtime = "nodejs";

// Membuat SERVER menghubungi host billing: wajib billing:manage, diperiksa
// sebelum body dibaca dan sebelum ada koneksi keluar. Body boleh kosong:
// field yang tidak diisi jatuh ke BILLING_URL/USERNAME/PASSWORD di env.
export const POST = (request: Request) =>
  withApiPermission(request, { billing: ["manage"] }, async () => {
    const empty = (await request.clone().text()).trim() === "";
    const parsed = testBillingConnectionSchema.safeParse(
      empty ? {} : await readJson(request),
    );
    if (!parsed.success) {
      throw new ApiError(422, "VALIDATION_ERROR", "Check the supplied fields.");
    }
    const input = parsed.data;

    let host = input.host;
    let port = input.port;
    let useTls = input.useTls;
    if (!host && env.BILLING_URL) {
      // BILLING_URL berupa URL penuh (boleh ber-path); uji hanya host/port/skema-nya.
      const u = new URL(env.BILLING_URL);
      host = u.hostname;
      port ??= u.port ? Number(u.port) : undefined;
      useTls ??= u.protocol === "https:";
    }
    if (!host) {
      throw new ApiError(
        422,
        "VALIDATION_ERROR",
        "Isi host billing atau set BILLING_URL.",
      );
    }

    const target = parseTarget(host);
    const tls = target?.useTls ?? useTls ?? port === 443;
    const result = await testDeviceConnection({
      type: "billing",
      host,
      port: port ?? target?.port ?? defaultPortFor("billing", tls),
      username: input.username ?? env.BILLING_USERNAME ?? "",
      password: input.password ?? env.BILLING_PASSWORD,
      mode: input.mode,
      useTls,
    });
    return NextResponse.json({ success: true, data: result });
  });
