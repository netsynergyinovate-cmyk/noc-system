"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RouterDeleteDialog } from "./router-delete-dialog";

type Item = { id: string; name: string; host: string; status: string };

// Tabel Kelola Router hanya berisi router aktif (datanya dari backend). Router nonaktif tidak dipantau dan tidak
// tampil di sana, jadi daftar ini memberi jalan untuk mengaktifkan atau menghapusnya.
export function InactiveRouterList() {
  const [items, setItems] = useState<Item[]>([]);
  const [target, setTarget] = useState<Item | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/routers", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (res.ok && Array.isArray(json?.data))
        setItems((json.data as Item[]).filter((r) => r.status !== "aktif"));
    } catch {
      // daftar tambahan: gagal memuat tidak mengganggu halaman
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function activate(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/routers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "aktif" }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(
          json?.error?.message ??
            `Gagal mengaktifkan router (HTTP ${res.status}).`,
        );
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal mengaktifkan router.");
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-xs">
      <p className="font-semibold text-foreground">
        Router nonaktif ({items.length})
      </p>
      <p className="mt-1 text-muted-foreground">
        Tidak dipantau dan tidak tampil di tabel di atas.
      </p>
      {error && <p className="mt-2 text-rose-300">{error}</p>}
      <ul className="mt-3 divide-y divide-border/60">
        {items.map((r) => (
          <li
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <span>
              <b>{r.name}</b>{" "}
              <code className="text-muted-foreground">{r.host}</code>
            </span>
            <span className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busyId === r.id}
                onClick={() => void activate(r.id)}
              >
                {busyId === r.id ? "Mengaktifkan..." : "Aktifkan"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="text-rose-300"
                onClick={() => setTarget(r)}
              >
                Hapus
              </Button>
            </span>
          </li>
        ))}
      </ul>
      {target && (
        <RouterDeleteDialog
          router={target}
          onClose={() => setTarget(null)}
          onDeleted={() => {
            setTarget(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
