import { CheckCircle2, Cpu, HardDrive, Network, Server } from "lucide-react";
import {
  CPU_WARNING_THRESHOLD,
  summarizeRouterResources,
  type MockRouterDetail,
} from "@/lib/dashboard/routers";
import { MetricCard } from "./metric-card";

// Empat kartu ringkasan resource semua router (hanya router aktif untuk CPU/RAM).
export function RouterResourceCards({ routers }: { routers: readonly MockRouterDetail[] }) {
  const s = summarizeRouterResources(routers);
  const hot = s.warningRouters > 0;

  return (
    <section
      aria-label="Ringkasan Resource Router"
      className="mb-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <MetricCard
        label="Kondisi Router"
        value={`${s.activeRouters}/${s.totalRouters} Aktif`}
        hint={
          s.warningRouters > 0
            ? `${s.warningRouters} router waspada · ${s.offlineRouters} terputus`
            : `${s.offlineRouters} terputus`
        }
        Icon={s.offlineRouters > 0 ? Server : CheckCircle2}
        tone={s.offlineRouters > 0 ? "danger" : hot ? "warning" : "success"}
      />
      <MetricCard
        label="Beban CPU Rata-rata"
        value={`${s.avgCpuLoad}%`}
        hint={
          s.peakCpuLoad
            ? `Puncak ${s.peakCpuLoad.value}% di ${s.peakCpuLoad.routerName}`
            : "Belum ada router aktif"
        }
        Icon={Cpu}
        tone={hot ? "warning" : "neutral"}
      >
        {hot && (
          <p className="mt-1 text-xs font-medium text-warning">
            Peringatan: {s.warningRouters} router CPU &gt; {CPU_WARNING_THRESHOLD}%
          </p>
        )}
      </MetricCard>
      <MetricCard
        label="Memori Rata-rata"
        value={`${s.avgMemoryUsage}%`}
        hint="Alokasi RAM router aktif"
        Icon={HardDrive}
      />
      <MetricCard
        label="Simple Queue & PPPoE"
        value={`${s.totalQueues} Queue`}
        hint={`${s.totalPppoe} sesi PPPoE`}
        Icon={Network}
      />
    </section>
  );
}
