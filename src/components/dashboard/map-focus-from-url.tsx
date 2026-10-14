"use client";

import { useEffect } from "react";
import { useDashboardStore } from "@/lib/dashboard/store";

// Tautan /app?focus=<id pelanggan> membuka dashboard dengan peta langsung
// menyorot pelanggan itu, mis. dari notifikasi gangguan. Ia hanya mengirim
// permintaan; petanya sendiri yang menggeser diri.
export function MapFocusFromUrl({ customerId }: { customerId: string }) {
  const focusMap = useDashboardStore((state) => state.focusMap);
  useEffect(() => {
    focusMap(customerId);
  }, [customerId, focusMap]);
  return null;
}
