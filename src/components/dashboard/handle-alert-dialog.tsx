"use client";

import { useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
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
import { useAlertStore } from "@/lib/dashboard/alert-store";
import {
  formatAlertTime,
  type ActiveAlert,
  type ResolvedAlert,
} from "@/lib/dashboard/alerts";
import {
  incidentLabels,
  incidentSeverityLabels,
} from "@/lib/dashboard/incidents";
import { subjectLabel, useSubjectLookup } from "./anomaly-subject";

// ALUR "TANDAI DITANGANI". Menandai alert memindahkannya ke riwayat dan tidak bisa
// dibatalkan dari layar ini, jadi selalu lewat konfirmasi yang menyebut alert yang
// mana. Tahapnya:
//
//   confirm  dialog terbuka, fokus di "Batal" supaya Enter tidak langsung menandai.
//   saving   permintaan berjalan: tombol tidak bisa ditekan lagi (satu permintaan
//            saja), dialog tidak bisa ditutup.
//   failed   server menolak atau tidak terjangkau: alasannya ditulis di dialog dan
//            tombolnya menjadi "Coba lagi"; alert tetap aktif.
//   done     berhasil: dialog menutup, fokus pindah ke daftar (barisnya sudah tidak
//            ada, jadi fokus tidak boleh jatuh ke halaman), dan catatan di atas
//            daftar menyebut apa yang baru terjadi.
//
// "Alert sudah tidak aktif" (selesai sendiri, atau ditandai petugas lain saat
// dialog terbuka) tidak disimpan sebagai tahap: diturunkan dari daftar aktif yang
// terbaru, jadi muncul seketika tanpa menunggu server dan tidak perlu efek.
type Phase = "confirm" | "saving" | "failed" | "done";

interface Flow {
  alert: ActiveAlert;
  open: boolean;
  phase: Phase;
  message: string | null;
}

export function useHandleAlert(operator: string) {
  const markHandled = useAlertStore((state) => state.markHandled);
  const [flow, setFlow] = useState<Flow | null>(null);
  // Alert terakhir yang berhasil ditandai, untuk catatan di atas daftar.
  const [done, setDone] = useState<ResolvedAlert | null>(null);
  // Daftar yang menerima fokus bila tombol pembukanya sudah tidak ada.
  const regionRef = useRef<HTMLDivElement>(null);
  // Tombol yang membuka dialog. Dialog ini tidak punya Trigger (satu dialog untuk
  // semua baris), padahal Radix hanya mengembalikan fokus ke Trigger, jadi fokus
  // dikembalikan di sini.
  const openerRef = useRef<HTMLElement | null>(null);
  // Penjaga di luar render: dua klik beruntun tidak boleh mengirim dua permintaan.
  const inFlight = useRef(false);

  // Dipanggil saat dialog selesai menutup: fokus kembali ke tombol yang
  // membukanya. Bila tombolnya sudah tidak ada (berhasil: barisnya pindah ke
  // riwayat; atau alertnya selesai sendiri) atau tidak diketahui, fokus ke daftar,
  // bukan jatuh ke halaman.
  const restoreFocus = () => {
    const opener = openerRef.current;
    openerRef.current = null;
    (opener?.isConnected ? opener : regionRef.current)?.focus();
  };

  const request = (alert: ActiveAlert) => {
    const active = document.activeElement;
    openerRef.current =
      active instanceof HTMLElement && active !== document.body ? active : null;
    setFlow({ alert, open: true, phase: "confirm", message: null });
  };

  // Menutup dialog. Selama permintaan berjalan Escape dan Batal dicegah di
  // tempatnya (HandleAlertDialog), begitu pula penutupan oleh tombol konfirmasi.
  const close = () =>
    setFlow((current) => (current ? { ...current, open: false } : current));

  const confirm = async () => {
    if (flow === null || inFlight.current) return;
    const target = flow.alert;
    inFlight.current = true;
    setFlow({ ...flow, phase: "saving", message: null });
    try {
      const result = await markHandled(target.id, operator);
      if (result.ok) {
        setDone(result.alert);
        setFlow((current) =>
          current?.alert.id === target.id
            ? { ...current, open: false, phase: "done" }
            : current,
        );
      } else {
        setFlow((current) =>
          current?.alert.id === target.id
            ? { ...current, phase: "failed", message: result.message }
            : current,
        );
      }
    } finally {
      inFlight.current = false;
    }
  };

  return { flow, done, regionRef, request, close, confirm, restoreFocus };
}

export type HandleAlertController = ReturnType<typeof useHandleAlert>;

const actionLabels: Record<Phase, string> = {
  confirm: "Ya, tandai ditangani",
  saving: "Menyimpan…",
  failed: "Coba lagi",
  // Dialog sedang menutup; tulisan terakhir dibiarkan sampai hilang.
  done: "Menyimpan…",
};

// Dialog konfirmasi. `alerts` adalah daftar aktif yang terbaru (null bila belum
// ada), untuk mengetahui kalau alertnya selesai selagi dialog terbuka.
export function HandleAlertDialog({
  controller,
  alerts,
  operator,
  now,
}: {
  controller: HandleAlertController;
  alerts: ActiveAlert[] | null;
  operator: string;
  now: number;
}) {
  const lookup = useSubjectLookup();
  const { flow, close, confirm, restoreFocus } = controller;
  const phase = flow?.phase ?? "confirm";
  const saving = phase === "saving" || phase === "done";
  const stillActive =
    flow === null ||
    alerts === null ||
    alerts.some((candidate) => candidate.id === flow.alert.id);
  const ended = !stillActive && !saving;

  return (
    <AlertDialog
      open={flow?.open ?? false}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      {flow && (
        <AlertDialogContent
          data-testid="handle-alert-dialog"
          data-phase={ended ? "ended" : phase}
          data-alert-id={flow.alert.id}
          aria-busy={saving}
          // Selama permintaan berjalan dialog tidak bisa ditutup dengan Escape.
          onEscapeKeyDown={(event) => {
            if (saving) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Fokus diatur sendiri (lihat restoreFocus); bawaan Radix hanya
            // mengenal Trigger.
            event.preventDefault();
            restoreFocus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>Tandai alert sudah ditangani?</AlertDialogTitle>
            <AlertDialogDescription>
              {ended ? (
                <>
                  Alert ini sudah tidak aktif: selesai sendiri atau sudah
                  ditandai petugas lain. Tidak ada yang perlu ditandai; lihat di
                  riwayat alert selesai.
                </>
              ) : (
                <>
                  <strong className="text-foreground">
                    {incidentLabels[flow.alert.kind]}
                  </strong>{" "}
                  pada{" "}
                  <strong className="text-foreground">
                    {subjectLabel(flow.alert, lookup)}
                  </strong>{" "}
                  ({incidentSeverityLabels[flow.alert.severity].toLowerCase()}),
                  mulai {formatAlertTime(flow.alert.startedAt, now)}. Alert
                  dipindahkan ke riwayat alert selesai atas nama{" "}
                  <strong className="text-foreground">{operator}</strong> dan
                  tidak muncul lagi di daftar aktif.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {phase === "failed" && !ended && flow.message && (
            <p
              role="alert"
              data-testid="handle-alert-error"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {flow.message}
            </p>
          )}
          <AlertDialogFooter>
            {/* aria-disabled, bukan disabled: tombol yang menjadi nonaktif sesudah
                ditekan membuang fokus papan ketik dari dialog. */}
            <AlertDialogCancel
              aria-disabled={saving}
              className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
              onClick={(event) => {
                // ...dan tidak dengan Batal.
                if (saving) event.preventDefault();
              }}
            >
              {ended ? "Tutup" : "Batal"}
            </AlertDialogCancel>
            {!ended && (
              <AlertDialogAction
                data-testid="handle-alert-confirm"
                aria-disabled={saving}
                className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                onClick={(event) => {
                  // Dialog tetap terbuka selama permintaan berjalan; menutupnya
                  // urusan alur di atas.
                  event.preventDefault();
                  void confirm();
                }}
              >
                {actionLabels[phase]}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      )}
    </AlertDialog>
  );
}

// Catatan di atas daftar setelah alert berhasil ditandai: menyebut yang mana dan
// kapan, karena barisnya sudah hilang dari daftar. Berada di dalam region status
// kartu, jadi diumumkan ke pembaca layar.
export function HandledNotice({
  alert,
  now,
}: {
  alert: ResolvedAlert;
  now: number;
}) {
  const lookup = useSubjectLookup();
  return (
    <span
      data-testid="handled-notice"
      data-alert-id={alert.id}
      className="mt-1 flex items-start gap-1.5 font-medium text-foreground"
    >
      <CircleCheck
        className="mt-0.5 size-4 shrink-0 text-success"
        aria-hidden="true"
      />
      <span>
        Ditandai ditangani: {incidentLabels[alert.kind]},{" "}
        {subjectLabel(alert, lookup)}, pukul{" "}
        {formatAlertTime(alert.endedAt, now)}. Alert pindah ke riwayat alert
        selesai.
      </span>
    </span>
  );
}
