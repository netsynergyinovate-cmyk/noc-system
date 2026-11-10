"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LoaderCircle } from "lucide-react";

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = searchParams.get("token");
    const err = searchParams.get("error");

    if (err) {
      setError(decodeURIComponent(err));
      return;
    }

    if (token) {
      localStorage.setItem("noc_token", token);
      document.cookie = `noc_token=${encodeURIComponent(token)}; Path=/; Max-Age=604800; SameSite=Lax`;
      router.replace("/app");
      router.refresh();
      return;
    }

    // Periksa cookie jika token tidak dikirim lewat URL
    const cookieMatch = document.cookie.match(/(?:^|;\s*)noc_token=([^;]+)/);
    if (cookieMatch) {
      const cookieToken = decodeURIComponent(cookieMatch[1]);
      localStorage.setItem("noc_token", cookieToken);
      router.replace("/app");
      router.refresh();
      return;
    }

    setError("Token autentikasi tidak ditemukan.");
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-4 text-center">
        <div className="w-full max-w-sm rounded-lg border border-destructive/20 bg-destructive/10 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-destructive">Gagal Masuk via SSO</h2>
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
        <span>Memproses autentikasi...</span>
      </div>
    </div>
  );
}
