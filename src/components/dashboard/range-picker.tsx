"use client";

import { cn } from "cn";
import { TRAFFIC_RANGES, type TrafficRangeId } from "@/lib/dashboard/ranges";

// Tombol bergantian: satu rentang aktif pada satu waktu. Memakai aria-pressed
// supaya pembaca layar menyebut mana yang sedang dipilih.
export function RangePicker({
  value,
  onChange,
}: {
  value: TrafficRangeId;
  onChange: (range: TrafficRangeId) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Rentang waktu grafik"
      className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border bg-muted p-0.5"
    >
      {TRAFFIC_RANGES.map((range) => {
        const active = range.id === value;
        return (
          <button
            key={range.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(range.id)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {range.label}
          </button>
        );
      })}
    </div>
  );
}
