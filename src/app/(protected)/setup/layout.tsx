import { AppShell } from "@/components/dashboard/app-shell";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { hasConnectedDevice } from "@/services/devices.service";

export default async function SetupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requireSession();
  // Menu dikunci selama mode live belum punya perangkat terhubung.
  const locked =
    env.DASHBOARD_DATA === "live" && !(await hasConnectedDevice());
  return (
    <AppShell user={{ email: user.email }} locked={locked}>
      <div className="mx-auto max-w-3xl py-4 sm:py-8">{children}</div>
    </AppShell>
  );
}
