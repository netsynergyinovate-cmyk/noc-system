"use client";

import { useRef, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  Loader2,
  MinusCircle,
  Radio,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { DashboardOnu } from "@/lib/dashboard/onus";
import {
  BULK_MAX,
  bulkEligibility,
  parseOnuModel,
  type BulkMethod,
  type CpeMatch,
} from "@/lib/dashboard/onu-inventory";

type ItemState =
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string }
  | { kind: "skipped"; message: string };

// Kode galat yang berarti kredensial modem ditolak atau dikunci: meneruskan ke modem berikutnya
// hanya menambah percobaan salah (modem mengunci setelah 3 kali), jadi seluruh putaran dihentikan.
const STOP_CODES = new Set([
  "ont_login_rejected",
  "ont_locked",
  "acs_not_configured",
  "BACKEND_UNAVAILABLE",
]);

async function registerOne(
  o: DashboardOnu,
  method: BulkMethod,
  ensureWan: boolean,
): Promise<{ ok: boolean; message: string; stop: boolean }> {
  try {
    const res =
      method === "web"
        ? await fetch("/api/ont-web/tr069", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ onuId: o.id, ensureWan }),
          })
        : await fetch(
            `/api/olts/${o.oltId}/onus/${o.ponIndex}/${o.onuIndex}/tr069-bind`,
            { method: "POST" },
          );
    const json = (await res.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
      host?: string | null;
      error?: { code?: string; message?: string };
    } | null;
    if (res.ok && json?.ok) {
      return {
        ok: true,
        message:
          (json.message ?? "Berhasil.") + (json.host ? ` (${json.host})` : ""),
        stop: false,
      };
    }
    const code = json?.error?.code ?? "";
    return {
      ok: false,
      message:
        res.status === 403
          ? "Hanya admin (izin kelola CPE) yang boleh mendaftarkan."
          : (json?.error?.message ?? "Gagal."),
      stop: STOP_CODES.has(code) || res.status === 403,
    };
  } catch {
    return {
      ok: false,
      message: "Server aplikasi tidak terjangkau.",
      stop: false,
    };
  }
}

