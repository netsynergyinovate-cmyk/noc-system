"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, Check, RefreshCw, Save, Server, ShieldCheck, Trash2, X } from "lucide-react";
import type { MockRouterDetail } from "@/lib/dashboard/routers";

interface RouterConfigDialogProps {
  router: MockRouterDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

export function RouterConfigDialog({
  router,
  open,
  onOpenChange,
  onSaved,
  onDeleted,
}: RouterConfigDialogProps) {
  const [name, setName] = useState(router?.name ?? "");
  const [host, setHost] = useState(router?.host ?? "");
  const [username, setUsername] = useState("Monitor");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"aktif" | "nonaktif">(router?.active ? "aktif" : "nonaktif");
  const [role, setRole] = useState(router?.role ?? "Gateway Utama + BRAS");

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; latencyMs?: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Hapus: percobaan pertama tanpa force; bila router masih dipakai server menjawab 409 berisi jumlah datanya,
  // lalu operator harus mengetik nama router sebelum penghapusan paksa.
  const [deleting, setDeleting] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");

  // Sinkronkan state saat dialog dibuka untuk router baru
  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen && router) {
      setName(router.name);
      setHost(router.host);
      setStatus(router.active ? "aktif" : "nonaktif");
      setRole(router.role || "Gateway Utama + BRAS");
      setPassword("");
      setTestResult(null);
      setErrorMessage(null);
      setSuccessMessage(null);
    }
    onOpenChange(nextOpen);
  };

  async function handleTestConnection() {
    if (!router) return;
    setTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      const res = await fetch(`/api/routers/${router.id}/test`, {
        method: "POST",
      });
      const json = await res.json().catch(() => null);
      if (res.ok && json?.data?.ok) {
        setTestResult({
          ok: true,
          message: json.data.message ?? "Koneksi REST API RouterOS berhasil tersambung.",
          latencyMs: json.data.latencyMs,
        });
      } else {
        setTestResult({
          ok: false,
          message: json?.data?.message ?? json?.error?.message ?? `Koneksi gagal (HTTP ${res.status}).`,
        });
      }
    } catch (e) {
      setTestResult({
        ok: false,
        message: e instanceof Error ? e.message : "Gagal menguji koneksi router.",
      });
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!router) return;
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        host: host.trim(),
        status,
      };
      if (username.trim()) payload.username = username.trim();
      if (password.trim()) payload.password = password.trim();

      const res = await fetch(`/api/routers/${router.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error?.message ?? `Gagal menyimpan konfigurasi (HTTP ${res.status}).`);
      }

      setSuccessMessage("Konfigurasi router berhasil disimpan.");
      onSaved?.();
      setTimeout(() => {
        onOpenChange(false);
      }, 1200);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Terjadi kesalahan saat menyimpan konfigurasi.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(force: boolean) {
    if (!router) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch(`/api/routers/${router.id}${force ? "?force=true" : ""}`, { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.error?.code === "ROUTER_IN_USE") {
        setDeleteBlocked(json.error.message);
        return;
      }
      if (!res.ok) throw new Error(json?.error?.message ?? `Gagal menghapus router (HTTP ${res.status}).`);
      onDeleted?.();
      onOpenChange(false);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Terjadi kesalahan saat menghapus router.");
    } finally {
      setDeleting(false);
    }
  }

  if (!router) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-xl bg-background border-border text-foreground">
        <DialogHeader className="border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Server className="size-5 text-emerald-400" />
            <DialogTitle className="text-base font-semibold text-foreground">
              Konfigurasi Router: {router.name}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground font-mono">
            ID: {router.id} • {router.boardModel} ({router.rosVersion})
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-xs">
          {errorMessage && (
            <div className="p-3 rounded-lg bg-rose-950/40 border border-rose-800/60 text-rose-300 flex items-center gap-2">
              <X className="size-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {successMessage && (
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/60 text-emerald-300 flex items-center gap-2">
              <Check className="size-4 shrink-0 text-emerald-400" />
              <span>{successMessage}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label className="text-foreground/90 font-medium">Nama Router</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Contoh: Core CIARA"
                className="bg-muted border-border text-foreground font-mono text-xs focus-visible:ring-emerald-500/40"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground/90 font-medium">Host / Alamat IP</Label>
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="103.167.70.136"
                className="bg-muted border-border text-foreground font-mono text-xs focus-visible:ring-emerald-500/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label className="text-foreground/90 font-medium">Username REST API</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Monitor"
                className="bg-muted border-border text-foreground font-mono text-xs focus-visible:ring-emerald-500/40"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground/90 font-medium">
                Password Baru <span className="text-muted-foreground font-normal">(kosongkan jika tidak berubah)</span>
              </Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="bg-muted border-border text-foreground font-mono text-xs focus-visible:ring-emerald-500/40"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div className="space-y-1.5">
              <Label className="text-foreground/90 font-medium">Peran Router</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full h-9 px-3 rounded-md bg-muted border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
              >
                <option value="Gateway Utama + BRAS">Gateway Utama + BRAS</option>
                <option value="Core BGP Gateway">Core BGP Gateway</option>
                <option value="Distribusi OLT">Distribusi OLT</option>
                <option value="Aggregator PPPoE">Aggregator PPPoE</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-foreground/90 font-medium">Status Operasional</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "aktif" | "nonaktif")}
                className="w-full h-9 px-3 rounded-md bg-muted border border-border text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500/40"
              >
                <option value="aktif">Aktif (Live Telemetri)</option>
                <option value="nonaktif">Nonaktif (Terputus)</option>
              </select>
            </div>
          </div>

          {/* Bagian Uji Koneksi Pre-flight */}
          <div className="p-3 rounded-xl bg-muted/70 border border-border space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-foreground/90 font-medium">
                <ShieldCheck className="size-4 text-emerald-400" />
                <span>Uji Konektivitas REST API RouterOS</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing}
                className="h-7 text-[11px] gap-1 bg-muted hover:bg-muted/80 border-border text-foreground"
              >
                <Activity className={`size-3 text-emerald-400 ${testing ? "animate-pulse" : ""}`} />
                {testing ? "Menguji..." : "Uji Sekarang"}
              </Button>
            </div>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg text-[11px] font-mono flex items-center justify-between ${
                  testResult.ok
                    ? "bg-emerald-950/40 border border-emerald-800/50 text-emerald-300"
                    : "bg-rose-950/40 border border-rose-800/50 text-rose-300"
                }`}
              >
                <span>{testResult.message}</span>
                {testResult.latencyMs !== undefined && (
                  <span className="font-semibold text-emerald-400">{testResult.latencyMs} ms</span>
                )}
              </div>
            )}
          </div>

          {/* Hapus router */}
          <div className="p-3 rounded-xl border border-rose-800/50 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-rose-300 font-medium">Hapus router ini dari aplikasi</span>
              {!deleteBlocked && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void handleDelete(false)}
                  className="h-7 text-[11px] gap-1 border-rose-800/60 text-rose-300 hover:bg-rose-950/40"
                >
                  <Trash2 className="size-3" />
                  {deleting ? "Menghapus..." : "Hapus Router"}
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Hanya menghapus data di aplikasi ini. Pengaturan di MikroTik tidak diubah.
            </p>
            {deleteError && <p className="text-[11px] text-rose-300">{deleteError}</p>}
            {deleteBlocked && (
              <div className="space-y-2 text-[11px]">
                <p className="text-rose-300">{deleteBlocked}</p>
                <p className="text-muted-foreground">
                  Menghapus paksa akan <b>menghapus permanen</b> semua pelanggan router ini beserta status tagihan, riwayat
                  koneksi dan trafik pelanggan, tugas CPE, serta alert, log jaringan, riwayat trafik dan syslog router. Tidak
                  bisa dibatalkan. Bila hanya ingin berhenti memantau, ubah Status Operasional menjadi Nonaktif lalu simpan.
                  Ketik nama router (<code>{router.name}</code>) untuk melanjutkan.
                </p>
                <input
                  value={confirmName}
                  onChange={(e) => setConfirmName(e.target.value)}
                  placeholder={router.name}
                  className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={deleting || confirmName !== router.name}
                  onClick={() => void handleDelete(true)}
                  className="h-7 text-[11px] gap-1 bg-rose-700 text-white hover:bg-rose-600"
                >
                  <Trash2 className="size-3" />
                  {deleting ? "Menghapus..." : "Hapus Paksa Beserta Datanya"}
                </Button>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="border-t border-border pt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-muted-foreground hover:text-foreground"
          >
            Batal
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={saving}
            className="gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-medium"
          >
            {saving ? <RefreshCw className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? "Menyimpan..." : "Simpan Konfigurasi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

