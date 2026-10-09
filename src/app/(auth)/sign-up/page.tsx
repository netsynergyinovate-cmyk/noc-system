import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/route-guard";

export const metadata: Metadata = { title: "Buat akun" };
export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  // Sama dengan halaman masuk: tujuan dibawa antara kedua halaman.
  const next = safeNextPath((await searchParams).next);
  return <AuthForm mode="sign-up" redirectTo={next} />;
}
