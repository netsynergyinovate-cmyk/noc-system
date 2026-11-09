"use client";

import { useState } from "react";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAlertStore } from "@/lib/dashboard/alert-store";
import {
  alertTicketPriorityLabels,
  alertTicketStatusLabels,
  createTicketResponseRecord,
  saveTicketResponse,
  validateTicketActionInput,
  type AlertTicketPriority,
  type AlertTicketResponseRecord,
  type AlertTicketStatus,
} from "@/lib/dashboard/alert-ticket-actions";
import type { ActiveAlert } from "@/lib/dashboard/alerts";
import { incidentLabels } from "@/lib/dashboard/incidents";
import { subjectLabel, useSubjectLookup } from "./anomaly-subject";

const statusChoices: AlertTicketStatus[] = [
  "in_progress",
  "resolved",
  "escalated",
];
const priorityChoices: AlertTicketPriority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

// Dialog tanggapan tiket. Isi form hidup di FormBody yang dipasang ulang untuk
// tiap alert (key), jadi tidak perlu efek untuk mengosongkan form.
export function AlertTicketDialog({
  alert,
  operator,
  now,
  onOpenChange,
  onSaved,
}: {
  alert: ActiveAlert | null;
  operator: string;
  now: number;
  onOpenChange: (open: boolean) => void;
  onSaved?: (record: AlertTicketResponseRecord) => void;
}) {
  return (
    <Dialog open={alert !== null} onOpenChange={onOpenChange}>
      {alert && (
        <DialogContent data-testid="alert-ticket-dialog" key={alert.id}>
          <FormBody
            alert={alert}
            operator={operator}
            now={now}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        </DialogContent>
      )}
    </Dialog>
  );
}

function FormBody({
  alert,
  operator,
  onClose,
  onSaved,
}: {
  alert: ActiveAlert;
  operator: string;
  now: number;
  onClose: () => void;
  onSaved?: (record: AlertTicketResponseRecord) => void;
}) {
  const lookup = useSubjectLookup();
  const markHandled = useAlertStore((state) => state.markHandled);
  const [status, setStatus] = useState<AlertTicketStatus>("in_progress");
  const [priority, setPriority] = useState<AlertTicketPriority>(
    alert.severity === "critical" ? "critical" : "medium",
  );
  const [notes, setNotes] = useState("");
  const [dispatch, setDispatch] = useState(false);
  const [technician, setTechnician] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [phase, setPhase] = useState<"idle" | "saving" | "success">("idle");

  const saving = phase === "saving";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (phase !== "idle") return;
    const input = {
      alertId: alert.id,
      operator,
      status,
      priority,
      notes,
      dispatchTechnician: dispatch,
      technicianName: dispatch ? technician : undefined,
    };
    const result = validateTicketActionInput(input);
    if (!result.valid) {
      setErrors(result.errors);
      return;
    }
    setErrors([]);
    setPhase("saving");
    const record = createTicketResponseRecord(input);
    saveTicketResponse(record);
    await fetch("/api/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alertId: alert.id,
        status,
        priority,
        notes,
        dispatchTechnician: dispatch,
        technicianName: dispatch ? technician : undefined,
      }),
    }).catch(() => undefined);
    onSaved?.(record);
    if (status === "resolved") {
      await markHandled(alert.id, operator).catch(() => undefined);
    }
    setPhase("success");
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Tanggapi tiket alert</DialogTitle>
        <DialogDescription>
          {incidentLabels[alert.kind]} pada {subjectLabel(alert, lookup)}.
          Operator:{" "}
          <strong className="text-foreground" data-testid="ticket-operator">
            {operator}
          </strong>
        </DialogDescription>
      </DialogHeader>

      {phase === "success" ? (
        <p
          role="status"
          data-testid="ticket-success"
          className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm"
        >
          <CircleCheck className="size-4 text-success" aria-hidden="true" />
          Tanggapan tiket tersimpan
          {status === "resolved" ? "; alert ditandai ditangani." : "."}
        </p>
      ) : (
        <fieldset disabled={saving} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-status">Status tanggapan</Label>
            <select
              id="ticket-status"
              className={fieldClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as AlertTicketStatus)}
            >
              {statusChoices.map((s) => (
                <option key={s} value={s}>
                  {alertTicketStatusLabels[s]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-priority">Prioritas</Label>
            <select
              id="ticket-priority"
              className={fieldClass}
              value={priority}
              onChange={(e) =>
                setPriority(e.target.value as AlertTicketPriority)
              }
            >
              {priorityChoices.map((p) => (
                <option key={p} value={p}>
                  {alertTicketPriorityLabels[p]}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ticket-notes">Catatan penanganan / investigasi</Label>
            <textarea
              id="ticket-notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              aria-invalid={errors.length > 0}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              id="ticket-dispatch"
              type="checkbox"
              checked={dispatch}
              onChange={(e) => setDispatch(e.target.checked)}
              className="size-4"
            />
            <Label htmlFor="ticket-dispatch">Tugaskan Teknisi Lapangan</Label>
          </div>
          {dispatch && (
            <div className="grid gap-1.5">
              <Label htmlFor="ticket-technician">Nama teknisi</Label>
              <Input
                id="ticket-technician"
                value={technician}
                onChange={(e) => setTechnician(e.target.value)}
              />
            </div>
          )}
        </fieldset>
      )}

      {errors.length > 0 && phase === "idle" && (
        <ul
          role="alert"
          data-testid="ticket-errors"
          className="list-disc rounded-md border border-destructive/40 bg-destructive/10 py-2 pr-3 pl-7 text-sm text-destructive"
        >
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {phase === "success" ? "Tutup" : "Batal"}
        </Button>
        {phase !== "success" && (
          <Button
            type="submit"
            data-testid="ticket-submit"
            aria-disabled={saving}
          >
            {saving ? "Menyimpan…" : "Kirim Tanggapan Tiket"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
