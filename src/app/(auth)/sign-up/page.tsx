import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/route-guard";

export const metadata: Metadata = { title: "Buat akun" };
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Pendaftaran tertutup: halaman ini tidak ada (server juga menolak sign-up).
  if (!env.ALLOW_SIGN_UP) notFound();
  // Sama dengan halaman masuk: tujuan dibawa antara kedua halaman.
  const next = safeNextPath((await searchParams).next);
  return <AuthForm mode="sign-up" redirectTo={next} />;
}
