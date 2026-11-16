"use client";

import { useEffect, useRef, useState } from "react";
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
import { cn } from "@/lib/utils";
import type { DashboardOnu } from "@/lib/dashboard/onus";
import {
  BULK_ATTEMPTS,
  BULK_MAX,
  bulkEligibility,
  bulkFailureAction,
  parseOnuModel,
  type BulkMethod,
  type CpeMatch,
} from "@/lib/dashboard/onu-inventory";

type ItemState =
  | { kind: "queued" }
  | { kind: "running"; attempt: number; startedAt: number; note?: string }
  | { kind: "done"; message: string }
  | { kind: "failed"; message: string; attempts: number }
  | { kind: "skipped"; message: string };

type Attempt = { ok: boolean; message: string; code: string; status: number };

async function registerOne(
  o: DashboardOnu,
  method: BulkMethod,
  ensureWan: boolean,
): Promise<Attempt> {
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
        code: "",
        status: res.status,
      };
    }
    return {
      ok: false,
      message:
        res.status === 403
          ? "Hanya admin (izin kelola CPE) yang boleh mendaftarkan."
          : (json?.error?.message ?? "Gagal."),
      code: json?.error?.code ?? "",
      status: res.status,
    };
  } catch {
    return {
      ok: false,
      message: "Server aplikasi tidak terjangkau.",
      code: "network",
      status: 0,
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
    // Merek yang kredensial admin-nya ditolak: sisa modem merek itu dilewati, merek lain lanjut.
    const badBrands = new Map<string, string>();
    // Satu per satu: modem yang WAN-nya diubah menyambung ulang PPPoE, dan tiap login yang salah
    // dihitung modem. Paralel hanya menumpuk keduanya.
    for (const { onu } of toRun) {
      const brand = parseOnuModel(onu.model).brandKey;
      const skipWhy = cancel.current
        ? "Dibatalkan."
        : stopped
          ? "Dilewati karena putaran dihentikan."
          : badBrands.has(brand)
            ? `Dilewati: login admin merek ini ditolak di modem lain (${badBrands.get(brand)}). Perbaiki kredensialnya di Pengaturan GenieACS.`
            : null;
      if (skipWhy) {
        setItems((s) => ({
          ...s,
          [onu.id]: { kind: "skipped", message: skipWhy },
        }));
        continue;
      }
      const startedAt = Date.now();
      setItems((s) => ({
        ...s,
        [onu.id]: { kind: "running", attempt: 1, startedAt },
      }));
      let r = await registerOne(onu, method, ensureWan);
      let action = r.ok ? "next" : bulkFailureAction(r.code, r.status);
      let attempts = 1;
      while (
        action === "retry" &&
        attempts < BULK_ATTEMPTS &&
        !cancel.current
      ) {
        const prev = r.message;
        setItems((s) => ({
          ...s,
          [onu.id]: {
            kind: "running",
            attempt: attempts,
            startedAt,
            note: `Percobaan ${attempts} gagal: ${prev} Diulang 3 detik lagi.`,
          },
        }));
        await new Promise((ok) => setTimeout(ok, 3000));
        attempts++;
        setItems((s) => ({
          ...s,
          [onu.id]: {
            kind: "running",
            attempt: attempts,
            startedAt,
            note: `Percobaan sebelumnya gagal: ${prev}`,
          },
        }));
        r = await registerOne(onu, method, ensureWan);
        action = r.ok ? "next" : bulkFailureAction(r.code, r.status);
      }
      setItems((s) => ({
        ...s,
        [onu.id]: r.ok
          ? { kind: "done", message: r.message }
          : { kind: "failed", message: r.message, attempts },
      }));
      if (action === "skip-brand") {
        badBrands.set(brand, parseOnuModel(onu.model).brandLabel);
        setStopNote(
          `Login admin ditolak untuk merek ${parseOnuModel(onu.model).brandLabel}: sisa modem merek itu dilewati, merek lain dilanjutkan. ${r.message}`,
        );
      }
      if (action === "stop") {
        stopped = true;
        setStopNote(`Putaran dihentikan: ${r.message}`);
      }
    }
    setRunning(false);
    onFinished();
  }

  const states = Object.values(items);
  const counts = {
    done: states.filter((s) => s.kind === "done").length,
    failed: states.filter((s) => s.kind === "failed").length,
    skipped: states.filter((s) => s.kind === "skipped").length,
    total: toRun.length,
  };
  const processed = counts.done + counts.failed + counts.skipped;
  const currentIndex = toRun.findIndex(
    (p) => items[p.onu.id]?.kind === "running",
  );
  const current = currentIndex === -1 ? null : toRun[currentIndex].onu;
  const currentState = current ? items[current.id] : undefined;
  const failedList = toRun.filter((p) => items[p.onu.id]?.kind === "failed");

  // Detik berjalan untuk modem yang sedang dikerjakan (satu modem bisa sampai ±45 dtk).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  // Baris yang sedang dikerjakan selalu terlihat di daftar.
  const listRef = useRef<HTMLUListElement>(null);
  const currentId = current?.id;
  useEffect(() => {
    if (!currentId) return;
    listRef.current
      ?.querySelector(`[data-onu-id="${currentId}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [currentId]);

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
            ref={listRef}
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
                  className={cn(
                    "flex items-start gap-2 px-3 py-2",
                    st?.kind === "running" && "bg-primary/10",
                  )}
                  data-testid="bulk-item"
                  data-onu-id={onu.id}
                  aria-current={st?.kind === "running" ? "step" : undefined}
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
                    <span
                      className={cn(
                        "block",
                        st?.kind === "failed"
                          ? "text-destructive"
                          : st?.kind === "running"
                            ? "text-foreground"
                            : "text-muted-foreground",
                      )}
                    >
                      {st?.kind === "failed"
                        ? `Gagal${st.attempts > 1 ? ` setelah ${st.attempts} percobaan` : ""}: ${st.message}`
                        : st?.kind === "done" || st?.kind === "skipped"
                          ? st.message
                          : !check.ok
                            ? `Dilewati: ${check.reason}`
                            : !included
                              ? `Dilewati: lewat batas ${BULK_MAX} per putaran`
                              : st?.kind === "running"
                                ? `Sedang dikerjakan · percobaan ${st.attempt}/${BULK_ATTEMPTS}${st.note ? ` · ${st.note}` : ""}`
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
              dihitung modem, karena itu login yang ditolak tidak diulang dan
              sisa modem merek itu dilewati. Gagal karena jaringan diulang
              sampai {BULK_ATTEMPTS} kali, lalu lanjut ke modem berikutnya.
            </span>
          </label>
        )}

        {(running || finished) && (
          <div className="space-y-1.5 text-sm" data-testid="bulk-progress">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Kemajuan pendaftaran"
              aria-valuemin={0}
              aria-valuemax={counts.total}
              aria-valuenow={processed}
            >
              <div
                className="h-full bg-primary transition-[width] motion-reduce:transition-none"
                style={{
                  width: `${counts.total ? (processed / counts.total) * 100 : 0}%`,
                }}
              />
            </div>
            <p role="status">
              {processed}/{counts.total} selesai · {counts.done} berhasil ·{" "}
              {counts.failed} gagal · {counts.skipped} dilewati
              {!running &&
                " — putaran selesai. Modem yang berhasil muncul di GenieACS dalam 1–5 menit."}
            </p>
            {current && currentState?.kind === "running" && (
              <p
                className="rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-xs"
                data-testid="bulk-current"
              >
                <Loader2
                  className="mr-1.5 inline size-3.5 animate-spin align-[-2px] text-primary motion-reduce:animate-none"
                  aria-hidden
                />
                Sedang dikerjakan ({currentIndex + 1}/{counts.total}):{" "}
                <strong>{current.customerName}</strong>{" "}
                <span className="font-mono text-muted-foreground">
                  {parseOnuModel(current.model).brandLabel} ·{" "}
                  {current.serialNumber}
                </span>{" "}
                · percobaan {currentState.attempt}/{BULK_ATTEMPTS}
                <span aria-hidden>
                  {" "}
                  ·{" "}
                  {Math.max(
                    0,
                    Math.round((now - currentState.startedAt) / 1000),
                  )}{" "}
                  dtk
                </span>
              </p>
            )}
          </div>
        )}
        {!running && failedList.length > 0 && (
          <div
            className="rounded-md border border-destructive/40 p-2.5 text-xs"
            data-testid="bulk-failed-summary"
          >
            <p className="mb-1 font-medium text-destructive">
              {failedList.length} modem gagal:
            </p>
            <ul className="space-y-1">
              {failedList.map(({ onu }) => {
                const st = items[onu.id];
                return (
                  <li key={onu.id}>
                    <strong>{onu.customerName}</strong>{" "}
                    <span className="font-mono text-muted-foreground">
                      {parseOnuModel(onu.model).brandLabel} · {onu.serialNumber}
                    </span>
                    {st?.kind === "failed" && (
                      <span className="block text-muted-foreground">
                        {st.attempts > 1 ? `${st.attempts} percobaan. ` : ""}
                        {st.message}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
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
