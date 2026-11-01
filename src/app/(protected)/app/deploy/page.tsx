import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/session";
import { evaluateDeployAccess } from "@/lib/deploy/role-guard";
import { getDeployTarget, detectConnectionPath } from "@/services/deploy-targets.service";
import { DeployDashboard } from "@/components/dashboard/deploy-dashboard";

export const dynamic = "force-dynamic";

export default async function DeployPage() {
  const { user } = await requirePermission({ deploy: ["manage"] });
  const reqHeaders = await headers();
  const host = reqHeaders.get("x-forwarded-host") || reqHeaders.get("host");
  const checkReq = new Request(`http://${host || "localhost"}/app/deploy`, {
    headers: reqHeaders,
  });

  const guard = evaluateDeployAccess(checkReq, user.role);

  // Pada peran 'server', halaman tidak terdaftar dan mengembalikan 404
  if (guard.status === 404) {
    notFound();
  }

  // Jika diakses dari host non-loopback (mis. via LAN)
  if (guard.status === 403) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-destructive">
          <h1 className="text-xl font-bold">Akses Deploy Ditolak</h1>
          <p className="mt-2 text-sm">
            {guard.error ||
              "Halaman deploy hanya diizinkan dibuka melalui loopback localhost (127.0.0.1 / ::1)."}
          </p>
        </div>
      </div>
    );
  }

  const target = await getDeployTarget();
  let detection = null;

  if (target) {
    detection = await detectConnectionPath(target);
  }

  return <DeployDashboard initialTarget={target} initialDetection={detection} />;
}
