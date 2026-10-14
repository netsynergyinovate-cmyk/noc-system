"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { selectClassName } from "./select-class";
import {
  addRecipient,
  getActiveRecipientPhones,
  removeRecipient,
  toggleRecipient,
  type WhatsappRecipient,
} from "@/lib/dashboard/whatsapp";

export function WhatsappRecipients({
  recipients,
  onChange,
  error,
}: {
  recipients: WhatsappRecipient[];
  onChange: (next: WhatsappRecipient[]) => void;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<WhatsappRecipient["type"]>("personal");
  const [formError, setFormError] = useState<string | null>(null);

  const activeCount = getActiveRecipientPhones(recipients).length;

  function add() {
    const r = addRecipient(recipients, { name, phone, type });
    if (!r.ok) return setFormError(r.error);
    setFormError(null);
    setName("");
    setPhone("");
    onChange(r.list);
  }

  const shownError = formError ?? error;

  return (
    <div className="space-y-3" data-testid="wa-recipients">
      <div className="text-sm font-semibold">Penerima Alert</div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="waRcpName">Nama Penerima</Label>
          <Input
            id="waRcpName"
            value={name}
            placeholder="Ahmad - On-Call NOC"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="waRcpPhone">Nomor WhatsApp / ID Grup</Label>
          <Input
            id="waRcpPhone"
            value={phone}
            inputMode={type === "personal" ? "tel" : "text"}
            placeholder={type === "personal" ? "081234567890" : "120363012345678901@g.us"}
            aria-invalid={formError ? true : undefined}
            onChange={(e) => setPhone(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="waRcpType">Tipe</Label>
          <select
            id="waRcpType"
            value={type}
            onChange={(e) => setType(e.target.value as WhatsappRecipient["type"])}
            className={selectClassName}
          >
            <option value="personal">Pribadi</option>
            <option value="group">Grup WhatsApp</option>
          </select>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="size-4" />
          Tambah Penerima
        </Button>
      </div>
      {shownError && (
        <p role="alert" className="text-xs text-destructive">
          {shownError}
        </p>
      )}

      <p role="status" data-testid="wa-recipients-summary" className="text-xs text-muted-foreground">
        {activeCount} penerima aktif dari {recipients.length} terdaftar
      </p>

      {recipients.length === 0 ? (
        <p data-testid="wa-recipients-empty" className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
          Belum ada penerima. Tambahkan nomor pribadi atau grup di atas.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="wa-recipients-table">
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Nomor/JID</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recipients.map((r) => (
                <TableRow key={r.id} data-testid="wa-recipient-row">
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{r.type === "group" ? "Grup" : "Pribadi"}</Badge>
                  </TableCell>
                  <TableCell>
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={r.active}
                        aria-label={`Aktifkan ${r.name}`}
                        onChange={() => onChange(toggleRecipient(recipients, r.id))}
                        className="size-4"
                      />
                      <Badge
                        variant={r.active ? "default" : "secondary"}
                        className={r.active ? "bg-success text-white" : undefined}
                      >
                        {r.active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </label>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Hapus ${r.name}`}
                      onClick={() => onChange(removeRecipient(recipients, r.id))}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
