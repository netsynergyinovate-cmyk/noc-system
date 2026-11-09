import { z } from "zod";
import {
  networkLogTypes,
  networkLogSeverities,
} from "@/db/schema/network-logs";

export const anomalyStatusSchema = z.enum(["active", "resolved", "all"]);
export type AnomalyStatusQuery = z.infer<typeof anomalyStatusSchema>;

export const anomalyKindSchema = z.enum(networkLogTypes);
export type AnomalyKindQuery = z.infer<typeof anomalyKindSchema>;

export const anomalySeveritySchema = z.enum(networkLogSeverities);
export type AnomalySeverityQuery = z.infer<typeof anomalySeveritySchema>;

export const anomalyQuerySchema = z.object({
  status: anomalyStatusSchema.default("all"),
  kind: anomalyKindSchema.optional(),
  type: anomalyKindSchema.optional(),
  severity: anomalySeveritySchema.optional(),
  routerId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  from: z.coerce.number().int().nonnegative().optional(),
  to: z.coerce.number().int().nonnegative().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AnomalyQuery = z.infer<typeof anomalyQuerySchema>;

export function parseAnomalyQuery(searchParams: URLSearchParams): AnomalyQuery {
  const raw: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (value && value.trim() !== "") raw[key] = value.trim();
  }
  return anomalyQuerySchema.parse(raw);
}

export const createAnomalyInputSchema = z.object({
  routerId: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  type: anomalyKindSchema,
  severity: anomalySeveritySchema.default("warning"),
  interfaceName: z.string().trim().max(100).nullable().optional(),
  measured: z.number().nullable().optional(),
  startedAt: z.coerce.date().optional(),
  endedAt: z.coerce.date().nullable().optional(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export type CreateAnomalyInput = z.infer<typeof createAnomalyInputSchema>;

export const detectAnomaliesQuerySchema = z.object({
  routerId: z.string().uuid().optional(),
  persist: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v !== "false"),
});

export type DetectAnomaliesQuery = z.infer<typeof detectAnomaliesQuerySchema>;

export const updateAnomalyStatusSchema = z.object({
  status: z.enum(["active", "resolved", "reviewed"]).optional(),
  reviewed: z.boolean().optional(),
  operator: z.string().trim().max(100).optional(),
  endedAt: z.coerce.date().nullable().optional(),
  severity: anomalySeveritySchema.optional(),
  note: z.string().trim().max(500).optional(),
});

export type UpdateAnomalyStatusInput = z.infer<
  typeof updateAnomalyStatusSchema
>;
