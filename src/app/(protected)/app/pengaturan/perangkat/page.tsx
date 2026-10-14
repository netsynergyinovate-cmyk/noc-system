import type { Metadata } from "next";
import { DeviceConfigBoard } from "@/components/dashboard/device-config-board";

export const metadata: Metadata = {
  title: "Konfigurasi Perangkat Jaringan",
  description:
    "Pengaturan integrasi perangkat fisik & simulator lab lokal: MikroTik REST, OLT HSGQ, GenieACS, dan Billing.",
};

export default function DeviceConfigPage() {
  return <DeviceConfigBoard />;
}
