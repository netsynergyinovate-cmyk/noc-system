import type { Metadata } from "next";
import { RunsnetBillingBoard } from "@/components/dashboard/runsnet-billing-board";
import { requireSession } from "@/lib/session";

export const metadata: Metadata = { title: "Billing & Tagihan RunsNet" };

export default async function BillingPage() {
  await requireSession();
  return (
    <div className="flex w-full flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Billing</h1>
      <RunsnetBillingBoard />
    </div>
  );
}
