import type { Metadata } from "next";
import { AccountManagementBoard } from "@/components/dashboard/account-management-board";
import { requirePermission } from "@/lib/session";

export const metadata: Metadata = {
  title: "Manajemen Akun & Hak Akses Pengguna",
  description:
    "Kelola akun pengguna, berikan akses baru, dan atur peran Super Admin, Admin, atau User.",
};

export default function AccountSettingsPage() {
  return <AccountManagementBoard />;
}
