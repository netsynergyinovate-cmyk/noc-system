"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CircleCheck,
  Clock,
  Eye,
  EyeOff,
  Globe,
  LoaderCircle,
  TimerOff,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import {
  authFailureFocus,
  authFailureMessage,
  authFailureWait,
  retryDelaySeconds,
  type AuthFailure,
  type AuthFocusTarget,
} from "@/lib/auth-errors";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { siteConfig } from "@/config/site";
import { safeNextPath, signInUrl, signUpUrl } from "@/lib/route-guard";

// Pesan yang tampil dan isian yang diberi fokus/ditandai karenanya.
type Failure = { message: string; target: AuthFocusTarget };

// Header lama tunggu pada jawaban 429 Better Auth. Namanya X-Retry-After, BUKAN
// Retry-After (dicek di better-auth 1.7.3, api/rate-limiter). Klien tidak menaruh
// header di objek galatnya, jadi dibaca lewat onError per panggilan.
const RETRY_AFTER_HEADER = "X-Retry-After";

// Mengirim isian ke Better Auth (autentikasi yang asli, tanpa jalan pintas).
// Mengembalikan null bila berhasil. Permintaan yang tidak sampai ke server
// (fetch melempar) dibedakan dari jawaban galat server.
async function send(
  signingUp: boolean,
  data: FormData,
): Promise<AuthFailure | null> {
  const credentials = {
    email: String(data.get("email")).trim(),
    password: String(data.get("password")),
  };
  const seen: { retryAfter: string | null } = { retryAfter: null };
  const options = {
    onError(context: { response: Response }) {
      seen.retryAfter = context.response.headers.get(RETRY_AFTER_HEADER);
    },
  };
  try {
    const result = signingUp
      ? await authClient.signUp.email(
          { ...credentials, name: String(data.get("name")).trim() },
          options,
        )
      : await authClient.signIn.email(credentials, options);
    return result.error
      ? {
          kind: "response",
          status: result.error.status,
          code: result.error.code,
          // Dibersihkan di sini (1..60 detik); tanpa header tidak diisi, dan
          // lama bawaan dipilih oleh authFailureWait.
          retryAfter:
            seen.retryAfter === null
              ? undefined
              : retryDelaySeconds(seen.retryAfter),
        }
      : null;
  } catch {
    return { kind: "network" };
  }
}

// Penjelasan statis (tanpa angka) untuk tombol yang sedang menunggu.
const WAIT_NOTE_ID = "auth-wait-note";

// Hitung mundur sesudah dibatasi laju. Berdasar JAM DINDING: yang disimpan
// adalah saat selesai (Date.now() + detik), dan angka yang tampil dihitung dari
// selisihnya pada tiap denyut, bukan dikurangi satu per denyut. Tab yang tertidur
// atau jam yang melompat jadi menunjukkan angka yang benar begitu denyut
// berikutnya (atau tab terlihat lagi) datang. Satu interval, dibersihkan saat
// selesai, saat komponen dilepas, dan saat hitungan baru dimulai.
const COUNTDOWN_TICK_MS = 250;

