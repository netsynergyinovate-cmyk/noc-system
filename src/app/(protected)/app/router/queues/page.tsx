import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { SimpleQueueBoard } from "@/components/dashboard/simple-queue-board";

export const metadata: Metadata = { title: "Simple Queue Router" };

export default async function RouterQueuesPage() {
  await requireSession();
  return <SimpleQueueBoard />;
}
