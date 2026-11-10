"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";

function CallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const err = searchParams.get("error");
    if (err) {
      setError(decodeURIComponent(err));
      return;
    }

    // Token JWT ditransmisikan secara aman lewat cookie noc_token
    const cookieMatch = document.cookie.match(/(?:^|;\s*)noc_token=([^;]+)/);
    if (cookieMatch) {
      const cookieToken = decodeURIComponent(cookieMatch[1]);
      localStorage.setItem("noc_token", cookieToken);
      router.replace("/app");
      router.refresh();
      return;
    }

    setError("Token autentikasi tidak ditemukan. Silakan masuk kembali.");
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <div className="w-full max-w-sm rounded-lg border border-destructive/20 bg-destructive/10 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-destructive">Gagal Masuk via GitHub</h2>
          <p className="mt-2 text-xs text-muted-foreground">{error}</p>
          <a
            href="/sign-in"
            className="mt-4 inline-block rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Kembali ke Halaman Masuk
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-primary" />
        <span>Menyelesaikan autentikasi...</span>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen flex-col items-center justify-center p-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin text-primary" />
            <span>Memuat...</span>
          </div>
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
