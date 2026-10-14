"use client";

import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Eye, EyeOff, Loader2, RotateCcw, Save, Send } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MockDataNotice } from "./mock-data-notice";
import { selectClassName } from "./select-class";
import {
  getWhatsappConfig,
  getWhatsappServerSnapshot,
  resetWhatsappConfig,
  saveWhatsappConfig,
  subscribeWhatsappConfig,
} from "@/lib/dashboard/whatsapp-registry";
import { WhatsappPreviewCard } from "./whatsapp-preview-card";
import { WhatsappRecipients } from "./whatsapp-recipients";
import {
  providerDefaultUrl,
  sendMockWhatsappAlert,
  type SendMockResult,
  templateVariables,
  validateWhatsappConfig,
  type WaProvider,
  type WhatsappConfig,
} from "@/lib/dashboard/whatsapp";

const inputErr = "text-xs text-destructive";

export function WhatsappSettings() {
  const saved = useSyncExternalStore(
    subscribeWhatsappConfig,
    getWhatsappConfig,
    getWhatsappServerSnapshot,
  );
  // Hanya field yang diubah pengguna; sisanya mengikuti nilai tersimpan.
  const [edits, setEdits] = useState<Partial<WhatsappConfig>>({});
  const [showKey, setShowKey] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [test, setTest] = useState<{
    ok: boolean;
    text: string;
    result?: Extract<SendMockResult, { ok: true }>;
  } | null>(null);
  const [sending, setSending] = useState(false);

  const draft: WhatsappConfig = { ...saved, ...edits };
  const set = (patch: Partial<WhatsappConfig>) => {
    setEdits((e) => ({ ...e, ...patch }));
    setNotice(null);
  };

  function changeProvider(provider: WaProvider) {
    set({ provider, gatewayUrl: providerDefaultUrl[provider] });
  }

  function insertVariable(name: string) {
    set({ template: `${draft.template}{${name}}` });
  }

  function handleSave() {
    const result = validateWhatsappConfig(draft);
    setErrors(result.errors);
    if (!result.valid) return setNotice(null);
    saveWhatsappConfig(draft);
    setEdits({});
    setNotice("Pengaturan WhatsApp disimpan.");
  }

  function handleReset() {
    resetWhatsappConfig();
    setEdits({});
    setErrors({});
    setTest(null);
    setNotice("Pengaturan WhatsApp dikembalikan ke bawaan.");
  }

  // Toggle langsung disimpan agar ringkasan di tab "Alarm & Bot" ikut berubah.
  function toggleEnabled() {
    const enabled = !draft.enabled;
    saveWhatsappConfig({ ...saved, enabled });
    setEdits((e) => {
      const rest = { ...e };
      delete rest.enabled;
      return rest;
    });
    setNotice(null);
  }

  async function handleTest() {
    if (sending) return;
    const { errors: e } = validateWhatsappConfig({ ...draft, enabled: true });
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return setTest({ ok: false, text: `Gagal (simulasi): ${Object.values(e)[0]}` });
    }
    setErrors({});
    setSending(true);
    setTest(null);
    const result = await sendMockWhatsappAlert(draft, {
      id: "alert-uji",
      severity: "critical",
      kind: "Pesan uji",
      subject: "Uji kirim dari Pengaturan",
      router: "-",
      time: new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC",
      message: "Ini pesan uji coba notifikasi WhatsApp.",
    });
    setSending(false);
    setTest(
      result.ok
        ? { ok: true, text: "", result }
        : { ok: false, text: `Gagal (simulasi): ${result.error}` },
    );
  }

  return (
    <form
      noValidate
      data-testid="whatsapp-settings-form"
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="space-y-4"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            Notifikasi Alert WhatsApp
            <Badge
              data-testid="whatsapp-gateway-badge"
              variant="outline"
              className={
                draft.enabled
                  ? "border-transparent bg-success/10 text-success"
                  : "border-transparent bg-destructive/10 text-destructive"
              }
            >
              {draft.enabled ? "Gateway Aktif" : "Gateway Nonaktif"}
            </Badge>
          </CardTitle>
          <CardDescription>
            Kirim alert ke nomor teknisi lewat gateway WhatsApp (Fonnte, Wablas, atau API sendiri).
          </CardDescription>
          <div>
            <MockDataNotice source="gateway WhatsApp di backend" />
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
            <div>
              <div className="text-sm font-semibold">Aktifkan Notifikasi WhatsApp</div>
              <p className="text-xs text-muted-foreground">
                Bila mati, tidak ada alert yang dikirim lewat WhatsApp.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant={draft.enabled ? "default" : "outline"}
              aria-pressed={draft.enabled}
              onClick={toggleEnabled}
            >
              {draft.enabled ? "Aktif" : "Nonaktif"}
            </Button>
          </div>
          {!draft.enabled && (
            <p
              data-testid="whatsapp-disabled-notice"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              Notifikasi dinonaktifkan: pesan alert otomatis tidak akan dikirim ke WhatsApp.
            </p>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="waProvider">Provider</Label>
              <select
                id="waProvider"
                value={draft.provider}
                onChange={(e) => changeProvider(e.target.value as WaProvider)}
                className={selectClassName}
              >
                <option value="fonnte">Fonnte</option>
                <option value="wablas">Wablas</option>
                <option value="custom">Custom API</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="waSeverity">Kirim untuk tingkat</Label>
              <select
                id="waSeverity"
                value={draft.minSeverity}
                onChange={(e) => set({ minSeverity: e.target.value as "critical" | "warning" })}
                className={selectClassName}
              >
                <option value="critical">Hanya Kritis</option>
                <option value="warning">Kritis &amp; Peringatan</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="waUrl">Gateway URL</Label>
              <Input
                id="waUrl"
                value={draft.gatewayUrl}
                onChange={(e) => set({ gatewayUrl: e.target.value })}
                aria-invalid={errors.gatewayUrl ? true : undefined}
                className="font-mono text-xs"
              />
              {errors.gatewayUrl && (
                <p role="alert" className={inputErr}>
                  {errors.gatewayUrl}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="waKey">API Token</Label>
              <div className="flex gap-2">
                <Input
                  id="waKey"
                  type={showKey ? "text" : "password"}
                  autoComplete="off"
                  value={draft.apiKey}
                  onChange={(e) => set({ apiKey: e.target.value })}
                  aria-invalid={errors.apiKey ? true : undefined}
                  className="font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-pressed={showKey}
                  aria-label={showKey ? "Sembunyikan API token" : "Tampilkan API token"}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              {errors.apiKey && (
                <p role="alert" className={inputErr}>
                  {errors.apiKey}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Disimpan di peramban ini saja (data tiruan). Jangan isi token produksi sebelum backend menyimpannya.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <WhatsappRecipients
              recipients={draft.recipients}
              onChange={(recipients) => set({ recipients })}
              error={errors.recipients}
            />
            <p className="text-xs text-muted-foreground">
              08..., +62... dan 62... diubah otomatis ke format 628xxxxxxxxx.
            </p>
            <Link
              href="/app/alert/whatsapp/penerima"
              className="inline-block text-xs font-medium text-primary underline-offset-4 hover:underline"
            >
              Kelola penerima di halaman khusus →
            </Link>
          </div>

          <div className="space-y-2">
            <Label htmlFor="waTemplate">Template Pesan</Label>
            <div className="flex flex-wrap gap-1.5">
              {templateVariables.map((v) => (
                <Button
                  key={v}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => insertVariable(v)}
                  className="h-7 font-mono text-xs"
                >
                  {`{${v}}`}
                </Button>
              ))}
            </div>
            <textarea
              id="waTemplate"
              rows={7}
              value={draft.template}
              onChange={(e) => set({ template: e.target.value })}
              aria-invalid={errors.template ? true : undefined}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
            />
            {errors.template && (
              <p role="alert" className={inputErr}>
                {errors.template}
              </p>
            )}
            <WhatsappPreviewCard template={draft.template} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uji Kirim</CardTitle>
          <CardDescription>
            Memeriksa isian lalu mensimulasikan pengiriman. Belum ada pesan nyata yang dikirim.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleTest}
            aria-disabled={sending}
            className="gap-1.5"
          >
            {sending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> : <Send className="size-4" />}
            {sending ? "Mengirim pesan uji..." : "Kirim Pesan Uji"}
          </Button>
          <div
            role="status"
            data-testid="whatsapp-test-result"
            className={`space-y-2 text-xs ${test ? (test.ok ? "text-success" : "text-destructive") : ""}`}
          >
            {test?.result ? (
              <>
                <p>
                  Berhasil (simulasi): pesan uji terkirim ke {test.result.sentCount} nomor (
                  {test.result.phones.join(", ")}) dalam {test.result.latencyMs} ms. Pesan telah
                  dicatat ke Riwayat Notifikasi. Tidak ada pesan nyata yang terkirim.
                </p>
                <Button asChild variant="outline" size="sm">
                  <Link href="/app/alert/whatsapp">Buka Riwayat Notifikasi</Link>
                </Button>
              </>
            ) : (
              test?.text
            )}
          </div>
        </CardContent>
      </Card>

      <Button asChild variant="link" size="sm" className="px-0">
        <Link href="/app/alert/whatsapp">Lihat Riwayat Pengiriman WhatsApp →</Link>
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="gap-1.5">
          <Save className="size-4" />
          Simpan Pengaturan
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
          <RotateCcw className="size-4" />
          Reset ke Bawaan
        </Button>
        <p role="status" className="text-xs text-success">
          {notice}
        </p>
      </div>
    </form>
  );
}
