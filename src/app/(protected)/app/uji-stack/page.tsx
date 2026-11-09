import type { Metadata } from "next";
import { StackBenchmarkBoard } from "@/components/dashboard/stack-benchmark-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = {
  title: "Hasil Uji Banding Stack - NOC ISP",
};

export default async function StackBenchmarkPage() {
  await requireSession();
  return (
    <div
      data-testid="stack-benchmark-page"
      className="flex w-full flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Hasil Uji Banding Stack
        </h1>
        <p className="text-sm text-muted-foreground">
          Perbandingan Go daemon dan Next.js di lab lokal, beserta keputusan
          arsitektur.
        </p>
      </div>
      <StackBenchmarkBoard />
    </div>
  );
}
