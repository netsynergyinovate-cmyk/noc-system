import { AuthForm } from "@/components/auth-form";
import { safeNextPath } from "@/lib/route-guard";

export const metadata = { title: "Masuk - NOC System" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  return <AuthForm mode="sign-in" redirectTo={next} allowSignUp={false} />;
}
