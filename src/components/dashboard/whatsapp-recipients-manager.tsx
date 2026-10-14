"use client";

import { useState, useSyncExternalStore } from "react";
import { FlaskConical, Loader2, Plus, Send, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  normalizeRecipientPhone,
  removeRecipient,
  sendMockWhatsappAlert,
  toggleRecipient,
  type WhatsappRecipient,
} from "@/lib/dashboard/whatsapp";
import {
  getWhatsappServerSnapshot,
  loadWhatsappConfig,
  saveWhatsappConfig,
  subscribeWhatsappConfig,
} from "@/lib/dashboard/whatsapp-registry";

function Stat({ label, value, testId }: { label: string; value: string | number; testId: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p data-testid={testId} className="text-2xl font-semibold">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

export function WhatsappRecipientsManager() {
  const config = useSyncExternalStore(
    subscribeWhatsappConfig,
    loadWhatsappConfig,
    getWhatsappServerSnapshot,
  );
  const recipients = config.recipients;

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [type, setType] = useState<WhatsappRecipient["type"]>("personal");
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<WhatsappRecipient | null>(null);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const personalActive = recipients.filter((r) => r.type === "personal" && r.active).length;
  const groupActive = recipients.filter((r) => r.type === "group" && r.active).length;

  // Validasi instan nomor/ID grup selagi mengetik.
  const normalized = normalizeRecipientPhone(phone, type);
  const phoneInvalid = touched && phone.trim() !== "" && normalized === "";

  const persist = (list: WhatsappRecipient[]) => saveWhatsappConfig({ ...config, recipients: list });

  function add() {
    const r = addRecipient(recipients, { name, phone, type });
    if (!r.ok) {
      setTouched(true);
      return setFormError(r.error);
    }
    setFormError(null);
    setTouched(false);
    setName("");
    setPhone("");
    persist(r.list);
  }

  async function sendTest(r: WhatsappRecipient) {
    if (sendingId) return;
    setSendingId(r.id);
    setTestResult(null);
    const result = await sendMockWhatsappAlert(
      { ...config, recipients: [{ ...r, active: true }] },
      {
        id: "alert-uji",
        severity: "critical",
        kind: "Pesan uji",
        subject: `Uji kirim ke ${r.name}`,
        router: "-",
        time: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
        message: "Ini pesan uji coba notifikasi WhatsApp.",
      },
    );
    setSendingId(null);
    setTestResult(
      result.ok
        ? {
            ok: true,
            text: `Berhasil (simulasi): pesan uji ke ${r.name} (${r.phone}) tercatat di Riwayat Notifikasi. Tidak ada pesan nyata terkirim.`,
          }
        : { ok: false, text: `Gagal (simulasi): ${result.error}` },
    );
  }

  return (
    <div className="space-y-4" data-testid="whatsapp-recipients-manager">
      <p
        data-testid="wa-recipients-mock-badge"
        className="inline-flex items-center gap-1.5 rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-xs font-medium text-warning"
      >
        <FlaskConical className="size-3.5" aria-hidden="true" />
        Penyimpanan Lokal Tiruan · Wajib integrasi API backend di Fase 5
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total Penerima" value={recipients.length} testId="wa-stat-total" />
        <Stat label="Kontak Personal Aktif" value={personalActive} testId="wa-stat-personal" />
        <Stat label="Grup WhatsApp Aktif" value={groupActive} testId="wa-stat-group" />
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">Status Notifikasi Sistem</p>
            <p data-testid="wa-stat-enabled">
              <Badge
                variant="outline"
                className={
                  config.enabled
                    ? "border-transparent bg-success/10 text-success"
                    : "border-transparent bg-destructive/10 text-destructive"
                }
              >
                {config.enabled ? "Aktif" : "Nonaktif"}
              </Badge>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tambah Penerima Baru</CardTitle>
          <CardDescription>
            08..., +62... dan 62... diubah otomatis ke format 628xxxxxxxxx.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
            className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end"
          >
            <div className="space-y-1.5">
              <Label htmlFor="waMgrName">Nama Penerima</Label>
              <Input
                id="waMgrName"
                value={name}
                placeholder="Ahmad - On-Call NOC"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waMgrType">Tipe</Label>
              <select
                id="waMgrType"
                value={type}
                onChange={(e) => {
                  setType(e.target.value as WhatsappRecipient["type"]);
                  setFormError(null);
                }}
                className={selectClassName}
              >
                <option value="personal">Personal</option>
                <option value="group">Grup WhatsApp</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="waMgrPhone">
                {type === "personal" ? "Nomor HP" : "ID Grup (@g.us)"}
              </Label>
              <Input
                id="waMgrPhone"
                value={phone}
                inputMode={type === "personal" ? "tel" : "text"}
                placeholder={type === "personal" ? "081234567890" : "120363012345678901@g.us"}
                aria-invalid={phoneInvalid || formError ? true : undefined}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setTouched(true);
                  setFormError(null);
                }}
                className="font-mono text-xs"
              />
            </div>
            <Button type="submit" size="sm" className="gap-1.5">
              <Plus className="size-4" />
              Tambah Penerima
            </Button>
          </form>
          {phoneInvalid && !formError && (
            <p role="alert" data-testid="wa-phone-invalid" className="text-xs text-destructive">
              {type === "group"
                ? "ID grup tidak valid. Contoh: 120363012345678901@g.us"
                : "Nomor tidak valid. Contoh: 081234567890 atau +6281234567890."}
            </p>
          )}
          {phone.trim() !== "" && normalized !== "" && normalized !== phone.trim() && (
            <p data-testid="wa-phone-normalized" className="text-xs text-muted-foreground">
              Akan disimpan sebagai <span className="font-mono">{normalized}</span>
            </p>
          )}
          {formError && (
            <p role="alert" className="text-xs text-destructive">
              {formError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Daftar Penerima</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {recipients.length === 0 ? (
            <p
              data-testid="wa-recipients-empty"
              className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground"
            >
              Belum ada penerima. Tambahkan nomor personal atau grup di atas.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <Table data-testid="wa-recipients-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Nama</TableHead>
                    <TableHead>Tipe</TableHead>
                    <TableHead>Nomor / ID Grup</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Aksi</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recipients.map((r) => (
                    <TableRow key={r.id} data-testid="wa-recipient-row">
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{r.type === "group" ? "Grup" : "Personal"}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{r.phone}</TableCell>
                      <TableCell>
                        <label className="inline-flex items-center gap-2 text-xs">
                          <input
                            type="checkbox"
                            role="switch"
                            checked={r.active}
                            aria-label={`Aktifkan ${r.name}`}
                            onChange={() => persist(toggleRecipient(recipients, r.id))}
                            className="size-4"
                          />
                          {r.active ? "Aktif" : "Nonaktif"}
                        </label>
                      </TableCell>
                      <TableCell className="space-x-1 text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-disabled={sendingId !== null}
                          aria-label={`Uji kirim ke ${r.name}`}
                          onClick={() => sendTest(r)}
                          className="gap-1.5"
                        >
                          {sendingId === r.id ? (
                            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                          ) : (
                            <Send className="size-4" />
                          )}
                          Uji
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Hapus ${r.name}`}
                          onClick={() => setToDelete(r)}
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
          <p
            role="status"
            data-testid="wa-test-result"
            className={`text-xs ${testResult ? (testResult.ok ? "text-success" : "text-destructive") : ""}`}
          >
            {testResult?.text}
          </p>
        </CardContent>
      </Card>

      <AlertDialog open={toDelete !== null} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus penerima?</AlertDialogTitle>
            <AlertDialogDescription>
              {toDelete?.name} ({toDelete?.phone}) tidak akan lagi menerima notifikasi alert.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (toDelete) persist(removeRecipient(recipients, toDelete.id));
                setToDelete(null);
              }}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
