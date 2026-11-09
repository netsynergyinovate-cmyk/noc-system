import type { ComponentProps, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "cn";
import { Card, CardContent } from "@/components/ui/card";

const toneClasses = {
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-destructive/10 text-destructive",
  neutral: "bg-secondary text-foreground",
} as const;

export type MetricTone = keyof typeof toneClasses;

interface MetricCardProps extends Omit<ComponentProps<"div">, "children"> {
  label: string;
  value: string;
  hint: string;
  Icon: LucideIcon;
  tone?: MetricTone;
  // Keterangan tambahan di bawah hint, mis. angka pendamping.
  children?: ReactNode;
}

// Satu angka penting dengan keterangan singkat. Warna hanya pelengkap:
// makna selalu ada di label dan keterangan.
export function MetricCard({
  label,
  value,
  hint,
  Icon,
  tone = "neutral",
  children,
  className,
  ...props
}: MetricCardProps & { children?: ReactNode }) {
  return (
    <Card
      className={cn(
        "py-3 px-4 shadow-2xs transition-all hover:border-border/80",
        className,
      )}
      {...props}
    >
      <CardContent className="p-0 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-bold tracking-tight tabular-nums text-foreground">
            {value}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground/85 truncate">
            {hint}
          </p>
          {children}
        </div>
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md",
            toneClasses[tone],
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );
}
