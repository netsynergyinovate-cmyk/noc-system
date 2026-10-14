"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { Can } from "@/components/access";
import { Button } from "@/components/ui/button";

// Tautan ke area admin, hanya untuk peran yang punya kemampuan "adminArea".
// Menyembunyikannya hanya tampilan: /admin dan API-nya menjaga diri sendiri
// dengan peran asli, termasuk saat peran tiruan "Lihat sebagai" dipakai.
// Peran asli admin sudah memunculkannya di HTML dari server.
export function AdminLink() {
  return (
    <Can to="adminArea">
      <Button variant="outline" size="sm" asChild>
        <Link href="/admin">
          <ShieldCheck aria-hidden="true" />
          Buka admin
        </Link>
      </Button>
    </Can>
  );
}
