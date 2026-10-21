import { z } from "zod";
import { apiKeyAccesses } from "@/db/schema/api-keys";

export const createApiKeySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    access: z.enum(apiKeyAccesses).default("read"),
  })
  .strict();
export const apiKeyIdSchema = z.string().uuid();

// Query GET /api/v1/data. Tanpa `dataset` endpoint mengembalikan daftar dataset.
export const readExternalDataSchema = z
  .object({
    dataset: z.string().trim().min(1).max(60).optional(),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    offset: z.coerce.number().int().min(0).max(10_000_000).default(0),
  })
  .strict();

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
