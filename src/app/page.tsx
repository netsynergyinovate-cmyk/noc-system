import { redirect } from "next/navigation";
import { siteConfig } from "@/config/site";
import { getSession } from "@/lib/session";

// Pengalih tanpa tampilan. Petugas yang membuka aplikasi langsung sampai di
// tujuannya dalam satu lompatan: dasbor bila sudah masuk, halaman masuk bila
// belum. Gerbang Setup Perangkat tetap urusan layout dasbor.
export default async function Home() {
  redirect((await getSession()) ? siteConfig.homePath : "/sign-in");
}
