"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { announceSignedOut, SIGNED_OUT_PATH } from "@/lib/signed-out";
import { Button } from "@/components/ui/button";

// Pesan bila sesi tidak bisa dicabut. Kalimat kedua penting: petugas tidak boleh
// mengira sudah keluar padahal sesinya masih berlaku di server.
const FAILURE_MESSAGE = "Gagal keluar. Sesi Anda masih aktif; coba lagi.";

export function SignOutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  // Penjaga sinkron: `pending` baru terbaca pada render berikutnya, sedangkan
  // dua klik (atau Enter berulang) bisa datang dalam satu tugas.
  const inFlight = useRef(false);
  // Minta fokus kembali ke tombol begitu ia aktif lagi sesudah gagal.
  const refocus = useRef(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Tombol yang `disabled` kehilangan fokus. Sesudah gagal, `pending` kembali
  // false dan tombol aktif lagi; di sini fokus dikembalikan ke tombol, supaya
  // pengguna papan ketik tidak terlempar ke awal halaman. Bergantung pada state
  // (bukan timer), jadi baru jalan setelah DOM benar-benar aktif.
  useEffect(() => {
    if (pending || !refocus.current) return;
    refocus.current = false;
    buttonRef.current?.focus();
  }, [pending]);

  async function signOut() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    let failed: boolean;
    try {
      const result = await authClient.signOut();
      failed = Boolean(result.error);
    } catch {
      // Permintaan tidak sampai ke server (jaringan putus, dll.).
      failed = true;
    }
    if (failed) {
      refocus.current = true;
      setError(true);
      inFlight.current = false;
      setPending(false);
      return;
    }
    // Berhasil. Tab lain diberi tahu dulu, lalu dokumen ini diganti SELURUHNYA
    // (bukan router.replace). Navigasi di dalam aplikasi membiarkan memori klien
    // hidup: store dasbor dan alert tingkat modul, cache router Next, dan peran
    // tiruan. Pada pergantian shift di komputer yang sama, petugas berikutnya
    // bisa melihat sisa petugas sebelumnya. Muat ulang penuh membuang semuanya.
    //
    // `pending` dan `inFlight` sengaja TIDAK dikembalikan: tombol tetap terkunci
    // ("Keluar…") sampai halaman berganti, jadi tidak ada klik ganda.
    //
    // Yang tetap ada di penyimpanan peramban: `alertHandled` (catatan server
    // tiruan untuk alert yang ditandai ditangani) dan `alertSound` (pilihan
    // suara). Keduanya data/pengaturan peramban ini, bukan memori sesi petugas,
    // dan tidak berisi apa pun dari akun; menghapusnya akan memunculkan lagi
    // alert yang sudah ditangani dan mengaktifkan suara yang sudah dimatikan.
    announceSignedOut();
    window.location.assign(SIGNED_OUT_PATH);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {FAILURE_MESSAGE}
        </p>
      )}
      <Button
        ref={buttonRef}
        onClick={signOut}
        disabled={pending}
        variant="outline"
        size="sm"
        className="h-6 px-2 text-xs gap-1 rounded-md text-muted-foreground hover:text-foreground"
      >
        <LogOut className="size-3" aria-hidden="true" />
        {pending ? "Keluar…" : "Keluar"}
      </Button>
    </div>
  );
}
