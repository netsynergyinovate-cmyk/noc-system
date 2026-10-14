import type { Metadata } from "next";
import { SettingsBoard } from "@/components/dashboard/settings-board";

export const metadata: Metadata = {
  title: "Pengaturan Sistem & Operasional",
};

export default function PengaturanPage() {
  return <SettingsBoard />;
}

