"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Hanya data di aplikasi yang dihapus (OLT, ONU hasil polling, pemetaan pelanggan); perangkat OLT tidak disentuh.
export function OltDeleteDialog({
  olt,
  onClose,
  onDeleted,
}: {
  olt: { id: string; name: string };
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/olts/${olt.id}`, { method: "DELETE" });
      // 404: sudah tidak ada di database (baris basi di layar); anggap selesai.
      if (!res.ok && res.status !== 404) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error?.message ?? `Gagal menghapus OLT (HTTP ${res.status}).`);
      }
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Terjadi kesalahan saat menghapus OLT.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !deleting && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hapus OLT {olt.name}?</DialogTitle>
          <DialogDescription>
            OLT, daftar ONU hasil polling, dan pemetaan pelanggan ke ONU-nya dihapus dari aplikasi. Perangkat OLT sendiri tidak diubah.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>
            Batal
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={deleting} data-testid="olt-delete-confirm">
            {deleting ? "Menghapus…" : "Hapus OLT"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
