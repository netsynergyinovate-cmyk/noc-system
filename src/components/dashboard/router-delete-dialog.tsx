"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RouterDeleteDialogProps {
  router: { id: string; name: string };
  onClose: () => void;
  onDeleted: () => void;
}

// Percobaan pertama tanpa force. Bila router masih dipakai, server menjawab 409 berisi jumlah datanya; penghapusan
// paksa baru terbuka setelah operator mengetik nama router. Hanya data aplikasi yang dihapus, bukan isi MikroTik.
export function RouterDeleteDialog({
  router,
  onClose,
  onDeleted,
}: RouterDeleteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmName, setConfirmName] = useState("");

  async function handleDelete(force: boolean) {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/routers/${router.id}${force ? "?force=true" : ""}`,
        { method: "DELETE" },
      );
      const json = await res.json().catch(() => null);
      if (res.status === 409 && json?.error?.code === "ROUTER_IN_USE") {
        setBlocked(json.error.message);
        return;
      }
      // 404: router sudah tidak ada di database (mis. baris basi di layar); anggap selesai dan bersihkan tampilan.
      const alreadyGone =
        res.status === 404 && json?.error?.code === "ROUTER_NOT_FOUND";
      if (!res.ok && !alreadyGone)
        throw new Error(
          json?.error?.message ??
            `Gagal menghapus router (HTTP ${res.status}).`,
        );
      onDeleted();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Terjadi kesalahan saat menghapus router.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md bg-background border-border text-foreground">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Trash2 className="size-4 text-rose-400" />
            Hapus router &quot;{router.name}&quot;?
          </DialogTitle>
          <DialogDescription className="text-xs">
            Hanya menghapus data di aplikasi ini. Pengaturan di MikroTik tidak
            diubah.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-xs text-rose-300">{error}</p>}
        {blocked && (
          <div className="space-y-2 text-xs">
            <p className="text-rose-300">{blocked}</p>
            <p className="text-muted-foreground">
              Menghapus paksa akan <b>menghapus permanen</b> semua pelanggan
              router ini beserta status tagihan, riwayat koneksi dan trafik
              pelanggan, tugas CPE, serta alert, log jaringan, riwayat trafik
              dan syslog router. Tidak bisa dibatalkan. Bila hanya ingin
              berhenti memantau, ubah Status Operasional menjadi Nonaktif di
              Konfigurasi Router. Ketik nama router (<code>{router.name}</code>)
              untuk melanjutkan.
            </p>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={router.name}
              className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            Batal
          </Button>
          {blocked ? (
            <Button
              type="button"
              size="sm"
              disabled={deleting || confirmName !== router.name}
              onClick={() => void handleDelete(true)}
              className="gap-1 bg-rose-700 text-white hover:bg-rose-600"
            >
              {deleting ? "Menghapus..." : "Hapus Paksa Beserta Datanya"}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={deleting}
              onClick={() => void handleDelete(false)}
              className="gap-1 bg-rose-700 text-white hover:bg-rose-600"
            >
              {deleting ? "Menghapus..." : "Hapus Router"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
