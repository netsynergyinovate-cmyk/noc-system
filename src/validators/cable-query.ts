import { z } from "zod";

export const cableZoomQuerySchema = z.object({
  zoom: z.coerce.number().int().min(1).max(22).optional().default(15),
  minLat: z.coerce.number().min(-90).max(90).optional(),
  maxLat: z.coerce.number().min(-90).max(90).optional(),
  minLng: z.coerce.number().min(-180).max(180).optional(),
  maxLng: z.coerce.number().min(-180).max(180).optional(),
  south: z.coerce.number().min(-90).max(90).optional(),
  north: z.coerce.number().min(-90).max(90).optional(),
  west: z.coerce.number().min(-180).max(180).optional(),
  east: z.coerce.number().min(-180).max(180).optional(),
  bbox: z.string().optional(),
  buffer: z.coerce.number().min(0).max(1).optional().default(0.15),
  type: z
    .enum(["all", "backbone", "feeder", "distribution", "drop"])
    .optional()
    .default("all"),
  status: z
    .enum(["all", "active", "warning", "offline"])
    .optional()
    .default("all"),
  includeDrop: z.coerce.boolean().optional(),
  forceMock: z.coerce.boolean().optional().default(false),
});

export type CableZoomQueryInput = z.infer<typeof cableZoomQuerySchema>;