function useWaitCountdown() {
  const [until, setUntil] = useState<number | null>(null);
  const [left, setLeft] = useState(0);
  // Sudah selesai menunggu (untuk diumumkan satu kali).
  const [finished, setFinished] = useState(false);
  // Salinan sinkron dari `until`: penjaga kiriman membacanya di tengah tugas yang
  // sama dengan klik, sebelum React sempat merender ulang.
  const untilRef = useRef<number | null>(null);

  useEffect(() => {
    if (until === null) return;
    const tick = () => {
      const remaining = Math.ceil((until - Date.now()) / 1000);
      if (remaining > 0) {
        setLeft(remaining);
        return;
      }
      untilRef.current = null;
      setUntil(null);
      setLeft(0);
      setFinished(true);
    };
    const timer = window.setInterval(tick, COUNTDOWN_TICK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [until]);

  return {
    waiting: until !== null,
    left,
    finished,
    // Masih menunggu menurut jam dinding saat ini (bukan menurut render terakhir).
    blocked: () => untilRef.current !== null && Date.now() < untilRef.current,
    start(seconds: number) {
      const deadline = Date.now() + seconds * 1000;
      untilRef.current = deadline;
      setUntil(deadline);
      setLeft(seconds);
      setFinished(false);
    },
    clear() {
      untilRef.current = null;
      setUntil(null);
      setLeft(0);
      setFinished(false);
    },
  };
}

export function AuthForm({
  mode,
  redirectTo,
  notice,
  allowSignUp = true,
}: {
  mode: "sign-in" | "sign-up";
  // Tujuan setelah berhasil (dari ?next=). Server sudah membersihkannya; di sini
  // dibersihkan sekali lagi, jadi nilai yang tidak sah selalu jatuh ke dasbor.
  redirectTo?: string | null;
  // Penegasan di atas formulir masuk: "signed-out" setelah petugas keluar (dari
  // ?keluar=1) dan "session-expired" bila cookie ada tetapi sesinya tidak sah
  // (dari ?sesi=berakhir); dinilai server lewat isSignedOutParam dan
  // isSessionExpiredParam. Hanya bendera: tidak ada teks dari alamat yang
  // dipantulkan. Halaman daftar tidak pernah menampilkannya.
  notice?: "signed-out" | "session-expired" | null;
  // Tautan "Buat akun" di halaman masuk hanya bila pendaftaran dibuka (ALLOW_SIGN_UP).
  allowSignUp?: boolean;
}) {
  const signingUp = mode === "sign-up";
  const router = useRouter();
  const destination = safeNextPath(redirectTo ?? null);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const wait = useWaitCountdown();
  // Penjaga sinkron: `pending` baru terbaca pada render berikutnya, sedangkan
  // dua kiriman bisa datang dalam satu tugas (klik ganda, Enter berulang).
  const inFlight = useRef(false);
  // Isian yang diberi fokus begitu formulir aktif lagi sesudah gagal.
  const focusAfter = useRef<AuthFocusTarget | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  // Selama menunggu, isian dinonaktifkan lewat fieldset sehingga fokus hilang.
  // Setelah fieldset aktif lagi (pending kembali false), fokus dipindahkan ke
  // isian yang menjadi sebab galat. Kata sandi juga dipilih seluruhnya supaya
  // mudah diketik ulang.
  useEffect(() => {
    const target = focusAfter.current;
    if (pending || !target) return;
    focusAfter.current = null;
    const element =
      target === "email"
        ? emailRef.current
        : target === "password"
          ? passwordRef.current
          : submitRef.current;
    element?.focus();
    if (target === "password") passwordRef.current?.select();
  }, [pending]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Selama batas laju berlaku, tombol hanya aria-disabled (fokus tetap di
    // sana), jadi klik dan Enter masih sampai ke sini dan harus diabaikan.
    if (inFlight.current || wait.blocked()) return;
    inFlight.current = true;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setFailure(null);
    // Kiriman baru membatalkan sisa hitungan dan pengumumannya.
    wait.clear();
    const reason = await send(signingUp, data);
    if (reason) {
      const target = authFailureFocus(mode, reason);
      focusAfter.current = target;
      setFailure({ message: authFailureMessage(mode, reason), target });
      const seconds = authFailureWait(mode, reason);
      if (seconds !== null) wait.start(seconds);
    } else {
      router.replace(destination ?? siteConfig.homePath);
      router.refresh();
    }
    inFlight.current = false;
    setPending(false);
  }

  const errorId = failure ? "auth-error" : undefined;
  const actionName = signingUp ? "Buat akun" : "Masuk";
  const invalid = (field: AuthFocusTarget) =>
    failure?.target === field ? true : undefined;
  const describedBy = (field: AuthFocusTarget, ...rest: (string | false)[]) =>
    [failure?.target === field && errorId, ...rest].filter(Boolean).join(" ") ||
    undefined;

  return (
    <div className="w-full max-w-sm">
      <p className="mb-3 text-sm font-medium text-primary">
        {signingUp ? "Akun baru" : "Akses petugas NOC"}
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        {signingUp ? "Buat akun petugas" : "Masuk ke NOC ISP"}
      </h1>
      <p className="mt-3 text-base leading-7 text-muted-foreground">
        {signingUp
          ? "Isi data singkat, lalu langsung masuk ke dasbor."
          : "Gunakan akun petugas untuk membuka dasbor pemantauan."}
      </p>
      {/* Teks dan ikon sama-sama menyampaikan "sudah keluar"; warna hanya
          pendukung. Teksnya memakai warna isi biasa (bukan token --success) supaya
          kontrasnya aman di tema terang dan gelap. */}
      {!signingUp && notice === "signed-out" && (
        <p
          role="status"
          className="mt-6 flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm leading-6 text-foreground"
        >
          <CircleCheck
            className="size-4 shrink-0 text-success"
            aria-hidden="true"
          />
          Anda sudah keluar.
        </p>
      )}
      {/* Sesi berakhir: cookie masih ada tetapi server tidak lagi mengenalinya
          (kedaluwarsa atau dicabut). Bentuknya sama dengan penegasan di atas;
          teks dan ikon yang menyampaikan, warna hanya pendukung. Tujuan semula
          (?next=) tetap dipakai sesudah masuk. */}
      {!signingUp && notice === "session-expired" && (
        <p
          role="status"
          className="mt-6 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm leading-6 text-foreground"
        >
          <TimerOff
            className="size-4 shrink-0 text-warning"
            aria-hidden="true"
          />
          Sesi Anda berakhir. Masuk lagi untuk melanjutkan.
        </p>
      )}
      {/* method="post": bila formulir terkirim sebelum skripnya siap (jaringan
          lambat, skrip diblokir), browser mengirim lewat badan permintaan.
          Tanpa itu isiannya ikut ke alamat halaman (GET), termasuk kata sandi. */}
      <form
        method="post"
        onSubmit={onSubmit}
        className="mt-8 space-y-5"
        aria-busy={pending}
        aria-describedby={errorId}
      >
        <fieldset disabled={pending} className="space-y-5">
          <legend className="sr-only">
            {signingUp ? "Data akun" : "Data masuk"}
          </legend>
          {signingUp && (
            <div className="space-y-2">
              <Label htmlFor="name">Nama</Label>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                placeholder="Nama lengkap"
                required
                minLength={1}
                maxLength={100}
                pattern=".*\S.*"
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="nama@contoh.com"
              required
              maxLength={254}
              aria-invalid={invalid("email")}
              aria-describedby={describedBy("email")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Kata sandi</Label>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete={signingUp ? "new-password" : "current-password"}
                required
                minLength={8}
                maxLength={128}
                className="pr-11"
                aria-invalid={invalid("password")}
                aria-describedby={describedBy(
                  "password",
                  signingUp && "password-hint",
                )}
              />
              {/* Namanya tetap; yang berganti hanya aria-pressed. Mengganti nama
                  bersama status membuat pembaca layar membacanya dua kali. */}
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-0.5 right-0.5 text-muted-foreground"
                aria-label="Tampilkan kata sandi"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((shown) => !shown)}
              >
                {showPassword ? (
                  <EyeOff aria-hidden="true" />
                ) : (
                  <Eye aria-hidden="true" />
                )}
              </Button>
            </div>
            {signingUp && (
              <p id="password-hint" className="text-sm text-muted-foreground">
                Minimal 8 karakter.
              </p>
            )}
          </div>
          {failure && (
            <p
              id="auth-error"
              role="alert"
              className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive"
            >
              {failure.message}
            </p>
          )}
          {/* Batas laju (429): tombol menunggu beberapa detik. Sengaja
              aria-disabled, BUKAN disabled: tombol yang disabled kehilangan
              fokus, dan fokus harus tetap di sini supaya Enter bekerja lagi
              begitu hitungan habis. Klik dan Enter selama menunggu diabaikan
              onSubmit. Teks tombol TIDAK berubah ("Masuk"/"Buat akun"), jadi
              nama aksesibelnya sama dengan teks yang terlihat (WCAG 2.5.3); tak
              ada aria-label khusus menunggu. Hitung mundur ada di baris terpisah
              di bawah tombol, tersembunyi dari pembaca layar (angkanya berubah
              tiap detik); sebagai gantinya tombol dijelaskan satu kalimat statis
              tanpa angka lewat aria-describedby, dan selesainya diumumkan SEKALI
              lewat wilayah status di bawah. Tanda "tidak aktif": garis
              putus-putus, latar redup, kursor terlarang, dan panah hilang (bukan
              opasitas, supaya teksnya tetap terbaca). Baris hitung mundur
              memakai ruang tetap (min-h-5, selalu ada) supaya tata letak tidak
              bergeser saat hitungan muncul dan hilang. */}
          <div>
            <Button
              ref={submitRef}
              className="w-full motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:border aria-disabled:border-dashed aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:hover:bg-muted"
              type="submit"
              size="lg"
              disabled={pending}
              aria-disabled={wait.waiting ? true : undefined}
              aria-describedby={wait.waiting ? WAIT_NOTE_ID : undefined}
            >
              {pending && (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {pending
                ? signingUp
                  ? "Membuat akun…"
                  : "Memeriksa…"
                : actionName}
              {!pending && !wait.waiting && <ArrowRight aria-hidden="true" />}
            </Button>
            <div className="mt-2 min-h-5">
              {wait.waiting && (
                <>
                  <p
                    data-testid="retry-countdown"
                    aria-hidden="true"
                    className="flex items-center justify-center gap-1.5 text-sm leading-5 text-muted-foreground"
                  >
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    <span>
                      Bisa mencoba lagi dalam{" "}
                      <span aria-hidden="true" className="tabular-nums">
                        {wait.left}
                      </span>{" "}
                      dtk
                    </span>
                  </p>
                  <span id={WAIT_NOTE_ID} className="sr-only">
                    Batas percobaan tercapai; tunggu beberapa detik.
                  </span>
                </>
              )}
            </div>
          </div>
            <div className="pt-1">
              <div className="relative flex py-2 items-center">
                <div className="flex-grow border-t border-border"></div>
                <span className="flex-shrink mx-2 text-xs text-muted-foreground">atau {signingUp ? "daftar" : "masuk"} dengan</span>
                <div className="flex-grow border-t border-border"></div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full h-10 text-xs font-medium gap-2.5 border-border bg-card text-foreground hover:bg-accent shadow-xs"
                onClick={async () => {
                  try {
                    const res = await authClient.signIn.social({
                      provider: "logto" as unknown as "github",
                      callbackURL: destination ?? siteConfig.homePath,
                    });
                    if (res?.error) {
                      setFailure({
                        message: "Gagal menghubungkan ke Logto SSO. Pastikan App ID & App Secret Logto sudah diisi di file .env.",
                        target: "submit",
                      });
                    }
                  } catch {
                    setFailure({
                      message: "Layanan Logto SSO belum aktif. Pastikan kontainer Logto menyala via npm run logto:up.",
                      target: "submit",
                    });
                  }
                }}
              >
                <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>{signingUp ? "Daftar dengan Google (via Logto SSO)" : "Masuk dengan Google (via Logto SSO)"}</span>
              </Button>
            </div>
          {/* Selalu terpasang (kosong dulu) supaya isinya diumumkan ketika
              muncul. Hanya satu kali, saat hitungan habis; angka yang berkurang
              tidak diumumkan. */}
          <p role="status" className="sr-only">
            {wait.finished ? "Anda bisa mencoba lagi sekarang." : ""}
          </p>
        </fieldset>
      </form>
      {(signingUp || allowSignUp) && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          {signingUp ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
          <Link
            className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            href={signingUp ? signInUrl(destination) : signUpUrl(destination)}
          >
            {signingUp ? "Masuk" : "Buat akun"}
          </Link>
        </p>
      )}
    </div>
  );
}
