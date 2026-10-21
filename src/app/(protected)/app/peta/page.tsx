import type { Metadata } from "next";
import { requireSession } from "@/lib/session";
import { MapClient } from "./map-client";

export const metadata: Metadata = {
  title: "Peta Jaringan - NOC ISP",
  description:
    "Peta infrastruktur jaringan, jalur kabel serat optik, dan sebaran pelanggan.",
};

export default async function PetaPage() {
  await requireSession();
  return (
    // Lepas dari padding AppShell supaya peta mengisi sisa layar tanpa scroll halaman.
    <div
      className="relative w-[calc(100%+2rem)] sm:w-[calc(100%+3rem)] -mx-4 -my-5 sm:-mx-6 sm:-my-6 h-[calc(100dvh-4.5rem)] lg:h-[100dvh] overflow-hidden bg-background"
      data-testid="peta-page"
    >
      <MapClient />
    </div>
  );
}
