import { z } from "zod";
import { thresholdLimits } from "@/lib/dashboard/thresholds";

const rule = (kind: keyof typeof thresholdLimits) => {
  const limit = thresholdLimits[kind].threshold;
  return z
    .object({
      threshold: z.number().nullable().optional(),
      forSeconds: z.number().int().min(0),
    })
    .strict()
    .superRefine((value, ctx) => {
      const t = value.threshold;
      if (!limit) {
        if (t !== null && t !== undefined)
          ctx.addIssue({
            code: "custom",
            path: ["threshold"],
            message: "Aturan ini tidak punya ambang angka.",
          });
        return;
      }
      if (t === null || t === undefined || t < limit.min || t > limit.max)
        ctx.addIssue({
          code: "custom",
          path: ["threshold"],
          message: `Ambang harus ${limit.min} sampai ${limit.max}.`,
        });
    });
};

export const updateThresholdsSchema = z
  .object({
    queue: rule("queue").optional(),
    cpu: rule("cpu").optional(),
    port: rule("port").optional(),
    optical: rule("optical").optional(),
    offline: rule("offline").optional(),
  })
  .strict();

export type UpdateThresholdsInput = z.infer<typeof updateThresholdsSchema>;
