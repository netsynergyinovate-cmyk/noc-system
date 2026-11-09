"use client";

import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  mismatchActionLabels,
  mismatchActions,
  type MismatchResolutionAction,
  type MismatchResolutionRecord,
} from "@/lib/dashboard/billing-mismatch-actions";
import {
  mismatchAdvice,
  mismatchLabels,
  type BillingMismatch,
} from "@/lib/dashboard/billing-mismatch";

function subjectOf(item: BillingMismatch) {
  return (
    item.invoice?.invoiceRef ?? item.customers[0]?.pppoeUsername ?? item.id
  );
}

function ActionForm({
  item,
  existing,
  onSave,
  onRemove,
}: {
  item: BillingMismatch;
  existing: MismatchResolutionRecord | null;
  onSave: (action: MismatchResolutionAction, notes: string) => void;
  onRemove: () => void;
}) {
  const [action, setAction] = useState<MismatchResolutionAction>(
    existing?.action ?? "investigate",
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(action, notes);
      }}
    >
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="font-medium" data-testid="mismatch-action-kind">
          {mismatchLabels[item.kind]}
        </div>
        <div
          className="font-mono text-xs break-all"
          data-testid="mismatch-action-subject"
        >
          {subjectOf(item)}
        </div>
        <p className="mt-2 text-muted-foreground">{mismatchAdvice(item)}</p>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">Tindakan</legend>
        {mismatchActions.map((option) => (
          <label key={option} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="mismatch-action"
              value={option}
              checked={action === option}
              onChange={() => setAction(option)}
            />
            {mismatchActionLabels[option]}
          </label>
        ))}
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mismatch-action-notes">
          Catatan teknisi (opsional)
        </Label>
        <textarea
          id="mismatch-action-notes"
          rows={3}
          maxLength={500}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </div>
      <DialogFooter>
        {existing && (
          <Button
            type="button"
            variant="outline"
            data-testid="remove-mismatch-action-btn"
            onClick={onRemove}
          >
            Hapus Tindakan
          </Button>
        )}
        <DialogClose asChild>
          <Button
            type="button"
            variant="outline"
            data-testid="mismatch-action-close"
          >
            Batal
          </Button>
        </DialogClose>
        <Button type="submit" data-testid="save-mismatch-action-btn">
          Simpan Tindakan
        </Button>
      </DialogFooter>
    </form>
  );
}

export function BillingMismatchActionDialog({
  item,
  existing,
  onOpenChange,
  onSave,
  onRemove,
}: {
  // null = tertutup.
  item: BillingMismatch | null;
  existing: MismatchResolutionRecord | null;
  onOpenChange: (open: boolean) => void;
  onSave: (
    item: BillingMismatch,
    action: MismatchResolutionAction,
    notes: string,
  ) => void;
  onRemove: (item: BillingMismatch) => void;
}) {
  return (
    <Dialog open={item !== null} onOpenChange={onOpenChange}>
      <DialogContent data-testid="mismatch-action-dialog">
        <DialogHeader>
          <DialogTitle>Tindakan Ketidaksesuaian Billing</DialogTitle>
          <DialogDescription>
            Tandai ketidaksesuaian ini agar tim tahu sudah ditangani. Tidak
            mengubah data billing atau pelanggan.
          </DialogDescription>
        </DialogHeader>
        {item && (
          <ActionForm
            key={item.id}
            item={item}
            existing={existing}
            onSave={(action, notes) => onSave(item, action, notes)}
            onRemove={() => onRemove(item)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
