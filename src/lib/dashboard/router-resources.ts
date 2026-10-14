export type ResourceTone = "success" | "warning" | "destructive" | "muted";

export function getCpuStatus(
  cpuLoad: number,
  active = true,
): { tone: ResourceTone; label: string; isWarning: boolean } {
  if (!active) return { tone: "muted", label: "Offline", isWarning: false };
  if (cpuLoad > 95) return { tone: "destructive", label: "Kritis (>95%)", isWarning: true };
  if (cpuLoad > 80) return { tone: "warning", label: "Beban tinggi (>80%)", isWarning: true };
  return { tone: "success", label: "Normal", isWarning: false };
}

export function getMemoryStatus(memoryUsage: number, active = true): { tone: ResourceTone; label: string } {
  if (!active) return { tone: "muted", label: "Offline" };
  if (memoryUsage > 85) return { tone: "warning", label: "Hampir penuh" };
  return { tone: "success", label: "Tersedia" };
}

export function getUptimeStatus(uptime: string, active = true): { tone: "success" | "muted"; label: string } {
  if (!active || !uptime) return { tone: "muted", label: "Offline" };
  return { tone: "success", label: "Berjalan" };
}

export function getThermalStatus(temp?: number, active = true): { tone: ResourceTone; label: string } {
  if (!active) return { tone: "muted", label: "Offline" };
  if (temp !== undefined && temp >= 65) return { tone: "destructive", label: "Panas kritis" };
  if (temp !== undefined && temp >= 50) return { tone: "warning", label: "Hangat" };
  if (temp !== undefined && temp > 0) return { tone: "success", label: "Normal" };
  return { tone: "muted", label: "Sensor tidak tersedia" };
}
