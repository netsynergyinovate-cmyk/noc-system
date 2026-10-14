"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  QUEUE_SPEED_PRESETS,
  validateQueueInput,
  type QueueValidation,
  type SimpleQueueFormInput,
} from "@/lib/dashboard/queue-form";

export interface SimpleQueueFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  routers: readonly { id: string; name: string }[];
  initial: SimpleQueueFormInput | null;
  defaultRouterId?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: SimpleQueueFormInput) => void;
}

const selectClass = "h-9 w-full rounded-md border bg-background px-3 text-sm";

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="mt-1 text-xs text-destructive">
      {message}
    </p>
  );
}

function QueueForm({
  mode,
  routers,
  initial,
  defaultRouterId,
  onCancel,
  onSubmit,
}: Omit<SimpleQueueFormDialogProps, "open" | "onOpenChange"> & { onCancel: () => void }) {
  const [draft, setDraft] = useState({
    routerId: initial?.routerId ?? defaultRouterId ?? routers[0]?.id ?? "",
    name: initial?.name ?? "",
    target: initial?.target ?? "",
    up: initial ? String(initial.maxLimitUploadMbps) : "",
    down: initial ? String(initial.maxLimitDownloadMbps) : "",
    comment: initial?.comment ?? "",
    disabled: initial?.disabled ?? false,
  });
  const [errors, setErrors] = useState<QueueValidation["errors"]>({});
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = validateQueueInput({
      id: initial?.id,
      routerId: draft.routerId,
      name: draft.name,
      target: draft.target,
      maxLimitUploadMbps: Number(draft.up.replace(",", ".")),
      maxLimitDownloadMbps: Number(draft.down.replace(",", ".")),
      comment: draft.comment,
      disabled: draft.disabled,
    });
    setErrors(result.errors);
    if (result.ok) onSubmit(result.clean);
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" data-testid="queue-form">
      <div>
        <label htmlFor="queue-router" className="mb-1 block text-sm font-medium">
          Router Tujuan
        </label>
        <select
          id="queue-router"
          value={draft.routerId}
          disabled={mode === "edit"}
          onChange={(e) => set({ routerId: e.target.value })}
          aria-invalid={!!errors.routerId}
          aria-describedby={errors.routerId ? "queue-router-err" : undefined}
          className={selectClass}
        >
          {routers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        <FieldError id="queue-router-err" message={errors.routerId} />
      </div>

      <div>
        <label htmlFor="queue-name" className="mb-1 block text-sm font-medium">
          Nama Queue
        </label>
        <Input
          id="queue-name"
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder="mis. pppoe-budi"
          aria-invalid={!!errors.name}
          aria-describedby={errors.name ? "queue-name-err" : undefined}
        />
        <FieldError id="queue-name-err" message={errors.name} />
      </div>

      <div>
        <label htmlFor="queue-target" className="mb-1 block text-sm font-medium">
          Target IP
        </label>
        <Input
          id="queue-target"
          value={draft.target}
          onChange={(e) => set({ target: e.target.value })}
          placeholder="10.20.1.5/32"
          className="font-mono"
          aria-invalid={!!errors.target}
          aria-describedby={errors.target ? "queue-target-err" : undefined}
        />
        <FieldError id="queue-target-err" message={errors.target} />
      </div>

      <div>
        <label htmlFor="queue-preset" className="mb-1 block text-sm font-medium">
          Kecepatan (Upload / Download)
        </label>
        <select
          id="queue-preset"
          value=""
          onChange={(e) => {
            const p = QUEUE_SPEED_PRESETS[Number(e.target.value)];
            if (p) set({ up: String(p.up), down: String(p.down) });
          }}
          className={selectClass}
        >
          <option value="">Pilih Preset Kecepatan</option>
          {QUEUE_SPEED_PRESETS.map((p, i) => (
            <option key={p.label} value={i}>
              {p.label}
            </option>
          ))}
        </select>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="queue-up" className="mb-1 block text-xs text-muted-foreground">
              Upload (Mbps)
            </label>
            <Input
              id="queue-up"
              inputMode="decimal"
              value={draft.up}
              onChange={(e) => set({ up: e.target.value })}
              aria-invalid={!!errors.maxLimitUploadMbps}
              aria-describedby={errors.maxLimitUploadMbps ? "queue-up-err" : undefined}
            />
            <FieldError id="queue-up-err" message={errors.maxLimitUploadMbps} />
          </div>
          <div>
            <label htmlFor="queue-down" className="mb-1 block text-xs text-muted-foreground">
              Download (Mbps)
            </label>
            <Input
              id="queue-down"
              inputMode="decimal"
              value={draft.down}
              onChange={(e) => set({ down: e.target.value })}
              aria-invalid={!!errors.maxLimitDownloadMbps}
              aria-describedby={errors.maxLimitDownloadMbps ? "queue-down-err" : undefined}
            />
            <FieldError id="queue-down-err" message={errors.maxLimitDownloadMbps} />
          </div>
        </div>
      </div>

      <div>
        <label htmlFor="queue-comment" className="mb-1 block text-sm font-medium">
          Komentar <span className="font-normal text-muted-foreground">(opsional)</span>
        </label>
        <Input id="queue-comment" value={draft.comment} onChange={(e) => set({ comment: e.target.value })} />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.disabled}
          onChange={(e) => set({ disabled: e.target.checked })}
          className="size-4"
        />
        Nonaktifkan Queue (Disabled)
      </label>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Batal
        </Button>
        <Button type="submit">Simpan Queue</Button>
      </DialogFooter>
    </form>
  );
}

export function SimpleQueueFormDialog({ open, onOpenChange, ...rest }: SimpleQueueFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rest.mode === "create" ? "Tambah Simple Queue" : "Ubah Simple Queue"}</DialogTitle>
          <DialogDescription>
            Data tersimpan sementara di tampilan ini (tiruan) sampai REST API RouterOS tersambung.
          </DialogDescription>
        </DialogHeader>
        {/* dipasang ulang tiap dibuka, jadi isian selalu segar */}
        {open && <QueueForm {...rest} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