export function BulkRegisterDialog({
  open,
  onOpenChange,
  onus,
  reg,
  onFinished,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onus: readonly DashboardOnu[];
  reg: ReadonlyMap<string, CpeMatch>;
  onFinished: () => void;
}) {
  const [method, setMethod] = useState<BulkMethod>("web");
  const [ensureWan, setEnsureWan] = useState(true);
  const [understood, setUnderstood] = useState(false);
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [running, setRunning] = useState(false);
  const [stopNote, setStopNote] = useState<string | null>(null);
  const cancel = useRef(false);

  const plan = onus.map((o) => ({
    onu: o,
    check: bulkEligibility(o, method, reg),
  }));
  const eligible = plan.filter((p) => p.check.ok);
  const toRun = eligible.slice(0, BULK_MAX);
  const overflow = eligible.length - toRun.length;
  const finished = Object.values(items).some(
    (s) => s.kind === "done" || s.kind === "failed",
  );
  const disruptive = method === "web" && ensureWan;
  const blocked =
    toRun.length === 0
      ? "Tidak ada ONU yang memenuhi syarat untuk metode ini."
      : disruptive && !understood
        ? "Centang pernyataan di atas untuk melanjutkan."
        : null;

  async function run() {
    if (running || blocked !== null) return;
    cancel.current = false;
    setRunning(true);
    setStopNote(null);
    setItems(
      Object.fromEntries(
        toRun.map((p) => [p.onu.id, { kind: "queued" } as ItemState]),
      ),
    );
    let stopped = false;
    // Satu per satu: modem yang WAN-nya diubah menyambung ulang PPPoE, dan tiap login yang salah
    // dihitung modem. Paralel hanya menumpuk keduanya.
    for (const { onu } of toRun) {
      if (cancel.current || stopped) {
        setItems((s) => ({
          ...s,
          [onu.id]: {
            kind: "skipped",
            message: stopped
              ? "Dilewati karena putaran dihentikan."
              : "Dibatalkan.",
          },
        }));
        continue;
      }
      setItems((s) => ({ ...s, [onu.id]: { kind: "running" } }));
      const r = await registerOne(onu, method, ensureWan);
      setItems((s) => ({
        ...s,
        [onu.id]: r.ok
          ? { kind: "done", message: r.message }
          : { kind: "failed", message: r.message },
      }));
      if (r.stop) {
        stopped = true;
        setStopNote(`Putaran dihentikan: ${r.message}`);
      }
    }
    setRunning(false);
    onFinished();
  }

  const counts = {
    done: Object.values(items).filter((s) => s.kind === "done").length,
    failed: Object.values(items).filter((s) => s.kind === "failed").length,
    total: toRun.length,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent
        className="max-h-[88vh] overflow-y-auto sm:max-w-2xl"
        data-testid="bulk-register-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            Daftarkan {onus.length} perangkat ke GenieACS
          </DialogTitle>
          <DialogDescription>
            Diproses satu per satu. Modem yang sudah terdaftar dilewati
            otomatis. Maksimal {BULK_MAX} per putaran.
          </DialogDescription>
        </DialogHeader>

        <fieldset disabled={running} className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Metode
          </legend>
          <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="radio"
              name="bulk-method"
              className="mt-1"
              checked={method === "web"}
              onChange={() => setMethod("web")}
            />
            <span>
              <span className="font-medium">
                Lewat halaman web modem (disarankan)
              </span>
              <span className="block text-xs text-muted-foreground">
                Server login ke halaman admin tiap modem, mengisi TR-069, dan
                menyambungkan WAN bila perlu. Baru untuk C-Data (CDTC /
                FD511GW), ZIMLINK (H113 / ZL-2113X) GGCLink (ZICG GM22) dan ZTE
                F609 (MTKc) yang sedang online. IP modem dicari otomatis.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-md border p-2.5 text-sm">
            <input
              type="radio"
              name="bulk-method"
              className="mt-1"
              checked={method === "olt"}
              onChange={() => setMethod("olt")}
            />
            <span>
              <span className="font-medium">
                Lewat OLT (ikat profil TR-069)
              </span>
              <span className="block text-xs text-muted-foreground">
                Perintah telnet ke OLT untuk tiap ONU. Semua merek, tetapi
                profil TR-069 harus sudah dibuat di OLT.
              </span>
            </span>
          </label>
          {method === "web" && (
            <label className="flex items-start gap-2 pt-1 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={ensureWan}
                onChange={(e) => setEnsureWan(e.target.checked)}
              />
              <span>
                Sambungkan TR-069 ke WAN internet bila perlu
                <span className="block text-xs text-muted-foreground">
                  Tanpa ini modem yang hanya punya WAN INTERNET tidak akan
                  melapor.
                </span>
              </span>
            </label>
          )}
        </fieldset>

        <div className="rounded-md border">
          <ul
            className="max-h-64 divide-y overflow-y-auto text-xs"
            aria-label="Daftar perangkat yang diproses"
          >
            {plan.map(({ onu, check }) => {
              const included = toRun.some((p) => p.onu.id === onu.id);
              const st = items[onu.id];
              const id = parseOnuModel(onu.model);
              return (
                <li
                  key={onu.id}
                  className="flex items-start gap-2 px-3 py-2"
                  data-testid="bulk-item"
                >
                  <span className="mt-0.5 shrink-0">
                    {st?.kind === "running" ? (
                      <Loader2
                        className="size-4 animate-spin text-primary"
                        aria-label="Berjalan"
                      />
                    ) : st?.kind === "done" ? (
                      <CheckCircle2
                        className="size-4 text-success"
                        aria-label="Berhasil"
                      />
                    ) : st?.kind === "failed" ? (
                      <CircleAlert
                        className="size-4 text-destructive"
                        aria-label="Gagal"
                      />
                    ) : st?.kind === "skipped" || !included ? (
                      <MinusCircle
                        className="size-4 text-muted-foreground"
                        aria-label="Dilewati"
                      />
                    ) : (
                      <Radio
                        className="size-4 text-muted-foreground"
                        aria-label="Menunggu"
                      />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{onu.customerName}</span>{" "}
                    <span className="font-mono text-muted-foreground">
                      {id.brandLabel}{" "}
                      {id.modelLabel !== "Tidak diketahui" ? id.modelLabel : ""}{" "}
                      · {onu.serialNumber}
                    </span>
                    <span className="block text-muted-foreground">
                      {st?.kind === "done" ||
                      st?.kind === "failed" ||
                      st?.kind === "skipped"
                        ? st.message
                        : !check.ok
                          ? `Dilewati: ${check.reason}`
                          : !included
                            ? `Dilewati: lewat batas ${BULK_MAX} per putaran`
                            : st?.kind === "running"
                              ? "Sedang diproses…"
                              : "Menunggu giliran"}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        {overflow > 0 && (
          <p role="status" className="text-xs text-warning">
            {overflow} perangkat melewati batas {BULK_MAX} per putaran dan tidak
            diproses sekarang. Jalankan lagi sesudah selesai.
          </p>
        )}

        {disruptive && (
          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={understood}
              disabled={running}
              onChange={(e) => setUnderstood(e.target.checked)}
            />
            <span>
              Saya paham: modem yang WAN-nya diubah{" "}
              <strong>menyambung ulang PPPoE sekitar 30 detik</strong>, jadi
              internet pelanggan itu terputus sebentar. Tiap login yang salah
              dihitung modem, karena itu putaran berhenti sendiri bila
              kredensial ditolak.
            </span>
          </label>
        )}

        {(running || finished) && (
          <p role="status" className="text-sm" data-testid="bulk-progress">
            {counts.done} berhasil · {counts.failed} gagal · {counts.total}{" "}
            diproses
            {finished &&
              !running &&
              " — selesai. Modem muncul di GenieACS dalam 1–5 menit."}
          </p>
        )}
        {stopNote && (
          <p role="alert" className="text-sm text-destructive">
            {stopNote}
          </p>
        )}
        {blocked !== null && !running && !finished && (
          <p className="text-xs text-muted-foreground">{blocked}</p>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {running ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => (cancel.current = true)}
            >
              Hentikan setelah yang berjalan
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {finished ? "Tutup" : "Batal"}
            </Button>
          )}
          {!finished && (
            <Button
              type="button"
              data-testid="bulk-run"
              className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
              aria-disabled={running || blocked !== null}
              onClick={() => void run()}
            >
              {running ? "Memproses…" : `Daftarkan ${toRun.length} perangkat`}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
