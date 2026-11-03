import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { env } from "@/lib/env";
import {
  isSessionExpiredParam,
  safeNextPath,
  SESSION_EXPIRED_PARAM,
} from "@/lib/route-guard";
import { isSignedOutParam, SIGNED_OUT_PARAM } from "@/lib/signed-out";

export const metadata: Metadata = { title: "Masuk" };
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  // Tujuan setelah masuk. Bukan satu teks, atau bukan jalur terlindungi
  // satu-origin, berarti tidak ada tujuan (formulir memakai dasbor).
  const next = safeNextPath(params.next);
  // Penegasan hanya untuk ?keluar=1 persis (petugas menekan Keluar) atau
  // ?sesi=berakhir persis (cookie ada tetapi sesinya tidak sah). Yang
  // diteruskan ke formulir hanya bendera, bukan isi parameternya. Bila
  // keduanya ada, "keluar" menang: itu pilihan petugas sendiri.
  const notice = isSignedOutParam(params[SIGNED_OUT_PARAM])
    ? "signed-out"
    : isSessionExpiredParam(params[SESSION_EXPIRED_PARAM])
      ? "session-expired"
      : null;
  return (
    <AuthForm
      mode="sign-in"
      redirectTo={next}
      notice={notice}
      allowSignUp={env.ALLOW_SIGN_UP}
    />
  );
}
