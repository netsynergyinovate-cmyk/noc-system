import { Radio, RefreshCw, UserCheck } from "lucide-react";
import { cn } from "cn";
import {
  describeTimeSource,
  formatAlertTime,
  type ActiveAlert,
  type AlertEndSource,
  type ResolvedAlert,
} from "@/lib/dashboard/alerts";

const icons = { event: Radio, poll: RefreshCw, operator: UserCheck } as const;

// Satu waktu sampai detik, dengan penanda dari mana waktu itu berasal.
// Penandanya ditulis (ikon dan teks), dan penjelasan lengkapnya ada di tooltip
// serta untuk pembaca layar. Waktu mulai dan waktu selesai berbentuk sama;
// penandanya diberi atribut berbeda (data-time-source dan data-end-time-source)
// supaya keduanya bisa dibedakan di satu baris.
function SourcedTime({
  seconds,
  source,
  uncertaintySeconds,
  handledBy,
  moment,
  now,
  timeTestId,
  compact = false,
}: {
  seconds: number;
  source: AlertEndSource;
  uncertaintySeconds: number;
  // Hanya untuk waktu selesai yang berasal dari petugas.
  handledBy?: string | null;
  moment: "start" | "end";
  now: number;
  timeTestId?: string;
  // Hanya ikon penanda yang terlihat; teks tetap ada untuk pembaca layar dan tooltip.
  compact?: boolean;
}) {
  const description = describeTimeSource(
    {
      timeSource: source,
      timeUncertaintySeconds: uncertaintySeconds,
      handledBy,
    },
    moment,
  );
  const Icon = icons[source];
  return (
    <span className="inline-flex flex-col">
      <time
        dateTime={new Date(seconds * 1000).toISOString()}
        data-testid={timeTestId}
        className="font-medium tabular-nums"
      >
        {formatAlertTime(seconds, now)}
      </time>
      <span
        title={description.long}
        data-time-source={moment === "start" ? source : undefined}
        data-end-time-source={moment === "end" ? source : undefined}
        className={cn(
          "inline-flex items-center gap-1 text-xs text-muted-foreground",
          // Nama petugas bisa panjang (alamat email): boleh turun ke baris
          // berikutnya daripada melebarkan kolom.
          source === "operator" &&
            "max-w-56 whitespace-normal [overflow-wrap:anywhere]",
        )}
      >
        <Icon className="size-3 shrink-0" aria-hidden="true" />
        {compact ? <span className="sr-only">{description.short}</span> : description.short}
        <span className="sr-only">. {description.long}</span>
      </span>
    </span>
  );
}

// Waktu mulai alert sampai detik, dengan penanda dari mana waktu itu berasal.
export function AlertTime({
  alert,
  now,
  compact,
}: {
  alert: Pick<
    ActiveAlert,
    "startedAt" | "timeSource" | "timeUncertaintySeconds"
  >;
  now: number;
  compact?: boolean;
}) {
  return (
    <SourcedTime
      seconds={alert.startedAt}
      source={alert.timeSource}
      uncertaintySeconds={alert.timeUncertaintySeconds}
      moment="start"
      now={now}
      compact={compact}
    />
  );
}

// Waktu selesai alert sampai detik. Ketelitiannya sendiri: pulihnya bisa dicatat
// router (tepat) padahal mulainya hanya ketahuan dari polling, atau sebaliknya.
// Bila petugas menutup alert lebih dulu, penandanya menyebut namanya.
export function AlertEndTime({
  alert,
  now,
}: {
  alert: Pick<
    ResolvedAlert,
    "endedAt" | "endTimeSource" | "endTimeUncertaintySeconds" | "handledBy"
  >;
  now: number;
}) {
  return (
    <SourcedTime
      seconds={alert.endedAt}
      source={alert.endTimeSource}
      uncertaintySeconds={alert.endTimeUncertaintySeconds}
      handledBy={alert.handledBy}
      moment="end"
      now={now}
      timeTestId="resolved-ended-at"
    />
  );
}
