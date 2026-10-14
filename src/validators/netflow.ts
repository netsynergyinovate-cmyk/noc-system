import { z } from "zod";

export const netflowQuerySchema = z.object({
  range: z.enum(["1h", "6h", "24h", "7d"]).default("1h"),
  routerId: z.string().uuid().optional(),
  protocol: z.enum(["TCP", "UDP", "ICMP", "ALL"]).optional(),
  app: z.string().trim().max(100).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export type NetflowQuery = z.infer<typeof netflowQuerySchema>;

// Parameter kosong (`?q=`) dianggap tidak ada.
export function parseNetflowQuery(params: URLSearchParams): NetflowQuery {
  const raw: Record<string, string> = {};
  for (const [key, value] of params) if (value.trim() !== "") raw[key] = value;
  return netflowQuerySchema.parse(raw);
}
