"use client";

import { CircleCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  anomalyRules,
  describeAnomaly,
  isActive,
  type Anomaly,
} from "@/lib/dashboard/anomalies";
import { formatAlertTime } from "@/lib/dashboard/alerts";
import {
  getAnomalyTroubleshootingSteps,
  type ReviewedEntry,
} from "@/lib/dashboard/anomaly-detail-logic";
import { formatDbm, formatElapsed } from "@/lib/dashboard/format";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { AnomalySubject, type SubjectLookup } from "./anomaly-subject";
import { useNowSeconds } from "@/lib/dashboard/use-now";
import { RunningDuration } from "./running-duration";
import { SeverityBadge } from "./status-badge";

function measuredText(anomaly: Anomaly) {
  if (anomaly.kind === "offline" || anomaly.measured === null) return "—";
  if (anomaly.kind === "optical") return formatDbm(anomaly.measured);
  const unit = anomaly.kind === "port" ? "error/menit" : "%";
  return `${anomaly.measured}${anomaly.kind === "port" ? " " : ""}${unit}`;
}

// Rincian satu anomali: apa yang terukur, kemungkinan penyebab, langkah
// penanganan, dan penandaan "ditinjau" (disimpan lokal untuk sementara).
export function AnomalyDetailDialog({
  anomaly,
  lookup,
  review,
  onMarkReviewed,
  onClose,
}: {
  anomaly: Anomaly | null;
  lookup: SubjectLookup;
  review: ReviewedEntry | null;
  onMarkReviewed: (anomaly: Anomaly) => void;
  onClose: () => void;
}) {
  return (
    <Dialog open={anomaly !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-testid="anomaly-detail-dialog"
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl"
      >
        {anomaly && (
          <DetailBody
            a={anomaly}
            lookup={lookup}
            review={review}
            onMarkReviewed={onMarkReviewed}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DetailBody({
  a,
  lookup,
  review,
  onMarkReviewed,
}: {
  a: Anomaly;
  lookup: SubjectLookup;
  review: ReviewedEntry | null;
  onMarkReviewed: (anomaly: Anomaly) => void;
}) {
  const guide = getAnomalyTroubleshootingSteps(a);
  const rule = anomalyRules.find((r) => r.kind === a.kind)!;
  const now = useNowSeconds();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Rincian Deteksi Anomali</DialogTitle>
        <DialogDescription>{describeAnomaly(a)}</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{incidentLabels[a.kind]}</span>
          <SeverityBadge severity={a.severity} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="text-muted-foreground">Subjek terdampak</dt>
          <dd>
            <AnomalySubject anomaly={a} lookup={lookup} />
          </dd>
          <dt className="text-muted-foreground">Terukur</dt>
          <dd className="tabular-nums">{measuredText(a)}</dd>
          <dt className="text-muted-foreground">Ambang batas</dt>
          <dd>{rule.limit}</dd>
          <dt className="text-muted-foreground">Mulai</dt>
          <dd className="tabular-nums">{formatAlertTime(a.startedAt, now)}</dd>
          {isActive(a) ? (
            <>
              <dt className="text-muted-foreground">Durasi</dt>
              <dd>
                <RunningDuration
                  startedAt={a.startedAt}
                  testId="anomaly-detail-duration"
                />
              </dd>
            </>
          ) : (
            <>
              <dt className="text-muted-foreground">Selesai</dt>
              <dd className="tabular-nums">
                {formatAlertTime(a.endedAt!, now)} (selama{" "}
                {formatElapsed(a.endedAt! - a.startedAt)})
              </dd>
            </>
          )}
        </dl>
        <section aria-labelledby="anomaly-hypothesis">
          <h3 id="anomaly-hypothesis" className="font-medium">
            Hipotesis akar masalah
          </h3>
          <p className="text-muted-foreground">{guide.rootCauseHypothesis}</p>
        </section>
        <section aria-labelledby="anomaly-steps">
          <h3 id="anomaly-steps" className="font-medium">
            Panduan solusi teknis
          </h3>
          <ol className="list-decimal pl-5 text-muted-foreground">
            {guide.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>
        {guide.cliHelp && (
          <section aria-labelledby="anomaly-cli">
            <h3 id="anomaly-cli" className="font-medium">
              Perintah CLI rekomendasi
            </h3>
            <code
              className="mt-1 block rounded-md bg-muted px-3 py-2 font-mono text-xs"
              data-testid="anomaly-detail-cli"
            >
              {guide.cliHelp}
            </code>
          </section>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="font-medium">Status penanganan:</span>
          {review ? (
            <Badge
              variant="secondary"
              className="gap-1.5"
              data-testid="anomaly-detail-reviewed"
            >
              <CircleCheck className="size-3.5" aria-hidden="true" />
              Ditinjau oleh {review.operator}
            </Badge>
          ) : (
            <Button
              type="button"
              size="sm"
              data-testid="mark-anomaly-handled-btn"
              onClick={() => onMarkReviewed(a)}
            >
              Tandai Telah Ditinjau
            </Button>
          )}
        </div>
      </div>
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" data-testid="anomaly-detail-close">
            Tutup
          </Button>
        </DialogClose>
      </DialogFooter>
    </>
  );
}
