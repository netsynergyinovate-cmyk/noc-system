import { cn } from "cn";
import { formatDuration } from "@/lib/dashboard/format";
import {
  incidentEnd,
  incidentLabels,
  incidentSeverityLabels,
} from "@/lib/dashboard/incidents";
import type { Incident } from "@/lib/dashboard/types";

const timeFormat = new Intl.DateTimeFormat("id-ID", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayTimeFormat = new Intl.DateTimeFormat("id-ID", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// Warna hanya pelengkap: jenis, tingkat, dan waktu selalu ditulis.
const dotClass = {
  info: "bg-muted-foreground",
  warning: "bg-warning",
  critical: "bg-destructive",
} as const;

// Daftar teks dari penanda yang digambar di canvas grafik, supaya insiden juga
// bisa dibaca pembaca layar dan tidak bergantung pada warna.
export function IncidentList({
  incidents,
  now,
  multiDay,
}: {
  incidents: Incident[];
  now: number;
  // Tampilkan tanggal bila rentangnya lebih dari sehari.
  multiDay: boolean;
}) {
  const clock = multiDay ? dayTimeFormat : timeFormat;
  const at = (seconds: number) => clock.format(new Date(seconds * 1000));
  // Yang terbaru (dan yang masih berlangsung) di atas, karena daftar ini
  // tingginya dibatasi dan petugas paling perlu melihat kejadian terkini.
  const newestFirst = [...incidents].sort((a, b) => b.startedAt - a.startedAt);

  if (incidents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="incident-empty">
        Tidak ada insiden pada rentang ini.
      </p>
    );
  }
  return (
    <section aria-label="Insiden pada rentang ini">
      <h3 className="text-sm font-medium">
        Insiden pada rentang ini ({incidents.length})
      </h3>
      <ul
        className="mt-2 max-h-40 divide-y overflow-auto rounded-lg border text-sm"
        tabIndex={0}
        aria-label="Daftar insiden"
      >
        {newestFirst.map((incident) => {
          const ongoing = incident.endedAt === null;
          return (
            <li
              key={incident.id}
              data-testid="incident-item"
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2"
            >
              <span
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  dotClass[incident.severity],
                )}
                aria-hidden="true"
              />
              <span className="font-medium">
                {incidentLabels[incident.kind]}
              </span>
              <span className="text-xs text-muted-foreground">
                {incidentSeverityLabels[incident.severity]}
              </span>
              <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                {ongoing
                  ? `sejak ${at(incident.startedAt)}, masih berlangsung`
                  : `${at(incident.startedAt)} sampai ${at(incident.endedAt!)} (${formatDuration(incidentEnd(incident, now) - incident.startedAt)})`}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
