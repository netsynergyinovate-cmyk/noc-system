import type { Metadata } from "next";
import { ApiKeyBoard } from "@/components/dashboard/api-key-board";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = { title: "API Key" };

export default async function ApiKeyPage() {
  await requirePermission({ apiKey: ["manage"] });
  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          API Key
        </h1>
        <p className="text-sm text-muted-foreground">
          Kunci untuk aplikasi luar yang menarik atau mengubah data NOC. Kata
          sandi perangkat dan kredensial tidak pernah ikut terkirim.
        </p>
      </div>
      <ApiKeyBoard />
    </div>
  );
}
