import type { Incident, IncidentKind, IncidentSeverity } from "./types";

export const incidentLabels: Record<IncidentKind, string> = {
  offline: "Pelanggan offline",
  optical: "Sinyal optik lemah",
  queue: "Jalur traffic penuh",
  cpu: "Beban router tinggi",
  port: "Error pada port",
};

export const incidentSeverityLabels: Record<IncidentSeverity, string> = {
  info: "Info",
  warning: "Peringatan",
  critical: "Kritis",
};

// Tingkat bawaan tiap jenis, sama dengan yang diberikan rule engine.
export const defaultSeverity: Record<IncidentKind, IncidentSeverity> = {
  offline: "warning",
  optical: "warning",
  queue: "critical",
  cpu: "critical",
  port: "warning",
};

// Gangguan yang sedang berlangsung dihitung sampai `now`.
export function incidentEnd(incident: Incident, now: number) {
  return incident.endedAt ?? now;
}

// Benar bila gangguan beririsan dengan jendela [from, to].
export function overlaps(incident: Incident, from: number, to: number) {
  return incident.startedAt <= to && incidentEnd(incident, to) >= from;
}

// Terlama lebih dulu, supaya daftar dan penanda berurutan sama dengan grafik.
export function sortIncidents(incidents: Incident[]) {
  return [...incidents].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
}

// "offline" tanpa pelanggan adalah gangguan tingkat router: backend tidak bisa
// membaca routernya. Label "Pelanggan offline" akan menyesatkan.
export function alertKindLabel(alert: { kind: IncidentKind; customerId: string | null }): string {
  return alert.kind === "offline" && alert.customerId === null
    ? "Router tidak terjangkau"
    : incidentLabels[alert.kind];
}
