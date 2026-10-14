import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { RouterTestBoard } from "@/components/dashboard/router-test-board";

export const metadata: Metadata = { title: "Uji Koneksi Router" };

export default async function RouterTestPage() {
  await requireSession();
  return <RouterTestBoard />;
}
