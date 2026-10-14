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
    <Card className={cn("gap-3 py-5", className)} {...props}>
      <CardContent className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight tabular-nums">
            {value}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          {children}
        </div>
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg",
            toneClasses[tone],
          )}
        >
          <Icon className="size-5" aria-hidden="true" />
        </span>
      </CardContent>
    </Card>
  );
}
