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
              onSubmit. Nama aksesibelnya tetap "Masuk"/"Buat akun" (aria-label);
              angka yang berkurang disembunyikan dari pembaca layar, dan selesainya
              diumumkan SEKALI lewat wilayah status di bawah. Tanda "tidak aktif":
              garis putus-putus, latar redup, kursor terlarang, dan ikon jam
              (bukan opasitas, supaya teksnya tetap terbaca). */}
          <Button
            ref={submitRef}
            className="w-full motion-reduce:transition-none aria-disabled:cursor-not-allowed aria-disabled:border aria-disabled:border-dashed aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:hover:bg-muted"
            type="submit"
            size="lg"
            disabled={pending}
            aria-disabled={wait.waiting ? true : undefined}
            aria-label={wait.waiting ? actionName : undefined}
          >
            {pending ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : wait.waiting ? (
              <Clock aria-hidden="true" />
            ) : null}
            {pending ? (
              signingUp ? (
                "Membuat akun…"
              ) : (
                "Memeriksa…"
              )
            ) : wait.waiting ? (
              <span>
                Coba lagi dalam{" "}
                <span aria-hidden="true" className="tabular-nums">
                  {wait.left}
                </span>{" "}
                dtk
              </span>
            ) : (
              actionName
            )}
            {!pending && !wait.waiting && <ArrowRight aria-hidden="true" />}
          </Button>
          {/* Selalu terpasang (kosong dulu) supaya isinya diumumkan ketika
              muncul. Hanya satu kali, saat hitungan habis; angka yang berkurang
              tidak diumumkan. */}
          <p role="status" className="sr-only">
            {wait.finished ? "Anda bisa mencoba lagi sekarang." : ""}
          </p>
        </fieldset>
      </form>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {signingUp ? "Sudah punya akun?" : "Belum punya akun?"}{" "}
        <Link
          className="rounded-sm font-medium text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          href={signingUp ? signInUrl(destination) : signUpUrl(destination)}
        >
          {signingUp ? "Masuk" : "Buat akun"}
        </Link>
      </p>
    </div>
  );
}
